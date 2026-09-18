package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"

	_ "modernc.org/sqlite"
)

// Store wraps the SQLite database. All timestamps are unix seconds.
type Store struct {
	DB *sql.DB
}

// errBadJSON mirrors the dashboard API's own "invalid JSON body" sentinel
// (main package, api.go) for store-side input validation that predates the
// store/main package split. The two are independent values with the same
// message; nothing compares them for identity across the package boundary.
var errBadJSON = errors.New("invalid JSON body")

func OpenStore(path string) (*Store, error) {
	// auto_vacuum(incremental) is load-bearing for disk-pressure pruning: without
	// it, deleting recordings moves their pages to the freelist and the FILE never
	// shrinks, so the filesystem gets nothing back (see spacesweep.go).
	//
	// SQLite only honours this on a database with no tables yet -- on an existing
	// file the pragma is silently ignored and the only way to change it is a full
	// VACUUM. New installs therefore get it for free; migrate() warns about the
	// older ones rather than pretending.
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)&_pragma=auto_vacuum(incremental)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite driver serializes writes anyway; a small pool avoids
	// SQLITE_BUSY churn between the API and the retention job.
	db.SetMaxOpenConns(1)
	s := &Store{DB: db}
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

func (s *Store) Close() error { return s.DB.Close() }

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
	// v9: logs captured by the tracker and linked to recordings.
	`
	CREATE TABLE IF NOT EXISTS logs (
		id           INTEGER PRIMARY KEY,
		session_id   TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		client_seq   INTEGER NOT NULL,
		timestamp_ms INTEGER NOT NULL,
		severity     TEXT    NOT NULL CHECK (severity IN ('debug', 'info', 'warn', 'error')),
		message      TEXT    NOT NULL,
		url          TEXT    NOT NULL DEFAULT '',
		created_at   INTEGER NOT NULL,
		UNIQUE (session_id, client_seq)
	);
	CREATE INDEX IF NOT EXISTS idx_logs_session_time ON logs(session_id, timestamp_ms);
	CREATE INDEX IF NOT EXISTS idx_logs_severity_time ON logs(severity, created_at DESC);
	`,
	// v10: backend endpoint latency metrics. Rows hold one minute of histogram
	// data per site, endpoint and deployment identity instead of one row per
	// request, keeping the small SQLite store bounded and queryable.
	`
	CREATE TABLE IF NOT EXISTS performance_keys (
		id           INTEGER PRIMARY KEY,
		site_id      INTEGER NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
		key_hash     TEXT    NOT NULL UNIQUE,
		key_prefix   TEXT    NOT NULL,
		created_at   INTEGER NOT NULL,
		last_used_at INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_performance_keys_site ON performance_keys(site_id);

	CREATE TABLE IF NOT EXISTS performance_metrics (
		id               INTEGER PRIMARY KEY,
		site_id          INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
		bucket_start     INTEGER NOT NULL,
		environment      TEXT    NOT NULL DEFAULT '',
		service          TEXT    NOT NULL DEFAULT '',
		version          TEXT    NOT NULL DEFAULT '',
		endpoint         TEXT    NOT NULL DEFAULT '',
		request_count    INTEGER NOT NULL DEFAULT 0,
		error_count      INTEGER NOT NULL DEFAULT 0,
		duration_sum_ms  INTEGER NOT NULL DEFAULT 0,
		max_duration_ms  INTEGER NOT NULL DEFAULT 0,
		bucket_counts    TEXT    NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]',
		UNIQUE (site_id, bucket_start, environment, service, version, endpoint)
	);
	CREATE INDEX IF NOT EXISTS idx_performance_metrics_site_time
		ON performance_metrics(site_id, bucket_start DESC);
	CREATE INDEX IF NOT EXISTS idx_performance_metrics_dimensions
		ON performance_metrics(site_id, environment, service, version, endpoint);
	`,
	// v11: allow more than one backend key per site and keep a safe display hint
	// for each key. Existing keys are preserved; their suffix is unknown because
	// v10 deliberately stored only a hash and prefix.
	`
	CREATE TABLE performance_keys_v11 (
		id           INTEGER PRIMARY KEY,
		site_id      INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
		key_hash     TEXT    NOT NULL UNIQUE,
		key_prefix   TEXT    NOT NULL,
		key_suffix   TEXT    NOT NULL DEFAULT '',
		created_at   INTEGER NOT NULL,
		last_used_at INTEGER NOT NULL DEFAULT 0
	);
	INSERT INTO performance_keys_v11 (id, site_id, key_hash, key_prefix, key_suffix, created_at, last_used_at)
		SELECT id, site_id, key_hash, key_prefix, '', created_at, last_used_at
		FROM performance_keys;
	DROP TABLE performance_keys;
	ALTER TABLE performance_keys_v11 RENAME TO performance_keys;
	CREATE INDEX IF NOT EXISTS idx_performance_keys_site ON performance_keys(site_id);
	`,
	// v12: site-scoped announcements and anonymous visitor engagement.
	`
	CREATE TABLE IF NOT EXISTS announcements (
		id INTEGER PRIMARY KEY,
		site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		summary TEXT NOT NULL DEFAULT '',
		body TEXT NOT NULL DEFAULT '',
		release_label TEXT NOT NULL DEFAULT '',
		link_url TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
		published_at INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_announcements_site_status ON announcements(site_id, status, published_at DESC);
	CREATE TABLE IF NOT EXISTS announcement_reactions (
		announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
		visitor_key TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (announcement_id, visitor_key)
	);
	CREATE TABLE IF NOT EXISTS announcement_comments (
		id INTEGER PRIMARY KEY,
		announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
		visitor_key TEXT NOT NULL,
		body TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
		created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_announcement_comments ON announcement_comments(announcement_id, created_at DESC);
	CREATE TABLE IF NOT EXISTS announcement_reads (
		announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
		visitor_key TEXT NOT NULL,
		read_at INTEGER NOT NULL,
		PRIMARY KEY (announcement_id, visitor_key)
	);
	`,
	// v13: optional custom launcher icon for the unified widget. Kept in its
	// own table so the blob never rides along with the per-request site reads.
	`
	CREATE TABLE IF NOT EXISTS site_widget_icons (
		site_id    INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
		mime       TEXT    NOT NULL,
		bytes      BLOB    NOT NULL,
		etag       TEXT    NOT NULL,
		width      INTEGER NOT NULL DEFAULT 0,
		height     INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL
	);
	`,
	// v14: visitor-facing support tickets and their threaded messages.
	`
	CREATE TABLE IF NOT EXISTS tickets (
		id INTEGER PRIMARY KEY,
		site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
		visitor_key TEXT NOT NULL,
		user_id TEXT NOT NULL DEFAULT '',
		email TEXT NOT NULL DEFAULT '',
		name TEXT NOT NULL DEFAULT '',
		subject TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'open'
			CHECK (status IN ('open','in_progress','under_review','closed')),
		session_id TEXT NOT NULL DEFAULT '',
		page_url TEXT NOT NULL DEFAULT '',
		message_count INTEGER NOT NULL DEFAULT 0,
		last_message_at INTEGER NOT NULL DEFAULT 0,
		last_message_author TEXT NOT NULL DEFAULT 'visitor'
			CHECK (last_message_author IN ('visitor','staff')),
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_tickets_site_status ON tickets(site_id, status, last_message_at DESC);
	CREATE INDEX IF NOT EXISTS idx_tickets_visitor ON tickets(site_id, visitor_key, last_message_at DESC);

	CREATE TABLE IF NOT EXISTS ticket_messages (
		id INTEGER PRIMARY KEY,
		ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
		author TEXT NOT NULL CHECK (author IN ('visitor','staff')),
		user_id INTEGER NOT NULL DEFAULT 0,
		author_name TEXT NOT NULL DEFAULT '',
		body TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_ticket_messages ON ticket_messages(ticket_id, created_at);
	`,
	// v15: attribute engagement to a visitor. Likes, comments and feedback all
	// carried an anonymous localStorage key at most; user_id is whatever the
	// host page passed to identify(), so a signed-in visitor is recognisable
	// while an anonymous one still works exactly as before. feedback gains the
	// visitor key so a staff-opened ticket can reach that visitor's widget.
	`
	ALTER TABLE announcement_reactions ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
	ALTER TABLE announcement_comments  ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
	ALTER TABLE feedback ADD COLUMN visitor_key TEXT NOT NULL DEFAULT '';
	ALTER TABLE feedback ADD COLUMN user_id     TEXT NOT NULL DEFAULT '';
	CREATE INDEX IF NOT EXISTS idx_feedback_visitor ON feedback(site_id, visitor_key);
	`,
	// v16: store each stylesheet once instead of once per snapshot. See
	// cssdedupe.go for why this is a link table and not a reference count.
	`
	CREATE TABLE IF NOT EXISTS css_assets (
		hash       TEXT PRIMARY KEY,
		data       BLOB    NOT NULL,
		bytes      INTEGER NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS session_css (
		session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		hash       TEXT NOT NULL,
		PRIMARY KEY (session_id, hash)
	);
	CREATE INDEX IF NOT EXISTS idx_session_css_hash ON session_css(hash);
	`,
	// v17: archive support tickets without removing their conversation. The
	// archive timestamp is separate from the workflow status so unarchiving can
	// restore the ticket to the state it had before it was archived.
	`
	ALTER TABLE tickets ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0;
	CREATE INDEX IF NOT EXISTS idx_tickets_site_archived ON tickets(site_id, archived_at, last_message_at DESC);
	`,
	// v18: instance-wide Slack integration. A single row (id=1) holds routing
	// mode, per-notification enabled flags and the log matcher; webhook URLs
	// are stored as opaque ciphertext blobs the store never decrypts (see
	// slack_crypto.go). Disabled and empty by default, so existing installs
	// are unaffected until an admin configures it from the dashboard.
	`
	CREATE TABLE IF NOT EXISTS slack_integration (
		id                   INTEGER PRIMARY KEY CHECK (id = 1),
		routing_mode         TEXT    NOT NULL DEFAULT 'single' CHECK (routing_mode IN ('single','per_notification')),
		common_ciphertext    BLOB    NOT NULL DEFAULT x'',
		common_fingerprint   TEXT    NOT NULL DEFAULT '',
		common_hint          TEXT    NOT NULL DEFAULT '',
		tickets_enabled      INTEGER NOT NULL DEFAULT 0,
		tickets_ciphertext   BLOB    NOT NULL DEFAULT x'',
		tickets_fingerprint  TEXT    NOT NULL DEFAULT '',
		tickets_hint         TEXT    NOT NULL DEFAULT '',
		logs_enabled         INTEGER NOT NULL DEFAULT 0,
		logs_ciphertext      BLOB    NOT NULL DEFAULT x'',
		logs_fingerprint     TEXT    NOT NULL DEFAULT '',
		logs_hint            TEXT    NOT NULL DEFAULT '',
		logs_match_mode      TEXT    NOT NULL DEFAULT 'contains' CHECK (logs_match_mode IN ('contains','exact')),
		logs_match_value     TEXT    NOT NULL DEFAULT '',
		system_enabled       INTEGER NOT NULL DEFAULT 0,
		system_ciphertext    BLOB    NOT NULL DEFAULT x'',
		system_fingerprint   TEXT    NOT NULL DEFAULT '',
		system_hint          TEXT    NOT NULL DEFAULT '',
		updated_at           INTEGER NOT NULL DEFAULT 0
	);
	INSERT OR IGNORE INTO slack_integration (id) VALUES (1);
	`,
}

func (s *Store) migrate() error {
	if _, err := s.DB.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return err
	}
	var version int
	row := s.DB.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`)
	if err := row.Scan(&version); err != nil {
		return err
	}
	for v := version; v < len(migrations); v++ {
		if _, err := s.DB.Exec(migrations[v]); err != nil {
			return fmt.Errorf("migration %d: %w", v+1, err)
		}
		if _, err := s.DB.Exec(`INSERT INTO schema_version (version) VALUES (?)`, v+1); err != nil {
			return err
		}
	}
	return nil
}

// Counts returns the top-line row counts shown on the system health endpoint.
func (s *Store) Counts() (sites, sessions, feedback int64, err error) {
	err = s.DB.QueryRow(`SELECT
		(SELECT COUNT(*) FROM sites),
		(SELECT COUNT(*) FROM sessions),
		(SELECT COUNT(*) FROM feedback)`).Scan(&sites, &sessions, &feedback)
	return
}
