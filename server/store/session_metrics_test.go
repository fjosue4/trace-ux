package store

import (
	"context"
	"testing"
)

func TestSessionMetricsMatchReplaySurface(t *testing.T) {
	s, _ := newTestStore(t)
	site, err := s.CreateSite("Metrics", "https://metrics.example")
	if err != nil {
		t.Fatal(err)
	}

	const sessionID = "session-metrics"
	if _, err := s.DB.Exec(`INSERT INTO sessions
		(id, site_id, started_at, last_seen, duration_ms, page_count, event_count)
		VALUES (?, ?, 100, 2412, 1258436, 1, 20)`, sessionID, site.ID); err != nil {
		t.Fatal(err)
	}
	for seq, createdAt := range []int64{100, 2409} {
		if _, err := s.DB.Exec(`INSERT INTO chunks (session_id, seq, events, data, created_at)
			VALUES (?, ?, 10, X'', ?)`, sessionID, seq, createdAt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.DB.Exec(`INSERT INTO pages (session_id, idx, url, entered_at)
		VALUES (?, 0, 'https://metrics.example', 100)`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`INSERT INTO custom_events (session_id, ts, name)
		VALUES (?, 150000, 'Clicked')`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`INSERT INTO logs
		(site_id, session_id, timestamp_ms, severity, message, created_at)
		VALUES (?, ?, 200000, 'info', 'Connected', 200)`, site.ID, sessionID); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetSession(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if got.DurationMs != 2309000 {
		t.Fatalf("duration_ms = %d, want recording span 2309000", got.DurationMs)
	}
	if got.ActionCount != 3 {
		t.Fatalf("action_count = %d, want page + custom event + log = 3", got.ActionCount)
	}

	rows, err := s.ListSessionsContext(context.Background(), SessionFilter{MinDurationMs: 2000000, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].DurationMs != got.DurationMs || rows[0].ActionCount != got.ActionCount {
		t.Fatalf("list metrics do not match detail: %+v", rows)
	}
}
