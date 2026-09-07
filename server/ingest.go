package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Ingest accepts batched tracker payloads. The client generates the session id
// and a monotonically increasing seq per chunk, so batches arrive unordered and
// retryable without server round-trips.

const ingestBodyLimit = 10 << 20 // 10 MB

const (
	maxSessionIDLength = 64
	maxEventCount      = 5_000
	maxEventBytes      = 512 << 10
	maxURLLength       = 2_048
	maxReferrerLength  = 2_048
	maxTitleLength     = 512
	maxUTMLength       = 256
	maxIdentityLength  = 256
	maxUserAgentLength = 1_024
	maxPageIndex       = 10_000
)

var (
	errRequestBodyTooLarge = errors.New("request body too large")
	errSessionSiteMismatch = errors.New("session belongs to another site")
)

// maxSessionDurationMs mirrors the tracker's MAX_SESSION_MS: one session never
// spans more than 2h of active time. The tracker splits marathon visits into a
// fresh session; this cap keeps buggy or hostile clients from inflating the
// stored duration beyond what the split would have produced.
const maxSessionDurationMs = 2 * 60 * 60 * 1000

type ingestEnvelope struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
}

type ingestHello struct {
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

type ingestCustomEvent struct {
	TS      int64  `json:"ts"`
	Name    string `json:"name"`
	TrackID string `json:"track_id"`
}

type ingestCustom struct {
	Type      string              `json:"type"`
	SessionID string              `json:"session_id"`
	Events    []ingestCustomEvent `json:"events"`
}

type ingestFeedback struct {
	Type      string           `json:"type"`
	SessionID string           `json:"session_id"`
	SurveyID  string           `json:"survey_id"`
	Rating    int              `json:"rating"`
	Comment   string           `json:"comment"`
	Answers   []FeedbackAnswer `json:"answers"`
}

type ingestEvents struct {
	Type      string            `json:"type"`
	SessionID string            `json:"session_id"`
	Seq       int               `json:"seq"`
	Events    []json.RawMessage `json:"events"`
}

type ingestPage struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	Idx       int    `json:"idx"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	EnteredAt int64  `json:"entered_at"`
}

type ingestPing struct {
	Type       string `json:"type"`
	SessionID  string `json:"session_id"`
	DurationMs int64  `json:"duration_ms"`
	PageCount  int    `json:"page_count"`
	ExitURL    string `json:"exit_url"`
}

func (s *Server) handleIngest(w http.ResponseWriter, r *http.Request) {
	site, err := s.store.GetSiteByKey(r.PathValue("siteKey"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if site.ID == 0 {
		// Unknown keys get a silent 204: do not confirm or deny key validity
		// to third parties probing the endpoint.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.initSecurity()
	clientKey := "ip:" + s.clientIP(r)
	if !s.ingestIPLimiter.allow(clientKey) || !s.ingestSiteLimiter.allow(fmt.Sprintf("site:%d", site.ID)) {
		writeRateLimited(w, "ingest rate limit exceeded")
		return
	}

	body, err := readBody(r)
	if err != nil {
		if errors.Is(err, errRequestBodyTooLarge) {
			writeErr(w, http.StatusRequestEntityTooLarge, "request body too large")
		} else {
			writeErr(w, http.StatusBadRequest, "unreadable body")
		}
		return
	}
	var env ingestEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	// Feedback can be anonymous (no recording to attach to); every other batch
	// type belongs to a session.
	needsSession := env.Type != "feedback"
	if needsSession && (env.SessionID == "" || len(env.SessionID) > maxSessionIDLength || !validSessionID(env.SessionID)) {
		writeErr(w, http.StatusBadRequest, "missing session_id")
		return
	}
	if !needsSession && env.SessionID != "" && (len(env.SessionID) > maxSessionIDLength || !validSessionID(env.SessionID)) {
		writeErr(w, http.StatusBadRequest, "invalid session_id")
		return
	}
	if len(r.Header.Get("User-Agent")) > maxUserAgentLength {
		writeErr(w, http.StatusBadRequest, "user-agent too long")
		return
	}
	if env.Type == "events" && !site.RecordingEnabled {
		// Recordings are toggled per site from the dashboard; lightweight
		// batches (hello/ping/page/custom/feedback) still flow so the feedback
		// channel keeps working while recording is off.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if env.Type == "events" {
		ok, err := s.store.CanStartRecording(site.ID, env.SessionID, site.Settings.MaxConcurrentSessions)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			// Per-site cap on simultaneous recordings reached.
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}

	switch env.Type {
	case "hello":
		var m ingestHello
		if err := json.Unmarshal(body, &m); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid hello")
			return
		}
		if len(m.URL) > maxURLLength || len(m.Referrer) > maxReferrerLength ||
			len(m.UTMSource) > maxUTMLength || len(m.UTMMedium) > maxUTMLength ||
			len(m.UTMCampaign) > maxUTMLength || len(m.Lang) > 64 ||
			len(m.UserID) > maxIdentityLength || len(m.ClientID) > maxIdentityLength ||
			len(m.RemoteID) > maxIdentityLength || m.ViewportW < 0 || m.ViewportW > 100_000 ||
			m.ViewportH < 0 || m.ViewportH > 100_000 || m.ScreenW < 0 || m.ScreenW > 100_000 ||
			m.ScreenH < 0 || m.ScreenH > 100_000 {
			writeErr(w, http.StatusBadRequest, "invalid hello metadata")
			return
		}
		err = s.store.SaveHello(site.ID, env.SessionID, s.userAgent(r), s.ipHash(r), &m)
	case "events":
		var m ingestEvents
		if err := json.Unmarshal(body, &m); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid events")
			return
		}
		if len(m.Events) == 0 {
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		if len(m.Events) > maxEventCount {
			writeErr(w, http.StatusBadRequest, "too many events")
			return
		}
		for _, event := range m.Events {
			if len(event) == 0 || len(event) > maxEventBytes {
				writeErr(w, http.StatusBadRequest, "event is too large")
				return
			}
		}
		if m.Seq < 0 || m.Seq > 1_000_000 {
			writeErr(w, http.StatusBadRequest, "invalid seq")
			return
		}
		err = s.store.SaveEvents(site.ID, env.SessionID, m.Seq, m.Events)
	case "page":
		var m ingestPage
		if err := json.Unmarshal(body, &m); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid page")
			return
		}
		if m.Idx < 0 || m.Idx > maxPageIndex || len(m.URL) > maxURLLength || len(m.Title) > maxTitleLength || m.EnteredAt < 0 {
			writeErr(w, http.StatusBadRequest, "invalid page metadata")
			return
		}
		err = s.store.SavePage(site.ID, env.SessionID, &m)
	case "ping":
		var m ingestPing
		if err := json.Unmarshal(body, &m); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid ping")
			return
		}
		if m.DurationMs < 0 || m.PageCount < 0 || m.PageCount > maxPageIndex || len(m.ExitURL) > maxURLLength {
			writeErr(w, http.StatusBadRequest, "invalid ping metadata")
			return
		}
		err = s.store.SavePing(site.ID, env.SessionID, &m)
	case "custom":
		var m ingestCustom
		if err := json.Unmarshal(body, &m); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid custom events")
			return
		}
		if len(m.Events) == 0 {
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		if len(m.Events) > 100 {
			writeErr(w, http.StatusBadRequest, "too many custom events")
			return
		}
		events := make([]CustomEvent, 0, len(m.Events))
		for _, e := range m.Events {
			if e.TS <= 0 || len(e.Name) == 0 || len(e.Name) > 100 || len(e.TrackID) > 100 {
				writeErr(w, http.StatusBadRequest, "invalid custom event")
				return
			}
			events = append(events, CustomEvent{TS: e.TS, Name: e.Name, TrackID: e.TrackID})
		}
		err = s.store.SaveCustomEvents(site.ID, env.SessionID, events)
	case "feedback":
		var m ingestFeedback
		if err := json.Unmarshal(body, &m); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid feedback")
			return
		}
		if m.Rating < 0 || m.Rating > 10 {
			writeErr(w, http.StatusBadRequest, "rating must be 0-10")
			return
		}
		if len(m.Comment) > 2000 || len(m.SurveyID) > 100 {
			writeErr(w, http.StatusBadRequest, "feedback payload too long")
			return
		}
		if len(m.Answers) > 20 {
			writeErr(w, http.StatusBadRequest, "too many answers")
			return
		}
		for _, a := range m.Answers {
			if len(a.ID) == 0 || len(a.ID) > 100 || len(a.Label) > 200 || len(a.Value) > 1000 {
				writeErr(w, http.StatusBadRequest, "invalid answer")
				return
			}
		}
		if m.SurveyID == "" {
			m.SurveyID = "default"
		}
		// Custom surveys may not ask a numeric question; derive the stored
		// rating from the first numeric answer so summaries stay meaningful.
		if m.Rating == 0 {
			for _, a := range m.Answers {
				if v, err := strconv.Atoi(a.Value); err == nil && v >= 0 && v <= 10 {
					m.Rating = v
					break
				}
			}
		}
		answersJSON := ""
		if len(m.Answers) > 0 {
			if b, err := json.Marshal(m.Answers); err == nil {
				answersJSON = string(b)
			}
		}
		_, err = s.store.SaveFeedback(site.ID, env.SessionID, m.SurveyID, m.Rating, m.Comment, answersJSON)
	default:
		writeErr(w, http.StatusBadRequest, "unknown batch type")
		return
	}

	if err != nil {
		if errors.Is(err, errSessionSiteMismatch) {
			writeErr(w, http.StatusBadRequest, "invalid session")
			return
		}
		log.Printf("ingest %s: %v", env.Type, err)
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func validSessionID(id string) bool {
	for _, c := range id {
		ok := c == '-' || c == '_' ||
			(c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
		if !ok {
			return false
		}
	}
	return true
}

// readBody reads the request body, transparently decoding gzip. Browsers forbid
// setting Content-Encoding on sendBeacon/fetch, so the tracker signals gzip
// with a ?gz=1 query parameter; a real Content-Encoding header is honored too.
func readBody(r *http.Request) ([]byte, error) {
	if r.ContentLength > ingestBodyLimit {
		return nil, errRequestBodyTooLarge
	}
	var reader io.Reader = io.LimitReader(r.Body, ingestBodyLimit+1)
	if r.URL.Query().Get("gz") == "1" || strings.EqualFold(r.Header.Get("Content-Encoding"), "gzip") {
		zr, err := gzip.NewReader(reader)
		if err != nil {
			return nil, err
		}
		defer zr.Close()
		reader = io.LimitReader(zr, ingestBodyLimit+1)
	}
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if len(body) > ingestBodyLimit {
		return nil, errRequestBodyTooLarge
	}
	return body, nil
}

func (s *Server) clientIP(r *http.Request) string {
	remote := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	remoteIP := net.ParseIP(remote)
	if remoteIP == nil || s.cfg == nil || !trustedProxy(remoteIP, s.cfg.TrustedProxyCIDRs) {
		return remote
	}
	parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		candidate := strings.TrimSpace(parts[i])
		if host, _, err := net.SplitHostPort(candidate); err == nil {
			candidate = host
		}
		ip := net.ParseIP(candidate)
		if ip == nil {
			continue
		}
		if !trustedProxy(ip, s.cfg.TrustedProxyCIDRs) {
			return ip.String()
		}
	}
	return remoteIP.String()
}

func trustedProxy(ip net.IP, networks []*net.IPNet) bool {
	for _, network := range networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// ipHash: salted, truncated — enough for returning-visitor counting later,
// useless for identifying a person. The raw IP is never stored.
func (s *Server) ipHash(r *http.Request) string {
	h := sha256.New()
	h.Write(s.secret)
	h.Write([]byte(s.clientIP(r)))
	return hex.EncodeToString(h.Sum(nil))[:32]
}

func (s *Server) userAgent(r *http.Request) string {
	return r.Header.Get("User-Agent")
}

// ---- Store: session persistence ----

func (s *Store) ensureSessionForSite(siteID int64, sessionID string, now int64) error {
	if _, err := s.db.Exec(`INSERT INTO sessions (id, site_id, started_at, last_seen) VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING`, sessionID, siteID, now, now); err != nil {
		return err
	}
	var owner int64
	if err := s.db.QueryRow(`SELECT site_id FROM sessions WHERE id = ?`, sessionID).Scan(&owner); err != nil {
		if err == sql.ErrNoRows {
			return errSessionSiteMismatch
		}
		return err
	}
	if owner != siteID {
		return errSessionSiteMismatch
	}
	return nil
}

func (s *Store) touchSession(sessionID string) {
	s.db.Exec(`UPDATE sessions SET last_seen = ? WHERE id = ?`, time.Now().Unix(), sessionID)
}

func (s *Store) SaveHello(siteID int64, sessionID, ua, ipHash string, m *ingestHello) error {
	now := time.Now().Unix()
	if err := s.ensureSessionForSite(siteID, sessionID, now); err != nil {
		return err
	}
	// Session metadata is set-if-empty: the first page of a visit provides the
	// attribution (referrer, UTM, initial URL); later page loads in the same
	// session send hello again and must not overwrite it. Visitor identity is
	// the opposite: a non-empty id always wins, so a mid-visit
	// window.TraceUX.identify() sticks for the rest of the session.
	browser, osName, device := parseUA(ua)
	_, err := s.db.Exec(`UPDATE sessions SET
		initial_url = COALESCE(NULLIF(initial_url, ''), ?),
		referrer    = COALESCE(NULLIF(referrer, ''), CASE WHEN COALESCE(initial_url, '') = '' THEN ? ELSE referrer END),
		utm_source   = COALESCE(NULLIF(utm_source, ''), ?),
		utm_medium   = COALESCE(NULLIF(utm_medium, ''), ?),
		utm_campaign = COALESCE(NULLIF(utm_campaign, ''), ?),
		user_id      = CASE WHEN ? != '' THEN ? ELSE user_id END,
		client_id    = CASE WHEN ? != '' THEN ? ELSE client_id END,
		remote_id    = CASE WHEN ? != '' THEN ? ELSE remote_id END,
		viewport_w = COALESCE(NULLIF(viewport_w, 0), ?),
		viewport_h = COALESCE(NULLIF(viewport_h, 0), ?),
		screen_w   = COALESCE(NULLIF(screen_w, 0), ?),
		screen_h   = COALESCE(NULLIF(screen_h, 0), ?),
		browser    = COALESCE(NULLIF(browser, ''), ?),
		os         = COALESCE(NULLIF(os, ''), ?),
		device     = COALESCE(NULLIF(device, ''), ?),
		user_agent = COALESCE(NULLIF(user_agent, ''), ?),
		ip_hash    = COALESCE(NULLIF(ip_hash, ''), ?),
		last_seen  = ?
		WHERE id = ? AND site_id = ?`,
		m.URL, m.Referrer, m.UTMSource, m.UTMMedium, m.UTMCampaign,
		m.UserID, m.UserID, m.ClientID, m.ClientID, m.RemoteID, m.RemoteID,
		m.ViewportW, m.ViewportH, m.ScreenW, m.ScreenH,
		browser, osName, device, ua, ipHash, now, sessionID, siteID)
	return err
}

func (s *Store) SaveEvents(siteID int64, sessionID string, seq int, events []json.RawMessage) error {
	now := time.Now().Unix()
	if err := s.ensureSessionForSite(siteID, sessionID, now); err != nil {
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
	if _, err := s.db.Exec(`INSERT INTO chunks (session_id, seq, events, data, created_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(session_id, seq) DO UPDATE SET data = excluded.data, events = excluded.events`,
		sessionID, seq, len(events), buf.Bytes(), now); err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE sessions SET
		last_seen = ?,
		event_count = (SELECT COALESCE(SUM(events), 0) FROM chunks WHERE session_id = ?)
		WHERE id = ? AND site_id = ?`, now, sessionID, sessionID, siteID)
	return err
}

func (s *Store) SavePage(siteID int64, sessionID string, m *ingestPage) error {
	now := time.Now().Unix()
	if err := s.ensureSessionForSite(siteID, sessionID, now); err != nil {
		return err
	}
	// left_at starts open (0) and is closed when the next page of the same
	// session arrives, so the pages timeline reflects real dwell times.
	if _, err := s.db.Exec(`INSERT INTO pages (session_id, idx, url, title, entered_at, left_at) VALUES (?, ?, ?, ?, ?, 0)
		ON CONFLICT(session_id, idx) DO UPDATE SET url = excluded.url, title = excluded.title, entered_at = excluded.entered_at`,
		sessionID, m.Idx, m.URL, m.Title, m.EnteredAt); err != nil {
		return err
	}
	if m.Idx > 0 {
		s.db.Exec(`UPDATE pages SET left_at = ? WHERE session_id = ? AND idx = ? AND left_at = 0`,
			m.EnteredAt, sessionID, m.Idx-1)
	}
	_, err := s.db.Exec(`UPDATE sessions SET
		last_seen = ?, page_count = MAX(page_count, ?),
		exit_url = ?
		WHERE id = ? AND site_id = ?`, now, m.Idx+1, m.URL, sessionID, siteID)
	return err
}

func (s *Store) SavePing(siteID int64, sessionID string, m *ingestPing) error {
	now := time.Now().Unix()
	if err := s.ensureSessionForSite(siteID, sessionID, now); err != nil {
		return err
	}
	// Cap duration at 2h to match the tracker's session split.
	_, err := s.db.Exec(`UPDATE sessions SET
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
	res, err := s.db.Exec(`DELETE FROM sessions WHERE last_seen < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ---- Minimal user-agent parsing (no dependency; good enough for filters) ----

func parseUA(ua string) (browser, osName, device string) {
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
