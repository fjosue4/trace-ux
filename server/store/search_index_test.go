package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

func waitForSearchState(t *testing.T, s *Store, want string) searchIndexState {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		st, err := s.readSearchIndexState(s.DB)
		if err == nil && st.state == want && st.errText == "" {
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
	st, err := s.readSearchIndexState(s.DB)
	t.Fatalf("search state = %+v, err = %v; want %s", st, err, want)
	return searchIndexState{}
}

func TestSearchIndexDefaultDependsOnInstallType(t *testing.T) {
	t.Run("fresh install is enabled", func(t *testing.T) {
		s, err := OpenStore(filepath.Join(t.TempDir(), "fresh.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()

		st, err := s.readSearchIndexState(s.DB)
		if err != nil {
			t.Fatal(err)
		}
		if !st.enabled {
			t.Fatal("fresh install should enable the search index")
		}
	})

	t.Run("upgrade from v27 is disabled", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "upgrade.db")
		db, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`CREATE TABLE schema_version (version INTEGER NOT NULL)`); err != nil {
			t.Fatal(err)
		}
		for v := 0; v < sessionSearchMigrationVersion-1; v++ {
			if _, err := db.Exec(migrations[v]); err != nil {
				t.Fatalf("migration %d: %v", v+1, err)
			}
			if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (?)`, v+1); err != nil {
				t.Fatal(err)
			}
		}
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}

		s, err := OpenStore(path)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()

		st, err := s.readSearchIndexState(s.DB)
		if err != nil {
			t.Fatal(err)
		}
		if st.enabled || st.state != "off" {
			t.Fatalf("upgraded install search state = %+v; want disabled and off", st)
		}
	})
}

func TestSearchIndexBuildSyncAndToggle(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(filepath.Join(dir, "search.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })

	if err := s.SetSearchIndexEnabled(false, "manual"); err != nil {
		t.Fatal(err)
	}
	waitForSearchState(t, s, "off")

	site, err := s.CreateSite("Search", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`INSERT INTO sessions
		(id, site_id, started_at, last_seen, initial_url, exit_url)
		VALUES ('indexed-session', ?, 100, 100, 'https://example.com/entryneedle', '')`, site.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`INSERT INTO pages (session_id, idx, url, title, entered_at)
		VALUES ('indexed-session', 0, 'https://example.com/oldneedle', 'Old needle', 100)`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`INSERT INTO custom_events (session_id, ts, name, track_id)
		VALUES ('indexed-session', 100000, 'eventneedle', 'button')`); err != nil {
		t.Fatal(err)
	}

	if err := s.SetSearchIndexEnabled(true, "manual"); err != nil {
		t.Fatal(err)
	}
	waitForSearchState(t, s, "ready")

	assertSearch := func(term string, want int) {
		t.Helper()
		got, err := s.ListSessionsContext(context.Background(), SessionFilter{Action: term, Limit: 50})
		if err != nil {
			t.Fatalf("search %q: %v", term, err)
		}
		if len(got) != want {
			t.Fatalf("search %q returned %d sessions, want %d", term, len(got), want)
		}
	}
	assertSearch("entryneedle", 1)
	assertSearch("oldneedle", 1)
	assertSearch("entryneedle eventneedle", 1)
	assertSearch("entryneedle:missing", 0)

	if _, err := s.DB.Exec(`UPDATE pages SET url = 'https://example.com/newneedle', title = 'New needle'
		WHERE session_id = 'indexed-session' AND idx = 0`); err != nil {
		t.Fatal(err)
	}
	assertSearch("oldneedle", 0)
	assertSearch("newneedle", 1)

	res, err := s.DB.Exec(`INSERT INTO logs
		(site_id, session_id, client_seq, timestamp_ms, severity, message, created_at)
		VALUES (?, 'indexed-session', 1, 100000, 'error', 'logneedle appeared', 100)`, site.ID)
	if err != nil {
		t.Fatal(err)
	}
	logID, _ := res.LastInsertId()
	assertSearch("logneedle", 1)
	assertSearch("logs", 1) // category aliases deliberately use the standard path
	if _, err := s.DB.Exec(`DELETE FROM logs WHERE id = ?`, logID); err != nil {
		t.Fatal(err)
	}
	assertSearch("logneedle", 0)

	resSweep, err := s.SweepToBudget(dir, 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	if resSweep.SessionsGone != 0 || resSweep.Reason != "removing session search index before pruning recordings" {
		t.Fatalf("first low-disk sweep = %+v; it must remove the derived index before recordings", resSweep)
	}
	waitForSearchState(t, s, "off")
	var sessions int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 1 {
		t.Fatalf("low-disk index removal deleted %d session(s)", 1-sessions)
	}
	status, err := s.SearchIndexStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.Reason != "low_disk" || status.Enabled {
		t.Fatalf("low-disk status = %+v", status)
	}
	assertSearch("newneedle", 1)
}
