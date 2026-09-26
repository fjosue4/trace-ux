package store

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"strings"
	"time"
)

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
	sess, err := scanSession(s.DB.QueryRow(`SELECT `+sessionCols+` FROM sessions WHERE id = ?`, id))
	if err != nil {
		return nil, err
	}
	return sess, nil
}

// listSessionsStandard is the correctness baseline used whenever the optional
// FTS accelerator is unavailable or cannot preserve the requested semantics.
func (s *Store) listSessionsStandard(ctx context.Context, f SessionFilter) ([]Session, error) {
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
	if f.Country != "" {
		query += ` AND s.country = ?`
		args = append(args, f.Country)
	}
	if f.URL != "" {
		// Match any path the session navigated through — pages holds the full
		// per-page timeline, so filtering covers every hop, not just entry/exit.
		like := "%" + f.URL + "%"
		query += ` AND (s.initial_url LIKE ? OR s.exit_url LIKE ? OR EXISTS
			(SELECT 1 FROM pages pg WHERE pg.session_id = s.id AND pg.url LIKE ?))`
		args = append(args, like, like, like)
	}
	if f.Action != "" {
		// Action searches the complete activity surface for a recording. The
		// category aliases make terms such as "clicks", "page visits", and
		// "logs" useful even when the stored row does not contain that exact
		// label (for example, a page row stores its URL and title only).
		for _, term := range strings.Fields(strings.ToLower(f.Action)) {
			like := "%" + term + "%"
			query += ` AND (
				EXISTS (
					SELECT 1 FROM custom_events ce
					WHERE ce.session_id = s.id
					  AND (LOWER(ce.name) LIKE ? OR LOWER(ce.track_id) LIKE ?
					       OR 'custom event events action actions activity activities' LIKE ?
					       OR (LOWER(ce.name) = 'click' AND 'click clicks clicked' LIKE ?))
				)
				OR LOWER(s.initial_url) LIKE ? OR LOWER(s.exit_url) LIKE ?
				OR EXISTS (
					SELECT 1 FROM pages pg
					WHERE pg.session_id = s.id
					  AND (LOWER(pg.url) LIKE ? OR LOWER(pg.title) LIKE ?
					       OR 'page pages visit visits navigation navigated opened action actions activity activities' LIKE ?)
				)
				OR EXISTS (
					SELECT 1 FROM logs lg
					WHERE lg.session_id = s.id
					  AND (LOWER(lg.message) LIKE ? OR LOWER(lg.url) LIKE ? OR LOWER(lg.severity) LIKE ?
					       OR 'log logs browser console debug info warn error action actions activity activities' LIKE ?)
					)
			)`
			args = append(args, like, like, like, like, like, like, like, like, like, like, like, like, like)
		}
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
	query += ` ORDER BY s.started_at DESC, s.rowid DESC LIMIT ?`
	args = append(args, f.Limit)

	rows, err := s.readDB.QueryContext(ctx, query, args...)
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
	Country       string
	URL           string
	Action        string // matches any custom event, page visit, or browser log in the session
	Identity      string // matches user_id / client_id / remote_id
	MinDurationMs int64
	Before        int64 // pagination cursor: started_at of the last row shown
	Limit         int
}

func (s *Store) GetSessionPages(sessionID string) ([]SessionPage, error) {
	rows, err := s.DB.Query(`SELECT idx, url, title, entered_at, left_at FROM pages WHERE session_id = ? ORDER BY idx`, sessionID)
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
	events, err := s.GetSessionChunkRaw(sessionID, seq)
	if err != nil {
		return nil, err
	}
	return s.RehydrateCSS(events)
}

// GetSessionChunkRaw returns the chunk with stylesheet references left in place.
//
// The replay path uses this. Rehydrating server-side means every checkout
// FullSnapshot carries a fresh copy of the page's whole stylesheet: measured on
// a 24-minute recording, 4 distinct sheets totalling 6.5 MB expanded 54 times
// into a 125 MB response, of which 98 MB was the same CSS over and over. The
// client instead fetches each sheet once from /api/css-assets/{hash}, where it
// is immutable and therefore cacheable across every recording of that site.
func (s *Store) GetSessionChunkRaw(sessionID string, seq int) ([]json.RawMessage, error) {
	var data []byte
	err := s.DB.QueryRow(`SELECT data FROM chunks WHERE session_id = ? AND seq = ?`, sessionID, seq).Scan(&data)
	if err != nil {
		return nil, err
	}
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	raw, err := io.ReadAll(io.LimitReader(zr, int64(IngestBodyLimit)))
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
	rows, err := s.DB.Query(`SELECT seq FROM chunks WHERE session_id = ? ORDER BY seq`, sessionID)
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
	// Details is structured context supplied by the host page. Notify is an
	// ingest-only delivery flag, and SessionID is filled in here for the replay
	// link since a caller only ever provides one session at a time.
	Details   json.RawMessage `json:"details,omitempty"`
	Notify    bool            `json:"-"`
	SessionID string          `json:"-"`
}

// SaveCustomEvents stores tracked events for a session; duplicates (retries)
// are ignored via the primary key. It returns the subset that were newly
// inserted, so a caller dispatching Slack notifications for notify-flagged
// events never sends the same one twice on a retried ingest request.
func (s *Store) SaveCustomEvents(siteID int64, sessionID string, events []CustomEvent) ([]CustomEvent, error) {
	now := time.Now().Unix()
	if err := s.EnsureSessionForSite(siteID, sessionID, now); err != nil {
		return nil, err
	}
	inserted := make([]CustomEvent, 0, len(events))
	for _, e := range events {
		res, err := s.DB.Exec(`INSERT OR IGNORE INTO custom_events (session_id, ts, name, track_id, details) VALUES (?, ?, ?, ?, ?)`,
			sessionID, e.TS, e.Name, e.TrackID, string(e.Details))
		if err != nil {
			return nil, err
		}
		if n, err := res.RowsAffected(); err == nil && n > 0 {
			e.SessionID = sessionID
			inserted = append(inserted, e)
		}
	}
	if _, err := s.DB.Exec(`UPDATE sessions SET last_seen = ? WHERE id = ? AND site_id = ?`, time.Now().Unix(), sessionID, siteID); err != nil {
		return nil, err
	}
	return inserted, nil
}

func (s *Store) GetCustomEvents(sessionID string) ([]CustomEvent, error) {
	rows, err := s.DB.Query(`SELECT ts, name, track_id, details FROM custom_events WHERE session_id = ? ORDER BY ts`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CustomEvent{}
	for rows.Next() {
		var e CustomEvent
		var details string
		if err := rows.Scan(&e.TS, &e.Name, &e.TrackID, &details); err != nil {
			return nil, err
		}
		if details != "" {
			e.Details = json.RawMessage(details)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetSessionLogs returns browser logs in recording order so the replay sidebar
// can place them on the same clock as tracked custom events.
func (s *Store) GetSessionLogs(sessionID string) ([]Log, error) {
	rows, err := s.DB.Query(`SELECT l.id, l.session_id, l.site_id, si.name,
		COALESCE(l.service_id, 0), COALESCE(sv.name, ''), l.environment, l.timestamp_ms,
		l.severity, l.message, l.extra, l.url, l.created_at, se.started_at
		FROM logs l
		JOIN sessions se ON se.id = l.session_id
		JOIN sites si ON si.id = l.site_id
		LEFT JOIN services sv ON sv.id = l.service_id
		WHERE l.session_id = ?
		ORDER BY l.timestamp_ms, l.id
		LIMIT ?`, sessionID, MaxLogListLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Log{}
	for rows.Next() {
		var item Log
		if err := rows.Scan(&item.ID, &item.SessionID, &item.SiteID, &item.SiteName,
			&item.ServiceID, &item.ServiceName, &item.Environment, &item.TimestampMs,
			&item.Severity, &item.Message, &item.Extra, &item.URL,
			&item.CreatedAt, &item.SessionStartedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
