package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func statSize(p string) (uint64, error) {
	fi, err := os.Stat(p)
	if err != nil {
		return 0, err
	}
	return uint64(fi.Size()), nil
}

// seedSessions writes n sessions, each carrying one ~chunkKB chunk. The newest
// is `newestAgo` before now and the rest step back by `spacing`, so a caller can
// lay a fixture either side of the floor: hours to keep everything inside it,
// days to put it all beyond.
func seedSessions(t *testing.T, s *Store, siteID int64, n, chunkKB int, newestAgo, spacing time.Duration) {
	t.Helper()
	blob := make([]byte, chunkKB*1024)
	for i := range blob {
		// Incompressible-ish content so the file actually grows; a run of zeros
		// would let SQLite's page layout hide the size we are trying to measure.
		blob[i] = byte(i * 31 % 251)
	}
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("sess-%04d", i)
		// i=0 is the OLDEST.
		ts := time.Now().Add(-newestAgo - time.Duration(n-1-i)*spacing).Unix()
		if _, err := s.DB.Exec(`INSERT INTO sessions (id, site_id, started_at, last_seen)
			VALUES (?, ?, ?, ?)`, id, siteID, ts, ts); err != nil {
			t.Fatalf("insert session %s: %v", id, err)
		}
		if _, err := s.DB.Exec(`INSERT INTO chunks (session_id, seq, events, data, created_at)
			VALUES (?, 0, 1, ?, ?)`, id, blob, ts); err != nil {
			t.Fatalf("insert chunk %s: %v", id, err)
		}
	}
}

func newTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	s, err := OpenStore(filepath.Join(dir, "trace_ux.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { s.DB.Close() })
	return s, dir
}

// A fresh database must be auto_vacuum=incremental. Everything else here
// depends on it, and SQLite will only accept it before the first table exists --
// so if this regresses, the budget sweep silently degrades to refusing to run.
func TestFreshStoreIsIncrementalAutoVacuum(t *testing.T) {
	s, _ := newTestStore(t)
	mode, err := s.AutoVacuumMode()
	if err != nil {
		t.Fatalf("AutoVacuumMode: %v", err)
	}
	if mode != 2 {
		t.Fatalf("auto_vacuum = %d, want 2 (incremental); disk budget pruning cannot reclaim without it", mode)
	}
}

// The safety gate. On a database that cannot hand pages back, deleting
// recordings would lose data and free nothing -- so it must delete nothing.
func TestSweepRefusesWhenItCannotReclaim(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "legacy.db")

	// Build a database the way an older install looks: tables created without
	// the pragma, so auto_vacuum stays 0 and is then unchangeable.
	raw, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("open raw: %v", err)
	}
	if _, err := raw.Exec(`CREATE TABLE placeholder (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatalf("seed legacy table: %v", err)
	}
	raw.Close()

	s, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	defer s.DB.Close()

	if mode, _ := s.AutoVacuumMode(); mode == 2 {
		t.Skip("this SQLite build upgraded auto_vacuum on an existing file; gate is untestable here")
	}

	site, err := s.CreateSite("t", "https://example.com")
	if err != nil {
		t.Fatalf("CreateSite: %v", err)
	}
	seedSessions(t, s, site.ID, 20, 64, 30*24*time.Hour, 24*time.Hour)

	var before int
	s.DB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&before)

	// Budget of 1 byte: maximally over budget, so only the gate can stop it.
	res, err := s.SweepToBudget(dir, 1, 0)
	if err != nil {
		t.Fatalf("SweepToBudget: %v", err)
	}
	if res.Ran || res.SessionsGone != 0 {
		t.Fatalf("sweep deleted %d session(s) on a database it cannot reclaim from; want 0 (%s)",
			res.SessionsGone, res.Reason)
	}
	var after int
	s.DB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&after)
	if after != before {
		t.Fatalf("sessions %d -> %d; refusal must not delete", before, after)
	}
}

// Over budget: oldest go first, the file actually shrinks, newer survive.
func TestSweepToBudgetDeletesOldestAndShrinksFile(t *testing.T) {
	s, dir := newTestStore(t)
	site, err := s.CreateSite("t", "https://example.com")
	if err != nil {
		t.Fatalf("CreateSite: %v", err)
	}
	// More sessions than spaceSweepBatch, so the sweep has to stop part-way and
	// we can see WHICH ones it chose. All are 30+ days old, past any floor.
	seedSessions(t, s, site.ID, 300, 16, 30*24*time.Hour, 24*time.Hour)
	if err := s.ReclaimFreePages(); err != nil {
		t.Fatalf("checkpoint: %v", err)
	}

	before, err := StoreSize(dir)
	if err != nil {
		t.Fatalf("StoreSize: %v", err)
	}
	if before < 2<<20 {
		t.Fatalf("fixture too small to be meaningful: %d bytes", before)
	}

	budget := before / 2
	res, err := s.SweepToBudget(dir, budget, 7) // all fixtures are 30+ days old
	if err != nil {
		t.Fatalf("SweepToBudget: %v", err)
	}
	if !res.Ran {
		t.Fatalf("sweep did not run: %s", res.Reason)
	}
	if res.SessionsGone == 0 {
		t.Fatalf("nothing deleted while over budget (%s)", res.Reason)
	}

	// The point of the whole exercise: the file is smaller on disk, not merely
	// emptier inside.
	after, _ := StoreSize(dir)
	if after >= before {
		t.Fatalf("store did not shrink: %d -> %d bytes", before, after)
	}
	if after > budget {
		t.Fatalf("still over budget after sweep: %d > %d (%s)", after, budget, res.Reason)
	}

	var survivors int
	s.DB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&survivors)
	if survivors == 0 {
		t.Fatal("sweep deleted every session; it should stop once back under budget")
	}

	// Oldest-first, checked by identity rather than by count: sess-0000 is the
	// oldest and sess-0299 the newest, so the sweep must have taken the former
	// and kept the latter. A sweep deleting an arbitrary subset would still
	// satisfy a size assertion.
	var oldestGone, newestKept int
	s.DB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = 'sess-0000'`).Scan(&oldestGone)
	s.DB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = 'sess-0299'`).Scan(&newestKept)
	if oldestGone != 0 {
		t.Error("the oldest session survived; the sweep is not deleting oldest-first")
	}
	if newestKept != 1 {
		t.Error("the newest session was deleted while older ones remained")
	}
	var orphanChunks int
	s.DB.QueryRow(`SELECT COUNT(*) FROM chunks c
		LEFT JOIN sessions s ON s.id = c.session_id WHERE s.id IS NULL`).Scan(&orphanChunks)
	if orphanChunks != 0 {
		t.Fatalf("%d orphaned chunk(s) left behind; the cascade did not fire", orphanChunks)
	}
}

// The floor wins over the budget. A budget smaller than the traffic must not
// eat recent recordings -- it must stop and say the budget is wrong.
func TestSweepStopsAtFloorAndReportsIt(t *testing.T) {
	s, dir := newTestStore(t)
	site, err := s.CreateSite("t", "https://example.com")
	if err != nil {
		t.Fatalf("CreateSite: %v", err)
	}
	// All inside the last ~40 hours, so a 3-day floor protects every one of them.
	seedSessions(t, s, site.ID, 40, 64, time.Minute, time.Hour)
	if err := s.ReclaimFreePages(); err != nil {
		t.Fatalf("checkpoint: %v", err)
	}

	var before int
	s.DB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&before)

	res, err := s.SweepToBudget(dir, 1, 3) // 1-byte budget: as over as it gets
	if err != nil {
		t.Fatalf("SweepToBudget: %v", err)
	}
	if !res.HitFloor {
		t.Fatalf("expected the floor to stop the sweep, got: %s", res.Reason)
	}
	if res.SessionsGone != 0 {
		t.Fatalf("deleted %d session(s) inside the floor window; want 0", res.SessionsGone)
	}
	var after int
	s.DB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&after)
	if after != before {
		t.Fatalf("sessions %d -> %d; the floor must protect recent recordings", before, after)
	}
}

func TestSweepDisabledAndUnderBudgetAreNoOps(t *testing.T) {
	s, dir := newTestStore(t)
	site, _ := s.CreateSite("t", "https://example.com")
	seedSessions(t, s, site.ID, 5, 16, 30*24*time.Hour, 24*time.Hour)

	res, err := s.SweepToBudget(dir, 0, 3)
	if err != nil {
		t.Fatalf("disabled: %v", err)
	}
	if res.Ran || res.Reason != "disabled" {
		t.Fatalf("maxBytes=0 should disable the sweep, got ran=%v %q", res.Ran, res.Reason)
	}

	res, err = s.SweepToBudget(dir, 100<<30, 3)
	if err != nil {
		t.Fatalf("under budget: %v", err)
	}
	if res.Ran || res.Reason != "under budget" {
		t.Fatalf("a 100 GiB budget should be a no-op, got ran=%v %q", res.Ran, res.Reason)
	}
}

// The -wal counts toward the budget: it is real disk usage and can briefly
// exceed the database itself.
func TestStoreSizeIncludesWAL(t *testing.T) {
	s, dir := newTestStore(t)
	site, _ := s.CreateSite("t", "https://example.com")
	seedSessions(t, s, site.ID, 20, 64, 30*24*time.Hour, 24*time.Hour)

	size, err := StoreSize(dir)
	if err != nil {
		t.Fatalf("StoreSize: %v", err)
	}
	var dbOnly uint64
	if fi, err := statSize(filepath.Join(dir, "trace_ux.db")); err == nil {
		dbOnly = fi
	}
	if size < dbOnly {
		t.Fatalf("StoreSize %d is smaller than the database alone %d", size, dbOnly)
	}
}
