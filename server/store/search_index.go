package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"runtime"
	"time"
)

const (
	searchIndexInitialBatch = 25
	searchIndexMaxBatch     = 100
	searchDropBatchRows     = 25_000
	searchItemFirstDynamic  = int64(10_002)
	searchItemMax           = int64(0xFFFFFF)
)

var searchIndexTriggers = []string{
	"session_search_sessions_insert",
	"session_search_sessions_update",
	"session_search_sessions_delete",
	"session_search_pages_insert",
	"session_search_pages_update",
	"session_search_pages_delete",
	"session_search_events_insert",
	"session_search_logs_insert",
	"session_search_logs_delete",
}

// SearchIndexStatus is returned to the admin settings page. Enabled is the
// desired state; State is the worker's current state.
type SearchIndexStatus struct {
	State         string `json:"state"`
	Enabled       bool   `json:"enabled"`
	SessionsDone  int64  `json:"sessions_done"`
	SessionsTotal int64  `json:"sessions_total"`
	Bytes         int64  `json:"bytes"`
	BytesFreed    int64  `json:"bytes_freed"`
	StartedAt     int64  `json:"started_at"`
	ETASeconds    int64  `json:"eta_seconds"`
	Reason        string `json:"reason"`
	ReasonAt      int64  `json:"reason_at"`
	Overflowed    bool   `json:"overflowed"`
	Error         string `json:"error"`
}

type searchIndexState struct {
	enabled              bool
	state                string
	reason               string
	cutoffPages          int64
	cutoffEvents         int64
	cutoffLogs           int64
	cutoffSessionRowID   int64
	nextSessionRowID     int64
	sessionsDone         int64
	sessionsTotal        int64
	overflowed           bool
	overflowSessionRowID int64
	dropBytesStart       int64
	startedAt            int64
	reasonAt             int64
	errText              string
}

func scanSearchIndexState(row interface{ Scan(...any) error }) (searchIndexState, error) {
	var st searchIndexState
	var enabled, overflowed int
	err := row.Scan(
		&enabled, &st.state, &st.reason,
		&st.cutoffPages, &st.cutoffEvents, &st.cutoffLogs, &st.cutoffSessionRowID,
		&st.nextSessionRowID, &st.sessionsDone, &st.sessionsTotal,
		&overflowed, &st.overflowSessionRowID, &st.dropBytesStart,
		&st.startedAt, &st.reasonAt, &st.errText,
	)
	st.enabled = enabled != 0
	st.overflowed = overflowed != 0
	return st, err
}

const searchIndexStateSelect = `SELECT enabled, state, reason,
	cutoff_pages, cutoff_events, cutoff_logs, cutoff_session_rowid,
	next_session_rowid, sessions_done, sessions_total,
	overflowed, overflow_session_rowid, drop_bytes_start,
	started_at, reason_at, error
	FROM session_search_state WHERE id = 1`

func (s *Store) readSearchIndexState(q interface{ QueryRow(string, ...any) *sql.Row }) (searchIndexState, error) {
	return scanSearchIndexState(q.QueryRow(searchIndexStateSelect))
}

func (s *Store) searchIndexBytes(ctx context.Context) int64 {
	s.searchBytesMu.Lock()
	defer s.searchBytesMu.Unlock()
	if !s.searchBytesAt.IsZero() && time.Since(s.searchBytesAt) < time.Minute {
		return s.searchBytes
	}
	var bytes int64
	// dbstat includes the FTS shadow tables and the log mapping table. Some
	// unusual SQLite builds omit dbstat; size is informational, so that should
	// not make the control endpoint fail.
	err := s.readDB.QueryRowContext(ctx, `SELECT COALESCE(SUM(pgsize), 0)
		FROM dbstat WHERE name LIKE 'session_search%'`).Scan(&bytes)
	if err != nil {
		return 0
	}
	s.searchBytes = bytes
	s.searchBytesAt = time.Now()
	return bytes
}

func (s *Store) invalidateSearchIndexBytes() {
	s.searchBytesMu.Lock()
	s.searchBytesAt = time.Time{}
	s.searchBytesMu.Unlock()
}

func (s *Store) SearchIndexStatus(ctx context.Context) (SearchIndexStatus, error) {
	st, err := scanSearchIndexState(s.readDB.QueryRowContext(ctx, searchIndexStateSelect))
	if err != nil {
		return SearchIndexStatus{}, err
	}
	bytes := s.searchIndexBytes(ctx)
	status := SearchIndexStatus{
		State:         st.state,
		Enabled:       st.enabled,
		SessionsDone:  st.sessionsDone,
		SessionsTotal: st.sessionsTotal,
		Bytes:         bytes,
		StartedAt:     st.startedAt,
		Reason:        st.reason,
		ReasonAt:      st.reasonAt,
		Overflowed:    st.overflowed,
		Error:         st.errText,
	}
	if st.dropBytesStart > bytes {
		status.BytesFreed = st.dropBytesStart - bytes
	}
	if st.state == "building" && st.sessionsDone > 0 && st.sessionsDone < st.sessionsTotal && st.startedAt > 0 {
		elapsed := time.Now().Unix() - st.startedAt
		if elapsed > 0 {
			status.ETASeconds = elapsed * (st.sessionsTotal - st.sessionsDone) / st.sessionsDone
		}
	}
	return status, nil
}

func (s *Store) wakeSearchIndexWorker() {
	select {
	case s.searchWake <- struct{}{}:
	default:
	}
}

func (s *Store) startSearchIndexWorker() {
	s.searchWake = make(chan struct{}, 1)
	s.searchStop = make(chan struct{})
	s.searchDone = make(chan struct{})
	go s.searchIndexWorker()
	s.wakeSearchIndexWorker()
}

func (s *Store) searchIndexWorker() {
	defer close(s.searchDone)
	failures := 0
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	for {
		select {
		case <-s.searchStop:
			return
		case <-s.searchWake:
		case <-timer.C:
		}

		started := time.Now()
		active, err := s.runSearchIndexStep()
		if err != nil {
			failures++
			log.Printf("session search index: %v", err)
			if failures < 3 {
				backoff := time.Second
				if failures == 2 {
					backoff = 5 * time.Second
				}
				timer.Reset(backoff)
				continue
			}
			s.recordSearchIndexError(err)
			failures = 0
			continue
		}
		failures = 0
		if !active {
			continue
		}
		wait := 250 * time.Millisecond
		if duty := time.Since(started) * 4; duty > wait {
			wait = duty
		}
		timer.Reset(wait)
	}
}

func (s *Store) runSearchIndexStep() (bool, error) {
	s.searchMu.Lock()
	defer s.searchMu.Unlock()

	st, err := s.readSearchIndexState(s.DB)
	if err != nil {
		return false, err
	}
	if st.errText != "" {
		return false, nil
	}
	switch st.state {
	case "off":
		if !st.enabled {
			return false, nil
		}
		return true, s.startSearchIndexBuild()
	case "building":
		if !st.enabled {
			return true, s.startSearchIndexDrop()
		}
		if last := s.lastIngest.Load(); last > 0 && time.Since(time.Unix(0, last)) < time.Second {
			return true, nil
		}
		if searchIndexHostBusy() {
			return true, nil
		}
		batchSize := s.searchBatch
		if batchSize <= 0 {
			batchSize = searchIndexInitialBatch
		}
		started := time.Now()
		done, err := s.buildSearchIndexBatch(st, batchSize)
		if err == nil && !done {
			switch elapsed := time.Since(started); {
			case elapsed > 50*time.Millisecond && batchSize > 1:
				s.searchBatch = max(1, batchSize/2)
			case elapsed < 20*time.Millisecond && batchSize < searchIndexMaxBatch:
				s.searchBatch = min(searchIndexMaxBatch, batchSize+5)
			}
		}
		return !done, err
	case "ready":
		if st.enabled {
			return false, nil
		}
		return true, s.startSearchIndexDrop()
	case "dropping":
		if searchIndexHostBusy() {
			return true, nil
		}
		done, err := s.dropSearchIndexBatch(st)
		if err != nil {
			return false, err
		}
		if done && st.enabled {
			return true, nil
		}
		return !done, nil
	default:
		return false, fmt.Errorf("unknown search index state %q", st.state)
	}
}

func searchIndexHostBusy() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return false
	}
	var load1 float64
	if _, err := fmt.Sscanf(string(data), "%f", &load1); err != nil {
		return false
	}
	return load1 > float64(runtime.NumCPU())
}

func (s *Store) recordSearchIndexError(cause error) {
	s.searchMu.Lock()
	defer s.searchMu.Unlock()
	_, _ = s.DB.Exec(`UPDATE session_search_state SET error = ? WHERE id = 1`, cause.Error())
}

func (s *Store) SetSearchIndexEnabled(enabled bool, reason string) error {
	if reason == "" {
		reason = "manual"
	}
	now := time.Now().Unix()
	if enabled {
		_, err := s.DB.Exec(`UPDATE session_search_state
			SET enabled = 1, reason = '', reason_at = 0, error = '' WHERE id = 1`)
		if err != nil {
			return err
		}
	} else {
		_, err := s.DB.Exec(`UPDATE session_search_state
			SET enabled = 0, reason = ?, reason_at = ?, error = '' WHERE id = 1`, reason, now)
		if err != nil {
			return err
		}
	}
	s.wakeSearchIndexWorker()
	return nil
}

// DisableSearchIndexForLowDisk returns true while an index exists or is being
// removed. Callers must re-measure after it reaches off before deleting data.
func (s *Store) DisableSearchIndexForLowDisk() (bool, error) {
	st, err := s.readSearchIndexState(s.DB)
	if err != nil {
		return false, err
	}
	if st.state == "off" && !st.enabled {
		return false, nil
	}
	if err := s.SetSearchIndexEnabled(false, "low_disk"); err != nil {
		return false, err
	}
	return true, nil
}

func dropSearchTriggers(tx *sql.Tx) error {
	for _, name := range searchIndexTriggers {
		if _, err := tx.Exec(`DROP TRIGGER IF EXISTS ` + name); err != nil {
			return err
		}
	}
	return nil
}

func createSearchTriggers(tx *sql.Tx) error {
	if err := dropSearchTriggers(tx); err != nil {
		return err
	}
	_, err := tx.Exec(`
	CREATE TRIGGER session_search_sessions_insert AFTER INSERT ON sessions BEGIN
		INSERT INTO session_search(rowid, body)
		VALUES ((NEW.rowid << 24), NEW.initial_url || ' ' || NEW.exit_url);
	END;
	CREATE TRIGGER session_search_sessions_update
	AFTER UPDATE OF initial_url, exit_url ON sessions
	WHEN OLD.initial_url IS NOT NEW.initial_url OR OLD.exit_url IS NOT NEW.exit_url BEGIN
		DELETE FROM session_search WHERE rowid = (NEW.rowid << 24);
		INSERT INTO session_search(rowid, body)
		VALUES ((NEW.rowid << 24), NEW.initial_url || ' ' || NEW.exit_url);
	END;
	CREATE TRIGGER session_search_sessions_delete AFTER DELETE ON sessions BEGIN
		DELETE FROM session_search
		WHERE rowid BETWEEN (OLD.rowid << 24) AND ((OLD.rowid << 24) | 0xFFFFFF);
		UPDATE session_search_state
		SET sessions_total = MAX(sessions_done, sessions_total - 1)
		WHERE id = 1 AND state = 'building'
		  AND OLD.rowid > next_session_rowid AND OLD.rowid <= cutoff_session_rowid;
	END;

	CREATE TRIGGER session_search_pages_insert AFTER INSERT ON pages BEGIN
		INSERT INTO session_search(rowid, body)
		SELECT (s.rowid << 24) | (NEW.idx + 1), NEW.url || ' ' || NEW.title
		FROM sessions s WHERE s.id = NEW.session_id;
	END;
	CREATE TRIGGER session_search_pages_update AFTER UPDATE OF url, title ON pages
	WHEN OLD.url IS NOT NEW.url OR OLD.title IS NOT NEW.title BEGIN
		DELETE FROM session_search WHERE rowid =
			((SELECT rowid FROM sessions WHERE id = NEW.session_id) << 24) | (NEW.idx + 1);
		INSERT INTO session_search(rowid, body)
		SELECT (s.rowid << 24) | (NEW.idx + 1), NEW.url || ' ' || NEW.title
		FROM sessions s WHERE s.id = NEW.session_id;
	END;
	CREATE TRIGGER session_search_pages_delete AFTER DELETE ON pages BEGIN
		DELETE FROM session_search WHERE rowid =
			((SELECT rowid FROM sessions WHERE id = OLD.session_id) << 24) | (OLD.idx + 1);
	END;

	CREATE TRIGGER session_search_events_insert AFTER INSERT ON custom_events BEGIN
		INSERT INTO session_search(rowid, body)
		SELECT MAX(
			COALESCE((SELECT MAX(ss.rowid) FROM session_search ss
				WHERE ss.rowid BETWEEN (s.rowid << 24) AND ((s.rowid << 24) | 0xFFFFFF)),
				(s.rowid << 24) + 10001),
			(s.rowid << 24) + 10001
		) + 1, NEW.name || ' ' || NEW.track_id
		FROM sessions s
		WHERE s.id = NEW.session_id
		  AND (SELECT overflowed FROM session_search_state WHERE id = 1) = 0
		  AND COALESCE((SELECT MAX(ss.rowid) FROM session_search ss
			WHERE ss.rowid BETWEEN (s.rowid << 24) AND ((s.rowid << 24) | 0xFFFFFF)),
			(s.rowid << 24) + 10001) < ((s.rowid << 24) | 0xFFFFFF);
		UPDATE session_search_state
		SET overflowed = 1,
			overflow_session_rowid = (SELECT rowid FROM sessions WHERE id = NEW.session_id)
		WHERE id = 1 AND changes() = 0 AND overflowed = 0;
	END;

	CREATE TRIGGER session_search_logs_insert AFTER INSERT ON logs
	WHEN NEW.session_id IS NOT NULL BEGIN
		INSERT INTO session_search(rowid, body)
		SELECT MAX(
			COALESCE((SELECT MAX(ss.rowid) FROM session_search ss
				WHERE ss.rowid BETWEEN (s.rowid << 24) AND ((s.rowid << 24) | 0xFFFFFF)),
				(s.rowid << 24) + 10001),
			(s.rowid << 24) + 10001
		) + 1, NEW.message || ' ' || NEW.url || ' ' || NEW.severity
		FROM sessions s
		WHERE s.id = NEW.session_id
		  AND (SELECT overflowed FROM session_search_state WHERE id = 1) = 0
		  AND COALESCE((SELECT MAX(ss.rowid) FROM session_search ss
			WHERE ss.rowid BETWEEN (s.rowid << 24) AND ((s.rowid << 24) | 0xFFFFFF)),
			(s.rowid << 24) + 10001) < ((s.rowid << 24) | 0xFFFFFF);
		INSERT INTO session_search_log(log_id, fts_rowid)
		SELECT NEW.id, MAX(ss.rowid) FROM session_search ss
		WHERE ss.rowid BETWEEN
			((SELECT rowid FROM sessions WHERE id = NEW.session_id) << 24)
			AND (((SELECT rowid FROM sessions WHERE id = NEW.session_id) << 24) | 0xFFFFFF)
		HAVING changes() > 0 AND MAX(ss.rowid) IS NOT NULL;
		UPDATE session_search_state
		SET overflowed = 1,
			overflow_session_rowid = (SELECT rowid FROM sessions WHERE id = NEW.session_id)
		WHERE id = 1 AND changes() = 0 AND overflowed = 0;
	END;
	CREATE TRIGGER session_search_logs_delete AFTER DELETE ON logs
	WHEN OLD.session_id IS NOT NULL BEGIN
		DELETE FROM session_search
		WHERE rowid = (SELECT fts_rowid FROM session_search_log WHERE log_id = OLD.id);
		DELETE FROM session_search_log WHERE log_id = OLD.id;
	END;
	`)
	return err
}

func (s *Store) startSearchIndexBuild() error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
		body, tokenize = 'trigram', content = '', contentless_delete = 1
	)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS session_search_log (
		log_id INTEGER PRIMARY KEY, fts_rowid INTEGER NOT NULL
	)`); err != nil {
		return err
	}
	if err := createSearchTriggers(tx); err != nil {
		return err
	}
	var sessionCutoff, pageCutoff, eventCutoff, logCutoff, total int64
	if err := tx.QueryRow(`SELECT
		COALESCE((SELECT MAX(rowid) FROM sessions), 0),
		COALESCE((SELECT MAX(rowid) FROM pages), 0),
		COALESCE((SELECT MAX(rowid) FROM custom_events), 0),
		COALESCE((SELECT MAX(rowid) FROM logs), 0),
		(SELECT COUNT(*) FROM sessions)`).Scan(
		&sessionCutoff, &pageCutoff, &eventCutoff, &logCutoff, &total,
	); err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE session_search_state SET
		state = 'building', cutoff_pages = ?, cutoff_events = ?, cutoff_logs = ?,
		cutoff_session_rowid = ?, next_session_rowid = 0,
		sessions_done = 0, sessions_total = ?, overflowed = 0,
		overflow_session_rowid = 0, drop_bytes_start = 0,
		started_at = ?, error = '' WHERE id = 1`,
		pageCutoff, eventCutoff, logCutoff, sessionCutoff, total, time.Now().Unix())
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.invalidateSearchIndexBytes()
	s.searchBatch = searchIndexInitialBatch
	return nil
}

func sessionRange(rowID int64) (int64, int64) {
	base := rowID << 24
	return base, base | searchItemMax
}

func (s *Store) buildSearchIndexBatch(st searchIndexState, batchSize int) (bool, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`SELECT rowid FROM sessions
		WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`,
		st.nextSessionRowID, st.cutoffSessionRowID, batchSize)
	if err != nil {
		return false, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return false, err
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return false, err
	}
	if len(ids) == 0 {
		if _, err := tx.Exec(`UPDATE session_search_state SET state = 'ready',
			sessions_total = (SELECT COUNT(*) FROM sessions),
			sessions_done = (SELECT COUNT(*) FROM sessions) WHERE id = 1`); err != nil {
			return false, err
		}
		if err := tx.Commit(); err != nil {
			return false, err
		}
		s.invalidateSearchIndexBytes()
		return true, nil
	}

	for _, sessionRowID := range ids {
		base, end := sessionRange(sessionRowID)
		if _, err := tx.Exec(`DELETE FROM session_search WHERE rowid = (? << 24)`, sessionRowID); err != nil {
			return false, err
		}
		if _, err := tx.Exec(`INSERT INTO session_search(rowid, body)
			SELECT (? << 24), initial_url || ' ' || exit_url FROM sessions WHERE rowid = ?`,
			sessionRowID, sessionRowID); err != nil {
			return false, err
		}
		if _, err := tx.Exec(`DELETE FROM session_search WHERE rowid IN (
			SELECT (? << 24) | (idx + 1) FROM pages
			WHERE session_id = (SELECT id FROM sessions WHERE rowid = ?) AND rowid <= ?
		)`, sessionRowID, sessionRowID, st.cutoffPages); err != nil {
			return false, err
		}
		if _, err := tx.Exec(`INSERT INTO session_search(rowid, body)
			SELECT (? << 24) | (idx + 1), url || ' ' || title
			FROM pages WHERE session_id = (SELECT id FROM sessions WHERE rowid = ?)
			  AND rowid <= ?`, sessionRowID, sessionRowID, st.cutoffPages); err != nil {
			return false, err
		}

		var currentMax, customCount, logCount int64
		if err := tx.QueryRow(`SELECT COALESCE(MAX(rowid), ?)
			FROM session_search WHERE rowid BETWEEN ? AND ?`,
			base+searchItemFirstDynamic-1, base, end).Scan(&currentMax); err != nil {
			return false, err
		}
		if currentMax < base+searchItemFirstDynamic-1 {
			currentMax = base + searchItemFirstDynamic - 1
		}
		if err := tx.QueryRow(`SELECT COUNT(*) FROM custom_events
			WHERE session_id = (SELECT id FROM sessions WHERE rowid = ?) AND rowid <= ?`,
			sessionRowID, st.cutoffEvents).Scan(&customCount); err != nil {
			return false, err
		}
		if err := tx.QueryRow(`SELECT COUNT(*) FROM logs
			WHERE session_id = (SELECT id FROM sessions WHERE rowid = ?) AND rowid <= ?`,
			sessionRowID, st.cutoffLogs).Scan(&logCount); err != nil {
			return false, err
		}
		if currentMax+customCount+logCount > end {
			if _, err := tx.Exec(`UPDATE session_search_state SET overflowed = 1,
				overflow_session_rowid = ?
				WHERE id = 1`, sessionRowID); err != nil {
				return false, err
			}
			continue
		}
		if customCount > 0 {
			if _, err := tx.Exec(`INSERT INTO session_search(rowid, body)
				SELECT ? + ROW_NUMBER() OVER (ORDER BY rowid), name || ' ' || track_id
				FROM custom_events
				WHERE session_id = (SELECT id FROM sessions WHERE rowid = ?) AND rowid <= ?
				ORDER BY rowid`, currentMax, sessionRowID, st.cutoffEvents); err != nil {
				return false, err
			}
			currentMax += customCount
		}
		if logCount > 0 {
			logStart := currentMax
			if _, err := tx.Exec(`INSERT INTO session_search(rowid, body)
				SELECT ? + ROW_NUMBER() OVER (ORDER BY rowid), message || ' ' || url || ' ' || severity
				FROM logs
				WHERE session_id = (SELECT id FROM sessions WHERE rowid = ?) AND rowid <= ?
				ORDER BY rowid`, logStart, sessionRowID, st.cutoffLogs); err != nil {
				return false, err
			}
			if _, err := tx.Exec(`INSERT INTO session_search_log(log_id, fts_rowid)
				SELECT id, ? + ROW_NUMBER() OVER (ORDER BY rowid)
				FROM logs
				WHERE session_id = (SELECT id FROM sessions WHERE rowid = ?) AND rowid <= ?
				ORDER BY rowid`, logStart, sessionRowID, st.cutoffLogs); err != nil {
				return false, err
			}
		}
	}

	last := ids[len(ids)-1]
	if _, err := tx.Exec(`UPDATE session_search_state
		SET next_session_rowid = ?, sessions_done = sessions_done + ? WHERE id = 1`,
		last, len(ids)); err != nil {
		return false, err
	}
	return false, tx.Commit()
}

func (s *Store) startSearchIndexDrop() error {
	s.invalidateSearchIndexBytes()
	bytes := s.searchIndexBytes(context.Background())
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := dropSearchTriggers(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE session_search_state SET state = 'dropping',
		drop_bytes_start = ?, error = '' WHERE id = 1`, bytes); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) dropSearchIndexBatch(st searchIndexState) (bool, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM session_search WHERE rowid IN (
		SELECT rowid FROM session_search ORDER BY rowid LIMIT ?
	)`, searchDropBatchRows)
	if err != nil {
		// A crash after the table was dropped but before state settled is safe to
		// finish here too.
		if !isMissingSearchTable(err) {
			return false, err
		}
		if err := finishSearchIndexDrop(tx); err != nil {
			return false, err
		}
		return true, tx.Commit()
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		return false, tx.Commit()
	}
	if _, err := tx.Exec(`DROP TABLE IF EXISTS session_search`); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`DROP TABLE IF EXISTS session_search_log`); err != nil {
		return false, err
	}
	if err := finishSearchIndexDrop(tx); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	s.invalidateSearchIndexBytes()
	// Returning pages is best-effort. The state is already safe and searches
	// are on the standard path even if an older database cannot shrink.
	if err := s.ReclaimFreePages(); err != nil {
		log.Printf("session search index reclaim: %v", err)
	}
	return true, nil
}

func finishSearchIndexDrop(tx *sql.Tx) error {
	_, err := tx.Exec(`UPDATE session_search_state SET state = 'off',
		cutoff_pages = 0, cutoff_events = 0, cutoff_logs = 0,
		cutoff_session_rowid = 0, next_session_rowid = 0,
		sessions_done = 0, sessions_total = 0, overflowed = 0,
		overflow_session_rowid = 0, started_at = 0, error = '' WHERE id = 1`)
	return err
}

func isMissingSearchTable(err error) bool {
	return err != nil && (errors.Is(err, sql.ErrNoRows) ||
		containsAny(err.Error(), "no such table: session_search", "no such module: fts5"))
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if len(needle) > 0 && len(value) >= len(needle) {
			for i := 0; i+len(needle) <= len(value); i++ {
				if value[i:i+len(needle)] == needle {
					return true
				}
			}
		}
	}
	return false
}

func maxSearchCursor() int64 { return math.MaxInt64 }
