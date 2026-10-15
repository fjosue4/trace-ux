package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"trace-ux/server/store"
)

func startExportJob(t *testing.T, baseURL, sid string, cookie *http.Cookie) sessionExportStatus {
	t.Helper()
	resp := doReq(t, http.MethodPost, baseURL+"/api/sessions/"+sid+"/export", cookie, "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("prepare: %d %s", resp.StatusCode, body)
	}
	var status sessionExportStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

func awaitExportJob(t *testing.T, baseURL, id string, cookie *http.Cookie) sessionExportStatus {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	lastDone := 0
	for time.Now().Before(deadline) {
		resp := doReq(t, http.MethodGet, baseURL+"/api/session-exports/"+id, cookie, "")
		var status sessionExportStatus
		err := json.NewDecoder(resp.Body).Decode(&status)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK || err != nil {
			t.Fatalf("status: %d %v", resp.StatusCode, err)
		}
		if status.ChunksDone < lastDone || status.ChunksDone > status.ChunksTotal || status.Bytes > maxSessionExportBytes {
			t.Fatalf("invalid progress: %+v", status)
		}
		lastDone = status.ChunksDone
		if status.State != "preparing" {
			return status
		}
		if status.DownloadURL != "" {
			t.Fatal("offered a download before the file was complete")
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("export did not finish")
	return sessionExportStatus{}
}

func TestSessionExportBackgroundProgressDownloadAndOwnership(t *testing.T) {
	srv, ts := newTestServer(t)
	const sid = "background"
	seedCSSSession(t, srv, sid, bigCSS("background"))
	const chunks = 40
	for i := 1; i < chunks; i++ {
		writeChunk(t, srv, sid, i, []byte(`[{"type":3,"timestamp":2000,"data":{"source":2,"id":11,"x":300,"y":200}}]`))
	}
	admin := login(t, ts.URL, "admin", "pw")
	started := startExportJob(t, ts.URL, sid, admin)
	if started.State != "preparing" || started.ID == "" || started.DownloadURL != "" {
		t.Fatalf("prepare must return immediately: %+v", started)
	}
	duplicate := startExportJob(t, ts.URL, sid, admin)
	if duplicate.ID != started.ID {
		t.Fatal("duplicate request created another worker")
	}
	if err := srv.store.EnsureSessionForSite(1, "second", time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	resp := doReq(t, http.MethodPost, ts.URL+"/api/sessions/second/export", admin, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("unbounded concurrent preparation: %d", resp.StatusCode)
	}
	resp = doReq(t, http.MethodGet, ts.URL+"/api/session-exports/"+started.ID+"/download", admin, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("partial file offered: %d", resp.StatusCode)
	}
	// Preparation uses the reader pool: replay and ingest remain available.
	resp = doReq(t, http.MethodGet, ts.URL+"/api/sessions/"+sid, admin, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("replay unavailable during export: %d", resp.StatusCode)
	}
	if _, err := srv.store.SaveCustomEvents(1, sid, []store.CustomEvent{{TS: 99999, Name: "during-export"}}); err != nil {
		t.Fatal(err)
	}
	viewer, err := srv.store.CreateUser("other-reader", "unused-hash", "viewer")
	if err != nil {
		t.Fatal(err)
	}
	token, err := srv.store.CreateAuthSession(viewer.ID)
	if err != nil {
		t.Fatal(err)
	}
	other := &http.Cookie{Name: authCookie, Value: token}
	for _, endpoint := range []struct{ method, suffix string }{
		{http.MethodGet, ""}, {http.MethodGet, "/download"}, {http.MethodDelete, ""},
	} {
		resp := doReq(t, endpoint.method, ts.URL+"/api/session-exports/"+started.ID+endpoint.suffix, other, "")
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("another user accessed job: %s %s: %d", endpoint.method, endpoint.suffix, resp.StatusCode)
		}
	}
	ready := awaitExportJob(t, ts.URL, started.ID, admin)
	if ready.State != "ready" || ready.ChunksDone != chunks || ready.ChunksTotal != chunks || ready.Bytes == 0 || ready.DownloadURL == "" {
		t.Fatalf("wrong finished progress: %+v", ready)
	}
	resp = doReq(t, http.MethodGet, ts.URL+ready.DownloadURL, admin, "")
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil || resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Disposition") == "" || resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("download: %d %v", resp.StatusCode, err)
	}
	var out exportedSession
	if err := json.Unmarshal(body, &out); err != nil || len(out.Events) != chunks || int64(len(body)) != ready.Bytes {
		t.Fatalf("incomplete file: events=%d bytes=%d error=%v", len(out.Events), len(body), err)
	}
	for _, event := range out.CustomEvents {
		if event.Name == "during-export" {
			t.Fatal("background export mixed database snapshots")
		}
	}
	// Exercise the real expiry callback without waiting five minutes.
	srv.exportMu.Lock()
	path := srv.exportJobs[ready.ID].path
	srv.exportJobs[ready.ID].expiry.Reset(time.Millisecond)
	srv.exportMu.Unlock()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("expired export file was not removed")
	}
	resp = doReq(t, http.MethodGet, ts.URL+ready.DownloadURL, admin, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expired export remains available: %d", resp.StatusCode)
	}
}

func TestSessionExportCancelReleasesWorker(t *testing.T) {
	srv, ts := newTestServer(t)
	seedCSSSession(t, srv, "cancel", bigCSS("cancel"))
	for i := 1; i < 30; i++ {
		writeChunk(t, srv, "cancel", i, []byte(`[{"type":3,"timestamp":2000,"data":{}}]`))
	}
	admin := login(t, ts.URL, "admin", "pw")
	job := startExportJob(t, ts.URL, "cancel", admin)
	resp := doReq(t, http.MethodDelete, ts.URL+"/api/session-exports/"+job.ID, admin, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cancel: %d", resp.StatusCode)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		srv.exportMu.Lock()
		busy := srv.exportBusy
		srv.exportMu.Unlock()
		if !busy {
			break
		}
		time.Sleep(time.Millisecond)
	}
	srv.exportMu.Lock()
	busy, remaining := srv.exportBusy, len(srv.exportJobs)
	srv.exportMu.Unlock()
	if busy || remaining != 0 {
		t.Fatalf("canceled export retained work: busy=%v jobs=%d", busy, remaining)
	}
	resp = doReq(t, http.MethodGet, ts.URL+"/api/session-exports/"+job.ID+"/download", admin, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatal("canceled file can be downloaded")
	}
	retry := startExportJob(t, ts.URL, "cancel", admin)
	if retry.ID == job.ID {
		t.Fatal("retry reused canceled job")
	}
}

func TestSessionExportBackgroundFailureAndRetainedFileLimit(t *testing.T) {
	srv, ts := newTestServer(t)
	seedCSSSession(t, srv, "failure", bigCSS("failure"))
	admin := login(t, ts.URL, "admin", "pw")
	if _, err := srv.store.DB.Exec(`UPDATE chunks SET data=x'00' WHERE session_id='failure'`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < maxSessionExportJobs; i++ {
		job := startExportJob(t, ts.URL, "failure", admin)
		failed := awaitExportJob(t, ts.URL, job.ID, admin)
		if failed.State != "failed" || failed.Error == "" || failed.DownloadURL != "" {
			t.Fatalf("corrupt export did not fail cleanly: %+v", failed)
		}
	}
	resp := doReq(t, http.MethodPost, ts.URL+"/api/sessions/failure/export", admin, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatal("job retention is unbounded")
	}
}

func TestSessionExportWriterLimitsAndCancellation(t *testing.T) {
	var dst bytes.Buffer
	writer := &sessionExportWriter{ctx: context.Background(), dst: &dst, remaining: 4}
	if _, err := writer.Write([]byte("1234")); err != nil {
		t.Fatal(err)
	}
	if n, err := writer.Write([]byte("5")); n != 0 || !errors.Is(err, errSessionExportTooLarge) || dst.String() != "1234" {
		t.Fatalf("size cap failed: n=%d err=%v bytes=%s", n, err, dst.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	writer = &sessionExportWriter{ctx: ctx, dst: &dst, remaining: 100}
	if _, err := writer.Write([]byte("more")); !errors.Is(err, context.Canceled) {
		t.Fatal("writer ignored cancellation")
	}
	for _, err := range []error{errSessionExportTooLarge, context.DeadlineExceeded} {
		if !strings.Contains(sessionExportError(err), "No partial file") {
			t.Fatal("limit error does not explain why no file is downloaded")
		}
	}
}

func TestSessionExportThrottleProgressAndCancellation(t *testing.T) {
	srv, _ := newTestServer(t)
	seedCSSSession(t, srv, "throttle", bigCSS("throttle"))
	for i := 1; i < 3; i++ {
		writeChunk(t, srv, "throttle", i, []byte(`[{"type":3,"timestamp":2000,"data":{}}]`))
	}
	var progress []store.SessionExportProgress
	started := time.Now()
	err := srv.store.WriteSessionExportWithOptions(context.Background(), "throttle", io.Discard, store.SessionExportOptions{
		Throttle: true,
		Progress: func(p store.SessionExportProgress) { progress = append(progress, p) },
	})
	if err != nil || time.Since(started) < 50*time.Millisecond || len(progress) != 4 || progress[3].ChunksDone != 3 || progress[3].ChunksTotal != 3 {
		t.Fatalf("missing throttle/progress: %v %+v", err, progress)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	progress = nil
	err = srv.store.WriteSessionExportWithOptions(ctx, "throttle", io.Discard, store.SessionExportOptions{
		Throttle: true,
		Progress: func(p store.SessionExportProgress) {
			progress = append(progress, p)
			if p.ChunksDone == 1 {
				cancel()
			}
		},
	})
	if !errors.Is(err, context.Canceled) || progress[len(progress)-1].ChunksDone != 1 {
		t.Fatalf("cancellation did not interrupt the throttle: %v %+v", err, progress)
	}
}
