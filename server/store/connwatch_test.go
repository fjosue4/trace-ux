package store

import (
	"bytes"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// The Logs page, the tracker's site lookup and dashboard auth must not queue
// behind a write that holds the single write connection.
func TestHotReadsDoNotWaitForWriteConnection(t *testing.T) {
	s, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	site, err := s.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}

	tx, err := s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE sites SET name = name WHERE id = ?`, site.ID); err != nil {
		t.Fatal(err)
	}

	reads := map[string]func() error{
		"ListLogs":     func() error { _, err := s.ListLogs(LogFilter{SiteID: site.ID}); return err },
		"LogStats":     func() error { _, err := s.LogStats(LogFilter{SiteID: site.ID}); return err },
		"LogOptions":   func() error { _, err := s.LogOptions(site.ID); return err },
		"GetLog":       func() error { _, err := s.GetLog(1); return err },
		"GetSiteByKey": func() error { _, err := s.GetSiteByKey(site.SiteKey); return err },
		"ListSites":    func() error { _, err := s.ListSites(); return err },
		"SiteName":     func() error { _, err := s.SiteName(site.ID); return err },
		"UserForToken": func() error { _, err := s.UserForToken("not-a-token"); return err },
	}
	for name, read := range reads {
		done := make(chan error, 1)
		go func() { done <- read() }()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("%s: %v", name, err)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("%s waited for the held write connection", name)
		}
	}
}

// holdWithSlowQuery keeps the write connection busy with a statement that
// runs for a while, standing in for whatever holds it in production.
func holdWithSlowQuery(s *Store) error {
	var n int64
	return s.DB.QueryRow(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 3000000)
		SELECT count(*) FROM c`).Scan(&n)
}

func TestWriteConnWatchReportsHolder(t *testing.T) {
	s, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.stopWriteConnWatch()

	var logs syncBuffer
	previous := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(previous)

	s.startWriteConnWatch(10*time.Millisecond, 50*time.Millisecond)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		if err := holdWithSlowQuery(s); err != nil {
			t.Error(err)
		}
	}()
	go func() {
		defer wg.Done()
		time.Sleep(20 * time.Millisecond)
		if _, err := s.DB.Exec(`UPDATE session_search_state SET error = error WHERE id = 1`); err != nil {
			t.Error(err)
		}
	}()
	wg.Wait()

	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(logs.String(), "free again") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	s.stopWriteConnWatch()

	out := logs.String()
	for _, want := range []string{"write connection busy for over 50ms", "request(s) waiting", "holdWithSlowQuery", "write connection free again after"} {
		if !strings.Contains(out, want) {
			t.Errorf("watchdog log missing %q:\n%s", want, out)
		}
	}
}

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
