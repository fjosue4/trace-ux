package store

import (
	"context"
	"testing"
)

// Recordings shorter than a second open to "Replay unavailable", so the
// session lists leave them out. Actions play no part: a visit with only its
// entry page is listed as long as it lasted a second.
func TestListSessionsHidesRecordingsUnderASecond(t *testing.T) {
	s, _ := newTestStore(t)
	site, err := s.CreateSite("Listable", "https://listable.example")
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		id       string
		duration int64
	}{{"zero", 0}, {"almost", 999}, {"one-second", 1000}, {"long", 90_000}} {
		if _, err := s.DB.Exec(`INSERT INTO sessions (id, site_id, started_at, last_seen, duration_ms, page_count)
			VALUES (?, ?, 100, 100, ?, 1)`, row.id, site.ID, row.duration); err != nil {
			t.Fatal(err)
		}
		if _, err := s.DB.Exec(`INSERT INTO pages (session_id, idx, url, title, entered_at)
			VALUES (?, 0, 'https://listable.example/', '', 100)`, row.id); err != nil {
			t.Fatal(err)
		}
	}

	got, err := s.ListSessionsContext(context.Background(), SessionFilter{SiteID: site.ID, Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	listed := map[string]bool{}
	for _, session := range got {
		listed[session.ID] = true
	}
	if len(got) != 2 || !listed["one-second"] || !listed["long"] {
		t.Fatalf("listed %v, want only the sessions of at least one second", listed)
	}
}
