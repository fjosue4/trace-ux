package main

import (
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
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
	if err := secureStoreFiles(path); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func secureStoreFiles(path string) error {
	for _, file := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Chmod(file, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("secure database file %s: %w", file, err)
		}
	}
	return nil
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
	// v2: dashboard users with roles + revocable login sessions.
	`
	CREATE TABLE IF NOT EXISTS users (
		id            INTEGER PRIMARY KEY,
		username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
		password_hash TEXT    NOT NULL,
		role          TEXT    NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
		created_at    INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS auth_sessions (
		token_hash TEXT    PRIMARY KEY,
		user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_auth_sessions_user    ON auth_sessions(user_id);
	CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry  ON auth_sessions(expires_at);
	CREATE INDEX IF NOT EXISTS idx_pages_url             ON pages(url);
	`,
	// v3: visitor identity + tracked custom events ("trace-ux-track-id" clicks).
	`
	ALTER TABLE sessions ADD COLUMN user_id   TEXT NOT NULL DEFAULT '';
	ALTER TABLE sessions ADD COLUMN client_id TEXT NOT NULL DEFAULT '';
	ALTER TABLE sessions ADD COLUMN remote_id TEXT NOT NULL DEFAULT '';

	CREATE TABLE IF NOT EXISTS custom_events (
		session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		ts         INTEGER NOT NULL,
		name       TEXT    NOT NULL,
		track_id   TEXT    NOT NULL DEFAULT '',
		PRIMARY KEY (session_id, ts, name, track_id)
	);
	CREATE INDEX IF NOT EXISTS idx_custom_events_session ON custom_events(session_id, ts);
	`,
	// v4: in-app visitor feedback and survey responses.
	`
	CREATE TABLE IF NOT EXISTS feedback (
		id         INTEGER PRIMARY KEY,
		site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
		session_id TEXT    NOT NULL DEFAULT '',
		survey_id  TEXT    NOT NULL DEFAULT 'default',
		rating     INTEGER NOT NULL,
		comment    TEXT    NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_feedback_site   ON feedback(site_id, created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_feedback_survey ON feedback(site_id, survey_id);
	`,
	// v5: custom survey answers — a JSON array of {id, label, value} per response.
	`
	ALTER TABLE feedback ADD COLUMN answers TEXT NOT NULL DEFAULT '';
	`,
	// v6: per-site configuration managed from the dashboard — recording on/off
	// and the feedback/survey widget setup (JSON).
	`
	ALTER TABLE sites ADD COLUMN recording_enabled INTEGER NOT NULL DEFAULT 1;
	ALTER TABLE sites ADD COLUMN config TEXT NOT NULL DEFAULT '';
	`,
	// v7: the site's own URL — the CORS allowlist for the public tracker
	// endpoints is derived from it, so cross-origin recording only works for
	// sites an admin actually added.
	`
	ALTER TABLE sites ADD COLUMN url TEXT NOT NULL DEFAULT '';
	`,
	// v8: short-lived, site-scoped demo replay capabilities.
	`
	CREATE TABLE IF NOT EXISTS demo_replay_tokens (
		token_hash TEXT PRIMARY KEY,
		site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
		session_id TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_demo_replay_tokens_expiry ON demo_replay_tokens(expires_at);
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
	ID               int64        `json:"id"`
	Name             string       `json:"name"`
	URL              string       `json:"url"`
	SiteKey          string       `json:"site_key"`
	CreatedAt        int64        `json:"created_at"`
	SessionCount     int64        `json:"session_count"`
	RecordingEnabled bool         `json:"recording_enabled"`
	Settings         SiteSettings `json:"settings"`
}

func newKey(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	return hex.EncodeToString(b)
}

func (s *Store) CreateSite(name, url string) (Site, error) {
	now := time.Now().Unix()
	key := newKey(16)
	res, err := s.db.Exec(`INSERT INTO sites (name, url, site_key, created_at) VALUES (?, ?, ?, ?)`, name, url, key, now)
	if err != nil {
		return Site{}, err
	}
	id, _ := res.LastInsertId()
	return Site{ID: id, Name: name, URL: url, SiteKey: key, CreatedAt: now, RecordingEnabled: true, Settings: DefaultSiteSettings()}, nil
}

const siteCols = `s.id, s.name, s.url, s.site_key, s.created_at, s.recording_enabled, s.config,
	(SELECT COUNT(*) FROM sessions se WHERE se.site_id = s.id) AS session_count`

func scanSite(row interface{ Scan(...any) error }) (*Site, error) {
	var st Site
	var recording int
	var config string
	if err := row.Scan(&st.ID, &st.Name, &st.URL, &st.SiteKey, &st.CreatedAt, &recording, &config, &st.SessionCount); err != nil {
		return nil, err
	}
	st.RecordingEnabled = recording != 0
	st.Settings = ParseSiteSettings(config)
	return &st, nil
}

const listSitesQuery = `SELECT ` + siteCols + ` FROM sites s ORDER BY s.created_at DESC`

const siteByKeyQuery = `SELECT ` + siteCols + ` FROM sites s WHERE s.site_key = ?`

func (s *Store) ListSites() ([]Site, error) {
	rows, err := s.db.Query(listSitesQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sites := []Site{}
	for rows.Next() {
		st, err := scanSite(rows)
		if err != nil {
			return nil, err
		}
		sites = append(sites, *st)
	}
	return sites, rows.Err()
}

func (s *Store) GetSiteByKey(key string) (Site, error) {
	st, err := scanSite(s.db.QueryRow(siteByKeyQuery, key))
	if err == sql.ErrNoRows {
		return Site{}, nil // unknown key: zero Site, no error; caller decides
	}
	if st != nil {
		return *st, err
	}
	return Site{}, err
}

func (s *Store) DeleteSite(id int64) error {
	_, err := s.db.Exec(`DELETE FROM sites WHERE id = ?`, id)
	return err
}

// ---- Sessions ----

type Session struct {
	ID          string `json:"id"`
	SiteID      int64  `json:"site_id"`
	SiteName    string `json:"site_name,omitempty"`
	StartedAt   int64  `json:"started_at"`
	LastSeen    int64  `json:"last_seen"`
	Active      bool   `json:"active"` // in-progress: seen in the last 30 minutes
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
	UserID      string `json:"user_id,omitempty"`
	ClientID    string `json:"client_id,omitempty"`
	RemoteID    string `json:"remote_id,omitempty"`
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

// A session counts as in-progress while it was seen within the same 30-minute
// window the concurrency gate uses; anything older is completed.
const sessionActiveExpr = `CASE WHEN last_seen > CAST(strftime('%s','now') AS INTEGER) - 1800 THEN 1 ELSE 0 END`
const sessionActiveExprQualified = `CASE WHEN s.last_seen > CAST(strftime('%s','now') AS INTEGER) - 1800 THEN 1 ELSE 0 END`

const sessionCols = `id, site_id, started_at, last_seen, duration_ms, page_count, event_count,
	initial_url, exit_url, referrer, utm_source, utm_medium, utm_campaign,
	browser, os, device, viewport_w, viewport_h, screen_w, screen_h,
	ip_hash, country, user_agent, user_id, client_id, remote_id,
	` + sessionActiveExpr

// sessionColsQualified is sessionCols for queries that join other tables
// sharing column names (sites also has created_at).
const sessionColsQualified = `s.id, s.site_id, s.started_at, s.last_seen, s.duration_ms, s.page_count, s.event_count,
	s.initial_url, s.exit_url, s.referrer, s.utm_source, s.utm_medium, s.utm_campaign,
	s.browser, s.os, s.device, s.viewport_w, s.viewport_h, s.screen_w, s.screen_h,
	s.ip_hash, s.country, s.user_agent, s.user_id, s.client_id, s.remote_id,
	` + sessionActiveExprQualified

func scanSession(row interface{ Scan(...any) error }) (*Session, error) {
	var s Session
	var active int
	err := row.Scan(&s.ID, &s.SiteID, &s.StartedAt, &s.LastSeen, &s.DurationMs, &s.PageCount, &s.EventCount,
		&s.InitialURL, &s.ExitURL, &s.Referrer, &s.UTMSource, &s.UTMMedium, &s.UTMCampaign,
		&s.Browser, &s.OS, &s.Device, &s.ViewportW, &s.ViewportH, &s.ScreenW, &s.ScreenH,
		&s.IPHash, &s.Country, &s.UserAgent, &s.UserID, &s.ClientID, &s.RemoteID, &active)
	if err != nil {
		return nil, err
	}
	s.Active = active != 0
	return &s, nil
}

// scanSessionNamed scans sessionCols plus the joined sites.name.
func scanSessionNamed(row interface{ Scan(...any) error }) (*Session, error) {
	var s Session
	var active int
	err := row.Scan(&s.ID, &s.SiteID, &s.StartedAt, &s.LastSeen, &s.DurationMs, &s.PageCount, &s.EventCount,
		&s.InitialURL, &s.ExitURL, &s.Referrer, &s.UTMSource, &s.UTMMedium, &s.UTMCampaign,
		&s.Browser, &s.OS, &s.Device, &s.ViewportW, &s.ViewportH, &s.ScreenW, &s.ScreenH,
		&s.IPHash, &s.Country, &s.UserAgent, &s.UserID, &s.ClientID, &s.RemoteID, &active, &s.SiteName)
	if err != nil {
		return nil, err
	}
	s.Active = active != 0
	return &s, nil
}

func (s *Store) GetSession(id string) (*Session, error) {
	sess, err := scanSession(s.db.QueryRow(`SELECT `+sessionCols+` FROM sessions WHERE id = ?`, id))
	if err != nil {
		return nil, err
	}
	return sess, nil
}

// ListSessions returns sessions newest first, with optional filters. With
// f.SiteID set it is scoped to one site; with 0 it spans every site (the rows
// then carry the site name for display). Empty filter values are ignored.
func (s *Store) ListSessions(f SessionFilter) ([]Session, error) {
	query := `SELECT ` + sessionColsQualified + `, si.name
		FROM sessions s JOIN sites si ON si.id = s.site_id`
	args := []any{}
	if f.SiteID > 0 {
		query += ` WHERE s.site_id = ?`
		args = append(args, f.SiteID)
	} else {
		query += ` WHERE 1=1`
	}
	if f.Browser != "" {
		query += ` AND s.browser = ?`
		args = append(args, f.Browser)
	}
	if f.OS != "" {
		query += ` AND s.os = ?`
		args = append(args, f.OS)
	}
	if f.Device != "" {
		query += ` AND s.device = ?`
		args = append(args, f.Device)
	}
	if f.URL != "" {
		// Match any path the session navigated through — pages holds the full
		// per-page timeline, so filtering covers every hop, not just entry/exit.
		like := "%" + f.URL + "%"
		query += ` AND (s.initial_url LIKE ? OR s.exit_url LIKE ? OR EXISTS
			(SELECT 1 FROM pages pg WHERE pg.session_id = s.id AND pg.url LIKE ?))`
		args = append(args, like, like, like)
	}
	if f.Identity != "" {
		// Visitor identity: matches any of the three custom IDs.
		like := "%" + f.Identity + "%"
		query += ` AND (s.user_id LIKE ? OR s.client_id LIKE ? OR s.remote_id LIKE ?)`
		args = append(args, like, like, like)
	}
	if f.MinDurationMs > 0 {
		query += ` AND s.duration_ms >= ?`
		args = append(args, f.MinDurationMs)
	}
	if f.Before != 0 {
		query += ` AND s.started_at < ?`
		args = append(args, f.Before)
	}
	query += ` ORDER BY s.started_at DESC LIMIT ?`
	args = append(args, f.Limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		sess, err := scanSessionNamed(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sess)
	}
	return out, rows.Err()
}

type SessionFilter struct {
	SiteID        int64 // 0 = all sites
	Browser       string
	OS            string
	Device        string
	URL           string
	Identity      string // matches user_id / client_id / remote_id
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

// ---- Tracked custom events (trace-ux-track-id clicks, window.TraceUX.track) ----

type CustomEvent struct {
	TS      int64  `json:"ts"` // unix millis, visitor's clock
	Name    string `json:"name"`
	TrackID string `json:"track_id"`
}

// SaveCustomEvents stores tracked events for a session; duplicates (retries)
// are ignored via the primary key.
func (s *Store) SaveCustomEvents(siteID int64, sessionID string, events []CustomEvent) error {
	now := time.Now().Unix()
	if err := s.ensureSessionForSite(siteID, sessionID, now); err != nil {
		return err
	}
	for _, e := range events {
		if _, err := s.db.Exec(`INSERT OR IGNORE INTO custom_events (session_id, ts, name, track_id) VALUES (?, ?, ?, ?)`,
			sessionID, e.TS, e.Name, e.TrackID); err != nil {
			return err
		}
	}
	_, err := s.db.Exec(`UPDATE sessions SET last_seen = ? WHERE id = ? AND site_id = ?`, time.Now().Unix(), sessionID, siteID)
	return err
}

func (s *Store) GetCustomEvents(sessionID string) ([]CustomEvent, error) {
	rows, err := s.db.Query(`SELECT ts, name, track_id FROM custom_events WHERE session_id = ? ORDER BY ts`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CustomEvent{}
	for rows.Next() {
		var e CustomEvent
		if err := rows.Scan(&e.TS, &e.Name, &e.TrackID); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
