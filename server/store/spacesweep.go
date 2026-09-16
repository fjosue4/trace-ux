package store

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Disk budget: keep the store's own footprint under a fixed size by dropping the
// oldest recordings, as a backstop under the time-based RetentionSweep.
//
// The budget is measured against what TraceUX itself occupies, not against free
// space on the filesystem. That distinction matters: a free-space trigger fires
// when ANY service fills the disk, and the only lever this code has is deleting
// recordings -- which would destroy data to "fix" a problem it did not cause and
// cannot solve. A budget is always actionable, because exceeding it is by
// definition TraceUX's own doing.
//
// The whole feature turns on one SQLite detail. Recordings are BLOBs in the
// `chunks` table, so every byte of every replay lives inside trace_ux.db.
// Deleting rows moves their pages onto the database's freelist, where they are
// reused by later inserts -- but the FILE never shrinks, and the filesystem
// never sees a byte back. A sweep that only deleted rows would therefore free
// nothing, observe that it was still over budget, and delete again, until it had
// destroyed every recording and recovered nothing at all.
//
// So reclaiming is not an optimisation here, it is the point:
//
//   - the database must be auto_vacuum=incremental, which SQLite only accepts
//     BEFORE the first table exists (see OpenStore). On a database that is not,
//     this code refuses to delete anything and says so. A loud no-op beats
//     silent data loss.
//   - after each batch we checkpoint the WAL with TRUNCATE and run
//     incremental_vacuum, which hands the freed pages back to the filesystem
//     without the ~2x scratch space a full VACUUM needs -- space we would not
//     have, since running out of room is the reason we are here.

const (
	// Sessions deleted per batch. Small enough that the write lock is never
	// held long against the 10s busy_timeout the ingest path shares.
	spaceSweepBatch = 200

	// Hard ceiling on one sweep. Bounds the damage if the budget is set far
	// below what the traffic actually produces.
	spaceSweepMaxDelete = 5000
)

// AutoVacuumMode reports the database's auto_vacuum setting: 0 none, 1 full,
// 2 incremental. It is fixed when the database is created and cannot be changed
// later except by a full VACUUM.
func (s *Store) AutoVacuumMode() (int, error) {
	var mode int
	if err := s.DB.QueryRow(`PRAGMA auto_vacuum`).Scan(&mode); err != nil {
		return 0, err
	}
	return mode, nil
}

// StoreSize returns the bytes TraceUX occupies in dataDir.
//
// The -wal and -shm files count. The write-ahead log is real disk usage and can
// briefly exceed the database it belongs to, so a budget that ignored it would
// be one the store quietly overruns.
func StoreSize(dataDir string) (uint64, error) {
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return 0, err
	}
	var total uint64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := os.Stat(filepath.Join(dataDir, e.Name()))
		if err != nil {
			// A -wal vanishing under a checkpoint mid-walk is normal, not fatal.
			if os.IsNotExist(err) {
				continue
			}
			return 0, err
		}
		total += uint64(info.Size())
	}
	return total, nil
}

// SpaceSweepResult describes one budget pass.
type SpaceSweepResult struct {
	Ran          bool   // false when under budget, or when we refused to act
	Reason       string // why we stopped, or why we did not start
	SizeBefore   uint64
	SizeAfter    uint64
	Budget       uint64
	SessionsGone int64
	HitFloor     bool // stopped because the remaining recordings are too recent
	HitMaxDelete bool // stopped at the per-sweep ceiling
}

// SweepToBudget deletes the oldest sessions until the store's footprint in
// dataDir is back under maxBytes.
//
// floorDays is the protective floor: sessions newer than that are never deleted,
// however far over budget the store is. A budget set below what the traffic
// produces would otherwise delete recordings the moment they arrived, leaving a
// store that is permanently churning and never useful. Hitting the floor means
// the budget is too small for the traffic, and it is reported rather than
// swallowed so that shows up as a number to change instead of as missing data.
func (s *Store) SweepToBudget(dataDir string, maxBytes uint64, floorDays int) (SpaceSweepResult, error) {
	var res SpaceSweepResult
	res.Budget = maxBytes
	if maxBytes == 0 {
		res.Reason = "disabled"
		return res, nil
	}

	size, err := StoreSize(dataDir)
	if err != nil {
		return res, fmt.Errorf("sizing %s: %w", dataDir, err)
	}
	res.SizeBefore, res.SizeAfter = size, size
	if size <= maxBytes {
		res.Reason = "under budget"
		return res, nil
	}

	// Gate on reclaimability BEFORE deleting anything. On auto_vacuum=none the
	// deletes cannot return a single byte to the filesystem, so the sweep would
	// lose recordings and stay just as far over budget. The only honest move is
	// to refuse and let the operator see why.
	mode, err := s.AutoVacuumMode()
	if err != nil {
		return res, err
	}
	if mode != 2 {
		res.Reason = fmt.Sprintf(
			"refusing to prune: auto_vacuum=%d, so deleted pages cannot be returned "+
				"to the filesystem and pruning would lose recordings without freeing space "+
				"(fix: recreate the database with auto_vacuum=incremental, or run a full VACUUM)",
			mode)
		return res, nil
	}

	res.Ran = true
	floorCutoff := time.Now().AddDate(0, 0, -floorDays).Unix()

	for res.SizeAfter > maxBytes {
		if res.SessionsGone >= spaceSweepMaxDelete {
			res.HitMaxDelete = true
			res.Reason = "per-sweep delete ceiling reached; will continue next pass"
			break
		}
		out, err := s.DB.Exec(`DELETE FROM sessions WHERE id IN (
			SELECT id FROM sessions WHERE last_seen < ? ORDER BY last_seen ASC LIMIT ?
		)`, floorCutoff, spaceSweepBatch)
		if err != nil {
			return res, err
		}
		n, _ := out.RowsAffected()
		if n == 0 {
			res.HitFloor = true
			res.Reason = fmt.Sprintf(
				"still over budget with nothing older than the %d-day floor: the budget "+
					"is too small for this traffic", floorDays)
			break
		}
		res.SessionsGone += n

		// Stylesheets those sessions were the last to reference go too, or the
		// reclaim below frees less than the delete appeared to and the loop
		// keeps cutting, hunting bytes that are in fact still linked.
		if _, err := s.GCCSSAssets(); err != nil {
			return res, err
		}
		// Hand the pages back before re-measuring, or the loop reads a stale
		// "still over" and keeps deleting.
		if err := s.ReclaimFreePages(); err != nil {
			return res, err
		}
		if res.SizeAfter, err = StoreSize(dataDir); err != nil {
			return res, err
		}
	}

	if res.Reason == "" {
		res.Reason = "back under budget"
	}
	return res, nil
}

// ReclaimFreePages returns freed database pages to the filesystem.
//
// Three steps, and it needs all three. In WAL mode nothing a write does reaches
// the main database file until a checkpoint, so:
//
//  1. checkpoint, to fold the DELETEs in and put their pages on the freelist --
//     incremental_vacuum can only release pages it can actually see;
//  2. incremental_vacuum(0), to release the whole freelist;
//  3. checkpoint AGAIN, because step 2 is itself a write. Its truncation lands
//     in a fresh WAL, so stopping at step 2 leaves the main file exactly as big
//     as it was and the -wal bigger than before -- the store grows during the
//     sweep that was supposed to shrink it. A test pins this.
func (s *Store) ReclaimFreePages() error {
	if _, err := s.DB.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return fmt.Errorf("wal checkpoint: %w", err)
	}
	// Query, not Exec, and the rows must be drained.
	//
	// incremental_vacuum does its work as the statement is STEPPED, one freed
	// page per step. database/sql's Exec steps a no-result statement once and
	// stops, so `Exec("PRAGMA incremental_vacuum(0)")` returns nil error, looks
	// like it worked, and releases exactly one page. Measured on a 968-page
	// freelist: Exec recovered 4 KB, draining the statement recovered 3.8 MB.
	rows, err := s.DB.Query(`PRAGMA incremental_vacuum(0)`)
	if err != nil {
		return fmt.Errorf("incremental vacuum: %w", err)
	}
	for rows.Next() { //nolint:revive // stepping IS the work; there are no rows to read
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("incremental vacuum: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("incremental vacuum close: %w", err)
	}
	if _, err := s.DB.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return fmt.Errorf("wal checkpoint after vacuum: %w", err)
	}
	return nil
}
