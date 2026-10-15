package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"time"

	"trace-ux/server/store"
)

const (
	maxSessionExportBytes = 64 << 20
	maxSessionExportJobs  = 4
	sessionExportTimeout  = 5 * time.Minute
	sessionExportTTL      = 5 * time.Minute
)

var errSessionExportTooLarge = errors.New("recording exceeds the 64 MiB export limit")

type sessionExportStatus struct {
	ID          string `json:"id"`
	State       string `json:"state"`
	ChunksDone  int    `json:"chunks_done"`
	ChunksTotal int    `json:"chunks_total"`
	Bytes       int64  `json:"bytes"`
	Error       string `json:"error,omitempty"`
	DownloadURL string `json:"download_url,omitempty"`
}

type sessionExportJob struct {
	status    sessionExportStatus
	ownerID   int64
	sessionID string
	path      string
	cancel    context.CancelFunc
	expiry    *time.Timer
}

// Export preparation never queues unbounded work. One worker per server, a
// bounded set of private temp files, and automatic expiry also cover abandoned
// tabs. All mutable job fields are protected by exportMu.
func (s *Server) handlePrepareSessionExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id := r.PathValue("id")
	if _, err := s.store.GetSession(id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "session not found")
		} else {
			writeErr(w, http.StatusInternalServerError, "could not prepare session export")
		}
		return
	}
	s.exportMu.Lock()
	defer s.exportMu.Unlock()
	owner := currentUser(r).ID
	for _, job := range s.exportJobs {
		if job.ownerID == owner && job.sessionID == id && job.status.State == "preparing" {
			writeJSON(w, http.StatusAccepted, job.status)
			return
		}
	}
	if s.exportClosed {
		writeErr(w, http.StatusServiceUnavailable, "export preparation is unavailable")
		return
	}
	if s.exportBusy || len(s.exportJobs) >= maxSessionExportJobs {
		w.Header().Set("Retry-After", "5")
		writeErr(w, http.StatusTooManyRequests, "another export is preparing or waiting to be downloaded; try again shortly")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), sessionExportTimeout)
	job := &sessionExportJob{
		status:    sessionExportStatus{ID: rand.Text(), State: "preparing"},
		ownerID:   owner,
		sessionID: id,
		cancel:    cancel,
	}
	if s.exportJobs == nil {
		s.exportJobs = make(map[string]*sessionExportJob)
	}
	s.exportJobs[job.status.ID] = job
	s.exportBusy = true
	job.expiry = time.AfterFunc(sessionExportTimeout+sessionExportTTL, func() { s.removeSessionExport(job.status.ID) })
	s.exportWorkers.Add(1)
	go s.runSessionExport(ctx, job)
	writeJSON(w, http.StatusAccepted, job.status)
}

func (s *Server) runSessionExport(ctx context.Context, job *sessionExportJob) {
	defer s.exportWorkers.Done()
	defer job.cancel()
	file, err := s.prepareSessionExport(ctx, job.sessionID, func(p store.SessionExportProgress, bytes int64) {
		s.exportMu.Lock()
		job.status.ChunksDone = p.ChunksDone
		job.status.ChunksTotal = p.ChunksTotal
		job.status.Bytes = bytes
		s.exportMu.Unlock()
	})
	s.exportMu.Lock()
	defer s.exportMu.Unlock()
	s.exportBusy = false
	if s.exportJobs[job.status.ID] != job {
		if file != nil {
			file.Close()
			os.Remove(file.Name())
		}
		return
	}
	job.expiry.Reset(sessionExportTTL)
	if err != nil {
		job.status.State = "failed"
		job.status.Error = sessionExportError(err)
		return
	}
	job.path = file.Name()
	info, statErr := file.Stat()
	closeErr := file.Close()
	if statErr != nil || closeErr != nil {
		os.Remove(job.path)
		job.path = ""
		job.status.State = "failed"
		job.status.Error = "could not finalize the export file"
		return
	}
	job.status.Bytes = info.Size()
	job.status.State = "ready"
	job.status.DownloadURL = "/api/session-exports/" + job.status.ID + "/download"
}

func (s *Server) handleSessionExportStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.exportMu.Lock()
	defer s.exportMu.Unlock()
	job := s.exportJobs[r.PathValue("exportID")]
	if job == nil || job.ownerID != currentUser(r).ID {
		writeErr(w, http.StatusNotFound, "export not found or expired")
		return
	}
	writeJSON(w, http.StatusOK, job.status)
}

func (s *Server) handleDownloadSessionExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.exportMu.Lock()
	job := s.exportJobs[r.PathValue("exportID")]
	if job == nil || job.ownerID != currentUser(r).ID {
		s.exportMu.Unlock()
		writeErr(w, http.StatusNotFound, "export not found or expired")
		return
	}
	if job.status.State != "ready" {
		s.exportMu.Unlock()
		writeErr(w, http.StatusConflict, "export is not ready to download")
		return
	}
	// Open while holding the lock: cancellation/expiry may unlink the path
	// afterwards without interrupting a download that already has its file.
	file, err := os.Open(job.path)
	id := job.sessionID
	s.exportMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusNotFound, "export file expired; prepare it again")
		return
	}
	defer file.Close()
	serveSessionExport(w, r, id, file)
}

func (s *Server) handleCancelSessionExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.exportMu.Lock()
	job := s.exportJobs[r.PathValue("exportID")]
	if job == nil || job.ownerID != currentUser(r).ID {
		s.exportMu.Unlock()
		writeErr(w, http.StatusNotFound, "export not found or expired")
		return
	}
	s.removeSessionExportLocked(job.status.ID)
	s.exportMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) removeSessionExport(id string) {
	s.exportMu.Lock()
	defer s.exportMu.Unlock()
	s.removeSessionExportLocked(id)
}

func (s *Server) removeSessionExportLocked(id string) {
	job := s.exportJobs[id]
	if job == nil {
		return
	}
	delete(s.exportJobs, id)
	job.cancel()
	job.expiry.Stop()
	if job.path != "" {
		os.Remove(job.path)
	}
}

func (s *Server) closeSessionExports() {
	s.exportMu.Lock()
	s.exportClosed = true
	for id := range s.exportJobs {
		s.removeSessionExportLocked(id)
	}
	s.exportMu.Unlock()
	s.exportWorkers.Wait()
}

// Preserve direct authenticated downloads for API clients. The dashboard uses
// background preparation/status so long exports do not hold an HTTP request.
func (s *Server) handleExportSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.exportMu.Lock()
	if s.exportBusy || s.exportClosed {
		s.exportMu.Unlock()
		w.Header().Set("Retry-After", "5")
		writeErr(w, http.StatusTooManyRequests, "another export is preparing; try again shortly")
		return
	}
	s.exportBusy = true
	s.exportMu.Unlock()
	defer func() {
		s.exportMu.Lock()
		s.exportBusy = false
		s.exportMu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	file, err := s.prepareSessionExport(ctx, r.PathValue("id"), nil)
	if err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, sql.ErrNoRows) {
			code = http.StatusNotFound
		} else if errors.Is(err, errSessionExportTooLarge) {
			code = http.StatusRequestEntityTooLarge
		} else if errors.Is(err, context.DeadlineExceeded) {
			code = http.StatusGatewayTimeout
		}
		writeErr(w, code, sessionExportError(err))
		return
	}
	defer os.Remove(file.Name())
	defer file.Close()
	serveSessionExport(w, r, r.PathValue("id"), file)
}

func sessionExportError(err error) string {
	switch {
	case errors.Is(err, errSessionExportTooLarge):
		return "This recording exceeds the 64 MiB export limit. No partial file was created."
	case errors.Is(err, context.DeadlineExceeded):
		return "Preparing this export took too long. No partial file was created."
	case errors.Is(err, context.Canceled):
		return "Export preparation was canceled."
	case errors.Is(err, sql.ErrNoRows):
		return "session not found"
	default:
		return "could not export the complete recording"
	}
}

// No successful response is sent until a complete, bounded file exists. A
// buffered writer avoids one disk syscall per event while the byte cap and
// context also apply to the final buffer flush.
func (s *Server) prepareSessionExport(ctx context.Context, id string, progress func(store.SessionExportProgress, int64)) (*os.File, error) {
	file, err := os.CreateTemp("", "traceux-session-export-*.json")
	if err != nil {
		return nil, err
	}
	limited := &sessionExportWriter{ctx: ctx, dst: file, remaining: maxSessionExportBytes}
	buffer := bufio.NewWriterSize(limited, 64<<10)
	err = s.store.WriteSessionExportWithOptions(ctx, id, buffer, store.SessionExportOptions{
		Throttle: true,
		Progress: func(p store.SessionExportProgress) {
			if progress != nil {
				progress(p, int64(maxSessionExportBytes)-limited.remaining+int64(buffer.Buffered()))
			}
		},
	})
	if err == nil {
		err = buffer.Flush()
	}
	if err != nil {
		file.Close()
		os.Remove(file.Name())
		return nil, err
	}
	return file, nil
}

type sessionExportWriter struct {
	ctx       context.Context
	dst       io.Writer
	remaining int64
}

func (w *sessionExportWriter) Write(data []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if int64(len(data)) > w.remaining {
		return 0, errSessionExportTooLarge
	}
	n, err := w.dst.Write(data)
	w.remaining -= int64(n)
	return n, err
}

func serveSessionExport(w http.ResponseWriter, r *http.Request, id string, file *os.File) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
		"filename": "traceux-session-" + id + ".json",
	}))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", time.Time{}, file)
}
