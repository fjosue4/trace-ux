package store

import (
	"context"
	"fmt"
	"testing"
)

func TestSessionPaginationKeepsTimestampTiesAndSearchOrder(t *testing.T) {
	s, _ := newTestStore(t)
	if err := s.SetSearchIndexEnabled(false, "manual"); err != nil {
		t.Fatal(err)
	}
	waitForSearchState(t, s, "off")
	site, err := s.CreateSite("Pages", "https://pages.example")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateSite("Other", "https://other.example")
	if err != nil {
		t.Fatal(err)
	}
	// More than an FTS driver batch, with insertion order unrelated to ID order.
	tx, err := s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 543; i++ {
		n := (i * 37) % 543
		siteID := site.ID
		if n%7 == 0 {
			siteID = other.ID
		}
		device := "desktop"
		if n%2 == 0 {
			device = "mobile"
		}
		if _, err := tx.Exec(`INSERT INTO sessions
   (id, site_id, started_at, last_seen, duration_ms, device, initial_url)
   VALUES (?, ?, 200, 200, 2000, ?, 'https://pages.example/pagingneedle')`, fmt.Sprintf("page-%04d", n), siteID, device); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(`INSERT INTO sessions
  (id, site_id, started_at, last_seen, duration_ms, device, initial_url)
  VALUES ('old-session', ?, 100, 100, 2000, 'mobile', 'https://pages.example/pagingneedle')`, site.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	for _, indexed := range []bool{false, true} {
		name := "standard"
		if indexed {
			name = "indexed"
			if err := s.SetSearchIndexEnabled(true, "manual"); err != nil {
				t.Fatal(err)
			}
			waitForSearchState(t, s, "ready")
		}
		t.Run(name, func(t *testing.T) {
			for _, scope := range []SessionFilter{{}, {SiteID: site.ID, Device: "mobile"}} {
				f := scope
				f.Action = "pagingneedle"
				f.Limit = 1000
				expected, err := s.listSessionsStandard(context.Background(), f)
				if err != nil {
					t.Fatal(err)
				}
				f.Limit = 40
				var got []Session
				for page := 0; ; page++ {
					if page > 20 {
						t.Fatal("pagination did not finish")
					}
					rows, err := s.ListSessions(f)
					if err != nil {
						t.Fatal(err)
					}
					if len(rows) > 40 {
						t.Fatalf("page has %d rows, want at most 40", len(rows))
					}
					got = append(got, rows...)
					if len(rows) < 40 {
						break
					}
					last := rows[len(rows)-1]
					f.Before, f.BeforeID = last.StartedAt, last.ID
				}
				if len(got) != len(expected) {
					t.Fatalf("got %d sessions, want %d", len(got), len(expected))
				}
				for i := range expected {
					if got[i].ID != expected[i].ID {
						t.Fatalf("row %d = %s, want %s", i, got[i].ID, expected[i].ID)
					}
				}
			}
		})
	}
	legacy, err := s.ListSessions(SessionFilter{Before: 200, Limit: 40})
	if err != nil || len(legacy) != 1 || legacy[0].ID != "old-session" {
		t.Fatalf("legacy cursor: %+v, %v", legacy, err)
	}
	// The cursor stays usable after its recording is removed.
	if err := s.DeleteSession("page-0300"); err != nil {
		t.Fatal(err)
	}
	rows, err := s.ListSessions(SessionFilter{Before: 200, BeforeID: "page-0300", Limit: 40})
	if err != nil || len(rows) != 40 || rows[0].ID != "page-0299" {
		t.Fatalf("deleted cursor: %+v, %v", rows, err)
	}
}
