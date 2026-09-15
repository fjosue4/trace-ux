package store

import (
	"bytes"
	"compress/gzip"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Ingest accepts batched tracker payloads. The client generates the session id
// and a monotonically increasing seq per chunk, so batches arrive unordered and
// retryable without server round-trips.

// IngestBodyLimit is the maximum accepted (decompressed) tracker request body.
const IngestBodyLimit = 10 << 20 // 10 MB

// ErrSessionSiteMismatch is returned when a session id is reused across sites.
var ErrSessionSiteMismatch = errors.New("session belongs to another site")

// maxSessionDurationMs mirrors the tracker's MAX_SESSION_MS: one session never
// spans more than 2h of active time. The tracker splits marathon visits into a
// fresh session; this cap keeps buggy or hostile clients from inflating the
// stored duration beyond what the split would have produced.
const maxSessionDurationMs = 2 * 60 * 60 * 1000

// IngestHello is the "hello" batch payload. It is decoded from the wire
// envelope in the main package's ingest handler and passed through unchanged
// to SaveHello/SaveHelloWithCountry, so the identical type is shared here.
type IngestHello struct {
	Type        string `json:"type"`
	SessionID   string `json:"session_id"`
	URL         string `json:"url"`
	Referrer    string `json:"referrer"`
	UTMSource   string `json:"utm_source"`
	UTMMedium   string `json:"utm_medium"`
	UTMCampaign string `json:"utm_campaign"`
	Lang        string `json:"lang"`
	ViewportW   int    `json:"viewport_w"`
	ViewportH   int    `json:"viewport_h"`
	ScreenW     int    `json:"screen_w"`
	ScreenH     int    `json:"screen_h"`
	UserID      string `json:"user_id"`
	ClientID    string `json:"client_id"`
	RemoteID    string `json:"remote_id"`
}

// IngestPage is the "page" batch payload, shared with SavePage the same way
// as IngestHello.
type IngestPage struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	Idx       int    `json:"idx"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	EnteredAt int64  `json:"entered_at"`
}

// IngestPing is the "ping" batch payload, shared with SavePing the same way
// as IngestHello.
type IngestPing struct {
	Type       string `json:"type"`
	SessionID  string `json:"session_id"`
	DurationMs int64  `json:"duration_ms"`
	PageCount  int    `json:"page_count"`
	ExitURL    string `json:"exit_url"`
}

// ---- Store: session persistence ----

func (s *Store) EnsureSessionForSite(siteID int64, sessionID string, now int64) error {
	if _, err := s.DB.Exec(`INSERT INTO sessions (id, site_id, started_at, last_seen) VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING`, sessionID, siteID, now, now); err != nil {
		return err
	}
	var owner int64
	if err := s.DB.QueryRow(`SELECT site_id FROM sessions WHERE id = ?`, sessionID).Scan(&owner); err != nil {
		if err == sql.ErrNoRows {
			return ErrSessionSiteMismatch
		}
		return err
	}
	if owner != siteID {
		return ErrSessionSiteMismatch
	}
	return nil
}

func (s *Store) touchSession(sessionID string) {
	s.DB.Exec(`UPDATE sessions SET last_seen = ? WHERE id = ?`, time.Now().Unix(), sessionID)
}

func (s *Store) SaveHello(siteID int64, sessionID, ua, ipHash string, m *IngestHello) error {
	return s.saveHello(siteID, sessionID, ua, ipHash, "", m)
}

func (s *Store) SaveHelloWithCountry(siteID int64, sessionID, ua, ipHash, country string, m *IngestHello) error {
	return s.saveHello(siteID, sessionID, ua, ipHash, country, m)
}

func (s *Store) saveHello(siteID int64, sessionID, ua, ipHash, country string, m *IngestHello) error {
	now := time.Now().Unix()
	if err := s.EnsureSessionForSite(siteID, sessionID, now); err != nil {
		return err
	}
	// Session metadata is set-if-empty: the first page of a visit provides the
	// attribution (referrer, UTM, initial URL); later page loads in the same
	// session send hello again and must not overwrite it. Visitor identity is
	// the opposite: a non-empty id always wins, so a mid-visit
	// window.TraceUX.identify() sticks for the rest of the session.
	browser, osName, device := ParseUA(ua)
	_, err := s.DB.Exec(`UPDATE sessions SET
		initial_url = COALESCE(NULLIF(initial_url, ''), ?),
		referrer    = COALESCE(NULLIF(referrer, ''), CASE WHEN COALESCE(initial_url, '') = '' THEN ? ELSE referrer END),
		utm_source   = COALESCE(NULLIF(utm_source, ''), ?),
		utm_medium   = COALESCE(NULLIF(utm_medium, ''), ?),
		utm_campaign = COALESCE(NULLIF(utm_campaign, ''), ?),
		user_id      = CASE WHEN ? != '' THEN ? ELSE user_id END,
		client_id    = CASE WHEN ? != '' THEN ? ELSE client_id END,
		remote_id    = CASE WHEN ? != '' THEN ? ELSE remote_id END,
		-- Attribution above is set-if-empty: the first page of a visit owns it.
		-- Window geometry is the opposite — it is a live property, so a visitor
		-- who resizes mid-visit (or whose later page loads report a different
		-- size) must not leave the session stamped with its opening dimensions.
		-- The replay derives its aspect from these, so a stale value here shows
		-- up as a mis-scaled player and a cursor that misses what it clicked.
		viewport_w = CASE WHEN ? > 0 THEN ? ELSE viewport_w END,
		viewport_h = CASE WHEN ? > 0 THEN ? ELSE viewport_h END,
		screen_w   = CASE WHEN ? > 0 THEN ? ELSE screen_w END,
		screen_h   = CASE WHEN ? > 0 THEN ? ELSE screen_h END,
		browser    = COALESCE(NULLIF(browser, ''), ?),
		os         = COALESCE(NULLIF(os, ''), ?),
		device     = COALESCE(NULLIF(device, ''), ?),
		user_agent = COALESCE(NULLIF(user_agent, ''), ?),
		ip_hash    = COALESCE(NULLIF(ip_hash, ''), ?),
		country    = COALESCE(NULLIF(country, ''), ?),
		last_seen  = ?
		WHERE id = ? AND site_id = ?`,
		m.URL, m.Referrer, m.UTMSource, m.UTMMedium, m.UTMCampaign,
		m.UserID, m.UserID, m.ClientID, m.ClientID, m.RemoteID, m.RemoteID,
		m.ViewportW, m.ViewportW, m.ViewportH, m.ViewportH,
		m.ScreenW, m.ScreenW, m.ScreenH, m.ScreenH,
		browser, osName, device, ua, ipHash, country, now, sessionID, siteID)
	return err
}

func (s *Store) SaveEvents(siteID int64, sessionID string, seq int, events []json.RawMessage) error {
	now := time.Now().Unix()
	if err := s.EnsureSessionForSite(siteID, sessionID, now); err != nil {
		return err
	}
	raw, err := json.Marshal(events)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	if _, err := zw.Write(raw); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT INTO chunks (session_id, seq, events, data, created_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(session_id, seq) DO UPDATE SET data = excluded.data, events = excluded.events`,
		sessionID, seq, len(events), buf.Bytes(), now); err != nil {
		return err
	}
	_, err = s.DB.Exec(`UPDATE sessions SET
		last_seen = ?,
		event_count = (SELECT COALESCE(SUM(events), 0) FROM chunks WHERE session_id = ?)
		WHERE id = ? AND site_id = ?`, now, sessionID, sessionID, siteID)
	return err
}

func (s *Store) SavePage(siteID int64, sessionID string, m *IngestPage) error {
	now := time.Now().Unix()
	if err := s.EnsureSessionForSite(siteID, sessionID, now); err != nil {
		return err
	}
	// left_at starts open (0) and is closed when the next page of the same
	// session arrives, so the pages timeline reflects real dwell times.
	if _, err := s.DB.Exec(`INSERT INTO pages (session_id, idx, url, title, entered_at, left_at) VALUES (?, ?, ?, ?, ?, 0)
		ON CONFLICT(session_id, idx) DO UPDATE SET url = excluded.url, title = excluded.title, entered_at = excluded.entered_at`,
		sessionID, m.Idx, m.URL, m.Title, m.EnteredAt); err != nil {
		return err
	}
	if m.Idx > 0 {
		s.DB.Exec(`UPDATE pages SET left_at = ? WHERE session_id = ? AND idx = ? AND left_at = 0`,
			m.EnteredAt, sessionID, m.Idx-1)
	}
	_, err := s.DB.Exec(`UPDATE sessions SET
		last_seen = ?, page_count = MAX(page_count, ?),
		exit_url = ?
		WHERE id = ? AND site_id = ?`, now, m.Idx+1, m.URL, sessionID, siteID)
	return err
}

func (s *Store) SavePing(siteID int64, sessionID string, m *IngestPing) error {
	now := time.Now().Unix()
	if err := s.EnsureSessionForSite(siteID, sessionID, now); err != nil {
		return err
	}
	// Cap duration at 2h to match the tracker's session split.
	_, err := s.DB.Exec(`UPDATE sessions SET
		last_seen = ?, duration_ms = MIN(MAX(duration_ms, ?), ?),
		page_count = MAX(page_count, ?),
		exit_url = COALESCE(NULLIF(?, ''), exit_url)
		WHERE id = ? AND site_id = ?`, now, m.DurationMs, maxSessionDurationMs, m.PageCount, m.ExitURL, sessionID, siteID)
	return err
}

// DeleteOldSessions removes sessions (and cascading chunks/pages) not seen
// within the retention window. Returns the number of sessions removed.
func (s *Store) DeleteOldSessions(days int) (int64, error) {
	cutoff := time.Now().AddDate(0, 0, -days).Unix()
	res, err := s.DB.Exec(`DELETE FROM sessions WHERE last_seen < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ---- Minimal user-agent parsing (no dependency; good enough for filters) ----

func ParseUA(ua string) (browser, osName, device string) {
	ua = strings.ToLower(ua)

	device = "desktop"
	switch {
	case strings.Contains(ua, "ipad"), strings.Contains(ua, "tablet"):
		device = "tablet"
	case strings.Contains(ua, "iphone"), strings.Contains(ua, "ipod"),
		strings.Contains(ua, "android") && strings.Contains(ua, "mobile"):
		device = "mobile"
	case strings.Contains(ua, "android"):
		device = "tablet"
	}

	switch {
	case strings.Contains(ua, "windows"):
		osName = "Windows"
	case strings.Contains(ua, "iphone"), strings.Contains(ua, "ipad"), strings.Contains(ua, "ipod"):
		osName = "iOS"
	case strings.Contains(ua, "mac os x"), strings.Contains(ua, "macintosh"):
		osName = "macOS"
	case strings.Contains(ua, "android"):
		osName = "Android"
	case strings.Contains(ua, "cros"):
		osName = "ChromeOS"
	case strings.Contains(ua, "linux"):
		osName = "Linux"
	default:
		osName = "Unknown"
	}

	switch {
	case strings.Contains(ua, "bot"), strings.Contains(ua, "crawl"), strings.Contains(ua, "spider"):
		browser = "Bot"
	case strings.Contains(ua, "edg/"), strings.Contains(ua, "edge"):
		browser = "Edge"
	case strings.Contains(ua, "opr/"), strings.Contains(ua, "opera"):
		browser = "Opera"
	case strings.Contains(ua, "firefox"):
		browser = "Firefox"
	case strings.Contains(ua, "chrome"), strings.Contains(ua, "crios"):
		browser = "Chrome"
	case strings.Contains(ua, "safari"):
		browser = "Safari"
	default:
		browser = "Other"
	}
	return browser, osName, device
}
