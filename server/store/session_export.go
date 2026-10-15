package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// sessionReader lets the replay and export share queries. Exports use a read
// transaction on the WAL reader pool so ingest can continue during a snapshot.
type sessionReader struct {
	DB interface {
		Query(string, ...any) (*sql.Rows, error)
		QueryRow(string, ...any) *sql.Row
	}
}

type exportQueryer struct {
	ctx context.Context
	tx  *sql.Tx
}

func (q exportQueryer) Query(query string, args ...any) (*sql.Rows, error) {
	return q.tx.QueryContext(q.ctx, query, args...)
}

func (q exportQueryer) QueryRow(query string, args ...any) *sql.Row {
	return q.tx.QueryRowContext(q.ctx, query, args...)
}

type SessionExportProgress struct {
	ChunksDone  int `json:"chunks_done"`
	ChunksTotal int `json:"chunks_total"`
}

type SessionExportOptions struct {
	Progress func(SessionExportProgress)
	Throttle bool
}

type ExportSite struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

// SessionExport contains only data belonging to this recording. Site settings,
// API keys, integrations and dashboard credentials are deliberately absent.
// Events are written separately, one chunk at a time, to bound memory usage.
type SessionExport struct {
	Format          string            `json:"format"`
	SchemaVersion   int               `json:"schema_version"`
	RecordingFormat string            `json:"recording_format"`
	FormatGuide     ExportFormatGuide `json:"format_guide"`
	ExportedAt      time.Time         `json:"exported_at"`
	Session         *Session          `json:"session"`
	Site            ExportSite        `json:"site"`
	Pages           []SessionPage     `json:"pages"`
	CustomEvents    []CustomEvent     `json:"custom_events"`
	Logs            []Log             `json:"logs"`
	Tickets         []TicketThread    `json:"tickets"`
	Feedback        []Feedback        `json:"feedback"`
}

// WriteSessionExport writes one consistent database snapshot as JSON. A caller
// should stage the output before serving it, so corrupt chunks or missing CSS
// cannot result in a successful download containing a partial JSON document.
// For active recordings this includes everything committed at the first read;
// data arriving after that boundary belongs to a later export.
func (s *Store) WriteSessionExport(ctx context.Context, id string, dst io.Writer) error {
	return s.WriteSessionExportWithOptions(ctx, id, dst, SessionExportOptions{})
}

func (s *Store) WriteSessionExportWithOptions(ctx context.Context, id string, dst io.Writer, options SessionExportOptions) error {
	tx, err := s.readDB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	reader := sessionReader{exportQueryer{ctx, tx}}
	sess, err := reader.GetSession(id)
	if err != nil {
		return err
	}
	out := SessionExport{
		Format: "traceux-session-export", SchemaVersion: 1, RecordingFormat: "rrweb",
		FormatGuide: sessionExportGuide(), ExportedAt: time.Now().UTC(), Session: sess, Tickets: []TicketThread{},
	}
	if err := tx.QueryRowContext(ctx, `SELECT id, name, url FROM sites WHERE id = ?`, sess.SiteID).
		Scan(&out.Site.ID, &out.Site.Name, &out.Site.URL); err != nil {
		return err
	}
	out.Session.SiteName = out.Site.Name
	if out.Pages, err = reader.GetSessionPages(id); err != nil {
		return err
	}
	if out.CustomEvents, err = reader.GetCustomEvents(id); err != nil {
		return err
	}
	// -1 removes the replay sidebar's log cap for the downloadable snapshot.
	if out.Logs, err = reader.getSessionLogs(id, -1); err != nil {
		return err
	}
	tickets, err := reader.ListTicketsBySession(id)
	if err != nil {
		return err
	}
	for _, ticket := range tickets {
		messages, err := reader.ListTicketMessages(ticket.ID)
		if err != nil {
			return err
		}
		out.Tickets = append(out.Tickets, TicketThread{Ticket: ticket, Messages: messages})
	}
	if out.Feedback, err = reader.ListFeedbackBySession(id); err != nil {
		return err
	}
	seqs, err := reader.GetSessionChunkSeqs(id)
	if err != nil {
		return err
	}
	progress := SessionExportProgress{ChunksTotal: len(seqs)}
	if options.Progress != nil {
		options.Progress(progress)
	}
	metadata, err := json.Marshal(out)
	if err != nil {
		return err
	}
	if _, err := dst.Write(metadata[:len(metadata)-1]); err != nil {
		return err
	}
	if _, err := io.WriteString(dst, ",\"events\":[\n"); err != nil {
		return err
	}
	first := true
	for _, seq := range seqs {
		started := time.Now()
		if err := ctx.Err(); err != nil {
			return err
		}
		// Expands deduplicated stylesheets so this file needs no TraceUX API.
		events, err := reader.GetSessionChunk(id, seq)
		if err != nil {
			return fmt.Errorf("export chunk %d: %w", seq, err)
		}
		for _, event := range events {
			if !first {
				if _, err := io.WriteString(dst, ",\n"); err != nil {
					return err
				}
			}
			if _, err := dst.Write(event); err != nil {
				return err
			}
			first = false
		}
		progress.ChunksDone++
		if options.Progress != nil {
			options.Progress(progress)
		}
		if options.Throttle && progress.ChunksDone < progress.ChunksTotal {
			// Target roughly 25% duty cycle for preparation: a busy chunk gets
			// three times its processing time off, with at least 25ms between
			// even tiny chunks. Cancellation interrupts the pause immediately.
			timer := time.NewTimer(max(25*time.Millisecond, 3*time.Since(started)))
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
	if _, err := io.WriteString(dst, "\n]}\n"); err != nil {
		return err
	}
	return tx.Commit()
}
