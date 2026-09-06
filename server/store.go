package main

import (
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"time"

	_ "modernc.org/sqlite"
)

// Store wraps the SQLite database. All timestamps are unix seconds.
type Store struct {
	db *sql.DB
}

func OpenStore(path string) (*Store, error) {
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite driver serializes writes anyway; a small pool avoids
	// SQLITE_BUSY churn between the API and the retention job.
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

var migrations = []string{
	`
	CREATE TABLE IF NOT EXISTS sites (
		id         INTEGER PRIMARY KEY,
		name       TEXT    NOT NULL,
		site_key   TEXT    NOT NULL UNIQUE,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS sessions (
		id           TEXT    PRIMARY KEY,
		site_id      INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
		started_at   INTEGER NOT NULL,
		last_seen    INTEGER NOT NULL,
		duration_ms  INTEGER NOT NULL DEFAULT 0,
		page_count   INTEGER NOT NULL DEFAULT 0,
		event_count  INTEGER NOT NULL DEFAULT 0,
		initial_url  TEXT    NOT NULL DEFAULT '',
		exit_url     TEXT    NOT NULL DEFAULT '',
		referrer     TEXT    NOT NULL DEFAULT '',
		utm_source   TEXT    NOT NULL DEFAULT '',
		utm_medium   TEXT    NOT NULL DEFAULT '',
		utm_campaign TEXT    NOT NULL DEFAULT '',
		browser      TEXT    NOT NULL DEFAULT '',
		os           TEXT    NOT NULL DEFAULT '',
		device       TEXT    NOT NULL DEFAULT '',
		viewport_w   INTEGER NOT NULL DEFAULT 0,
		viewport_h   INTEGER NOT NULL DEFAULT 0,
		screen_w     INTEGER NOT NULL DEFAULT 0,
		screen_h     INTEGER NOT NULL DEFAULT 0,
		ip_hash      TEXT    NOT NULL DEFAULT '',
		country      TEXT    NOT NULL DEFAULT '',
		user_agent   TEXT    NOT NULL DEFAULT ''
	);
	CREATE INDEX IF NOT EXISTS idx_sessions_site_started ON sessions(site_id, started_at DESC);

	CREATE TABLE IF NOT EXISTS chunks (
		session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		seq        INTEGER NOT NULL,
		events     INTEGER NOT NULL DEFAULT 0,
		data       BLOB    NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (session_id, seq)
	);

	CREATE TABLE IF NOT EXISTS pages (
		session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		idx        INTEGER NOT NULL,
		url        TEXT    NOT NULL,
		title      TEXT    NOT NULL DEFAULT '',
		entered_at INTEGER NOT NULL,
		left_at    INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (session_id, idx)
	);
	`,
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return err
	}
	var version int
	row := s.db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`)
	if err := row.Scan(&version); err != nil {
		return err
	}
	for v := version; v < len(migrations); v++ {
		if _, err := s.db.Exec(migrations[v]); err != nil {
			return fmt.Errorf("migration %d: %w", v+1, err)
		}
		if _, err := s.db.Exec(`INSERT INTO schema_version (version) VALUES (?)`, v+1); err != nil {
			return err
		}
	}
	return nil
}

// ---- Sites ----

type Site struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	SiteKey      string `json:"site_key"`
	CreatedAt    int64  `json:"created_at"`
	SessionCount int64  `json:"session_count"`
}

func newKey(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	return hex.EncodeToString(b)
}

func (s *Store) CreateSite(name string) (Site, error) {
	now := time.Now().Unix()
	key := newKey(16)
	res, err := s.db.Exec(`INSERT INTO sites (name, site_key, created_at) VALUES (?, ?, ?)`, name, key, now)
	if err != nil {
		return Site{}, err
	}
	id, _ := res.LastInsertId()
	return Site{ID: id, Name: name, SiteKey: key, CreatedAt: now}, nil
}

const listSitesQuery = `
	SELECT s.id, s.name, s.site_key, s.created_at,
	       (SELECT COUNT(*) FROM sessions se WHERE se.site_id = s.id) AS session_count
	FROM sites s ORDER BY s.created_at DESC`

func (s *Store) ListSites() ([]Site, error) {
	rows, err := s.db.Query(listSitesQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sites := []Site{}
	for rows.Next() {
		var st Site
		if err := rows.Scan(&st.ID, &st.Name, &st.SiteKey, &st.CreatedAt, &st.SessionCount); err != nil {
			return nil, err
		}
		sites = append(sites, st)
	}
	return sites, rows.Err()
}

func (s *Store) GetSiteByKey(key string) (Site, error) {
	var st Site
	err := s.db.QueryRow(`SELECT id, name, site_key, created_at, 0 FROM sites WHERE site_key = ?`, key).
		Scan(&st.ID, &st.Name, &st.SiteKey, &st.CreatedAt, &st.SessionCount)
	if err == sql.ErrNoRows {
		return Site{}, nil // unknown key: zero Site, no error; caller decides
	}
	return st, err
}

func (s *Store) DeleteSite(id int64) error {
	_, err := s.db.Exec(`DELETE FROM sites WHERE id = ?`, id)
	return err
}

// ---- Sessions ----

type Session struct {
	ID          string `json:"id"`
	SiteID      int64  `json:"site_id"`
	StartedAt   int64  `json:"started_at"`
	LastSeen    int64  `json:"last_seen"`
	DurationMs  int64  `json:"duration_ms"`
	PageCount   int    `json:"page_count"`
	EventCount  int    `json:"event_count"`
	InitialURL  string `json:"initial_url"`
	ExitURL     string `json:"exit_url"`
	Referrer    string `json:"referrer"`
	UTMSource   string `json:"utm_source"`
	UTMMedium   string `json:"utm_medium"`
	UTMCampaign string `json:"utm_campaign"`
	Browser     string `json:"browser"`
	OS          string `json:"os"`
	Device      string `json:"device"`
	ViewportW   int    `json:"viewport_w"`
	ViewportH   int    `json:"viewport_h"`
	ScreenW     int    `json:"screen_w"`
	ScreenH     int    `json:"screen_h"`
	IPHash      string `json:"ip_hash"`
	Country     string `json:"country"`
	UserAgent   string `json:"user_agent"`
}

type SessionPage struct {
	Idx       int    `json:"idx"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	EnteredAt int64  `json:"entered_at"`
	LeftAt    int64  `json:"left_at"`
}

// Dwell returns seconds spent on the page; LeftAt == 0 means the visit's last
// page, still open.
func (p SessionPage) Dwell() int64 {
	if p.LeftAt == 0 {
		return 0
	}
	return p.LeftAt - p.EnteredAt
}

const sessionCols = `id, site_id, started_at, last_seen, duration_ms, page_count, event_count,
	initial_url, exit_url, referrer, utm_source, utm_medium, utm_campaign,
	browser, os, device, viewport_w, viewport_h, screen_w, screen_h,
	ip_hash, country, user_agent`

func scanSession(row interface{ Scan(...any) error }) (*Session, error) {
	var s Session
	err := row.Scan(&s.ID, &s.SiteID, &s.StartedAt, &s.LastSeen, &s.DurationMs, &s.PageCount, &s.EventCount,
		&s.InitialURL, &s.ExitURL, &s.Referrer, &s.UTMSource, &s.UTMMedium, &s.UTMCampaign,
		&s.Browser, &s.OS, &s.Device, &s.ViewportW, &s.ViewportH, &s.ScreenW, &s.ScreenH,
		&s.IPHash, &s.Country, &s.UserAgent)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (s *Store) GetSession(id string) (*Session, error) {
	sess, err := scanSession(s.db.QueryRow(`SELECT `+sessionCols+` FROM sessions WHERE id = ?`, id))
	if err != nil {
		return nil, err
	}
	return sess, nil
}

// ListSessions returns sessions for a site, newest first, with optional filters.
// Empty filter values are ignored.
func (s *Store) ListSessions(siteID int64, f SessionFilter) ([]Session, error) {
	where := []any{"site_id = ?", siteID}
	if f.Browser != "" {
		where = append(where, "browser = ?", f.Browser)
	}
	if f.OS != "" {
		where = append(where, "os = ?", f.OS)
	}
	if f.Device != "" {
		where = append(where, "device = ?", f.Device)
	}
	if f.URL != "" {
		where = append(where, "(initial_url LIKE ? OR exit_url LIKE ?)", "%"+f.URL+"%", "%"+f.URL+"%")
	}
	if f.MinDurationMs > 0 {
		where = append(where, "duration_ms >= ?", f.MinDurationMs)
	}
	if f.Before != 0 {
		where = append(where, "started_at < ?", f.Before)
	}

	query := `SELECT ` + sessionCols + ` FROM sessions WHERE ` + where[0].(string)
	args := []any{where[1]}
	for i := 2; i < len(where); i += 2 {
		query += ` AND ` + where[i].(string)
		args = append(args, where[i+1])
	}
	query += ` ORDER BY started_at DESC LIMIT ?`
	args = append(args, f.Limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sess)
	}
	return out, rows.Err()
}

type SessionFilter struct {
	Browser       string
	OS            string
	Device        string
	URL           string
	MinDurationMs int64
	Before        int64 // pagination cursor: started_at of the last row shown
	Limit         int
}

func (s *Store) GetSessionPages(sessionID string) ([]SessionPage, error) {
	rows, err := s.db.Query(`SELECT idx, url, title, entered_at, left_at FROM pages WHERE session_id = ? ORDER BY idx`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SessionPage{}
	for rows.Next() {
		var p SessionPage
		if err := rows.Scan(&p.Idx, &p.URL, &p.Title, &p.EnteredAt, &p.LeftAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetSessionChunk returns the decompressed rrweb events of one chunk.
func (s *Store) GetSessionChunk(sessionID string, seq int) ([]json.RawMessage, error) {
	var data []byte
	err := s.db.QueryRow(`SELECT data FROM chunks WHERE session_id = ? AND seq = ?`, sessionID, seq).Scan(&data)
	if err != nil {
		return nil, err
	}
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	raw, err := io.ReadAll(io.LimitReader(zr, ingestBodyLimit))
	if err != nil {
		return nil, err
	}
	var events []json.RawMessage
	if err := json.Unmarshal(raw, &events); err != nil {
		return nil, err
	}
	return events, nil
}

// GetSessionChunkSeqs lists the available chunk sequence numbers in order.
func (s *Store) GetSessionChunkSeqs(sessionID string) ([]int, error) {
	rows, err := s.db.Query(`SELECT seq FROM chunks WHERE session_id = ? ORDER BY seq`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var seqs []int
	for rows.Next() {
		var seq int
		if err := rows.Scan(&seq); err != nil {
			return nil, err
		}
		seqs = append(seqs, seq)
	}
	return seqs, rows.Err()
}
