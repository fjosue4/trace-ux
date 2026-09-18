package main

import (
	"compress/gzip"
	"crypto/sha256"
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

	"trace-ux/server/store"
)

const (
	maxSessionIDLength = 64
	maxEventCount      = 5_000
	maxURLLength       = 2_048
	maxReferrerLength  = 2_048
	maxTitleLength     = 512
	maxUTMLength       = 256
	maxIdentityLength  = 256
	maxUserAgentLength = 1_024
	maxPageIndex       = 10_000
	maxLogCount        = 100
	maxLogMessageBytes = 8 << 10
	maxLogClientSeq    = 1_000_000_000
)

var errRequestBodyTooLarge = errors.New("request body too large")

type ingestEnvelope struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
}

type ingestCustomEvent struct {
	TS      int64  `json:"ts"`
	Name    string `json:"name"`
	TrackID string `json:"track_id"`
	// Notify asks for a Slack notification alongside storing the event (see
	// the "custom" Slack notification kind). It is never persisted.
	Notify bool `json:"notify,omitempty"`
}

type ingestCustom struct {
	Type      string              `json:"type"`
	SessionID string              `json:"session_id"`
	Events    []ingestCustomEvent `json:"events"`
}

type ingestLog struct {
	ClientSeq   int64  `json:"client_seq"`
	TimestampMs int64  `json:"timestamp_ms"`
	Severity    string `json:"severity"`
	Message     string `json:"message"`
	URL         string `json:"url"`
}

type ingestLogs struct {
	Type      string      `json:"type"`
	SessionID string      `json:"session_id"`
	Logs      []ingestLog `json:"logs"`
}

type ingestFeedback struct {
	Type       string                 `json:"type"`
	SessionID  string                 `json:"session_id"`
	VisitorKey string                 `json:"visitor_key"`
	UserID     string                 `json:"user_id"`
	SurveyID   string                 `json:"survey_id"`
	Rating     int                    `json:"rating"`
	Comment    string                 `json:"comment"`
	Answers    []store.FeedbackAnswer `json:"answers"`
}

type ingestEvents struct {
	Type      string            `json:"type"`
	SessionID string            `json:"session_id"`
	Seq       int               `json:"seq"`
	Events    []json.RawMessage `json:"events"`
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
	if env.Type == "logs" && (!site.RecordingEnabled || !site.Settings.Logs.Enabled) {
		// Logs are recording context, so they follow both the recording toggle
		// and the per-site log toggle.
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

	var insertedLogs []store.Log
	var insertedCustom []store.CustomEvent
	switch env.Type {
	case "hello":
		var m store.IngestHello
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
		err = s.store.SaveHelloWithCountry(site.ID, env.SessionID, s.userAgent(r), s.ipHash(r), s.countryFromRequest(r), &m)
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
			if len(event) == 0 {
				writeErr(w, http.StatusBadRequest, "empty event")
				return
			}
			// The size is in the message on purpose. Without it this 400 is a
			// bare string in the network tab, and the visible symptom -- a
			// replay that scrubs but renders nothing -- points at the player
			// rather than at ingest.
			if limit := s.maxEventBytes(); len(event) > limit {
				writeErr(w, http.StatusBadRequest, fmt.Sprintf(
					"event is too large: %d bytes, limit %d (raise TRACE_UX_MAX_EVENT_MB)",
					len(event), limit))
				return
			}
		}
		if m.Seq < 0 || m.Seq > 1_000_000 {
			writeErr(w, http.StatusBadRequest, "invalid seq")
			return
		}
		err = s.store.SaveEvents(site.ID, env.SessionID, m.Seq, m.Events)
	case "page":
		var m store.IngestPage
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
		var m store.IngestPing
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
		events := make([]store.CustomEvent, 0, len(m.Events))
		for _, e := range m.Events {
			if e.TS <= 0 || len(e.Name) == 0 || len(e.Name) > 100 || len(e.TrackID) > 100 {
				writeErr(w, http.StatusBadRequest, "invalid custom event")
				return
			}
			events = append(events, store.CustomEvent{TS: e.TS, Name: e.Name, TrackID: e.TrackID, Notify: e.Notify})
		}
		insertedCustom, err = s.store.SaveCustomEvents(site.ID, env.SessionID, events)
	case "logs":
		var m ingestLogs
		if err := json.Unmarshal(body, &m); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid logs")
			return
		}
		if len(m.Logs) == 0 {
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		if len(m.Logs) > maxLogCount {
			writeErr(w, http.StatusBadRequest, "too many logs")
			return
		}
		logs := make([]store.Log, 0, len(m.Logs))
		for _, item := range m.Logs {
			if item.ClientSeq <= 0 || item.ClientSeq > maxLogClientSeq || item.TimestampMs <= 0 ||
				!store.ValidLogSeverity(item.Severity) || len(item.Message) > maxLogMessageBytes || len(item.URL) > maxURLLength {
				writeErr(w, http.StatusBadRequest, "invalid log")
				return
			}
			// The tracker filters before sending, but the server must enforce the
			// configured allow-list for untrusted clients as well.
			if !store.LogSeveritySelected(item.Severity, site.Settings.Logs.Severities) {
				continue
			}
			logs = append(logs, store.Log{
				ClientSeq:   item.ClientSeq,
				TimestampMs: item.TimestampMs,
				Severity:    item.Severity,
				Message:     item.Message,
				URL:         item.URL,
			})
		}
		if len(logs) == 0 {
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		insertedLogs, err = s.store.SaveLogs(site.ID, env.SessionID, logs)
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
		if len(m.VisitorKey) > 100 {
			m.VisitorKey = ""
		}
		if len(m.UserID) > maxIdentityLength {
			m.UserID = ""
		}
		_, err = s.store.SaveFeedback(store.NewFeedback{
			SiteID:      site.ID,
			SessionID:   env.SessionID,
			VisitorKey:  m.VisitorKey,
			UserID:      m.UserID,
			SurveyID:    m.SurveyID,
			Rating:      m.Rating,
			Comment:     m.Comment,
			AnswersJSON: answersJSON,
		})
	default:
		writeErr(w, http.StatusBadRequest, "unknown batch type")
		return
	}

	if err != nil {
		if errors.Is(err, store.ErrSessionSiteMismatch) {
			writeErr(w, http.StatusBadRequest, "invalid session")
			return
		}
		log.Printf("ingest %s: %v", env.Type, err)
		writeErr(w, http.StatusInternalServerError, "storage error")
		return
	}
	if len(insertedLogs) > 0 {
		s.notifySlackLogs(site, insertedLogs, r)
	}
	if len(insertedCustom) > 0 {
		s.notifySlackCustomEvents(site, insertedCustom, r)
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

// maxEventBytes is the configured per-event ceiling, falling back to the
// default when a Config was built without loadConfig -- tests, or anything
// embedding the server. A zero here would reject every event and produce
// exactly the blank replay this cap already caused once.
func (s *Server) maxEventBytes() int {
	if s.cfg != nil && s.cfg.MaxEventBytes > 0 {
		return s.cfg.MaxEventBytes
	}
	return defaultMaxEventMB << 20
}

// checkoutIntervalMS is the cadence handed to rrweb. Zero would be served to
// the tracker verbatim and disable re-snapshotting altogether, so it falls back
// the same way.
func (s *Server) checkoutIntervalMS() int {
	if s.cfg != nil && s.cfg.CheckoutIntervalMS > 0 {
		return s.cfg.CheckoutIntervalMS
	}
	return defaultCheckoutIntervalMS
}

// readBody reads the request body, transparently decoding gzip. Browsers forbid
// setting Content-Encoding on sendBeacon/fetch, so the tracker signals gzip
// with a ?gz=1 query parameter; a real Content-Encoding header is honored too.
func readBody(r *http.Request) ([]byte, error) {
	if r.ContentLength > int64(store.IngestBodyLimit) {
		return nil, errRequestBodyTooLarge
	}
	var reader io.Reader = io.LimitReader(r.Body, int64(store.IngestBodyLimit)+1)
	if r.URL.Query().Get("gz") == "1" || strings.EqualFold(r.Header.Get("Content-Encoding"), "gzip") {
		zr, err := gzip.NewReader(reader)
		if err != nil {
			return nil, err
		}
		defer zr.Close()
		reader = io.LimitReader(zr, int64(store.IngestBodyLimit)+1)
	}
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if len(body) > store.IngestBodyLimit {
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

// countryFromRequest reads the country supplied by a trusted reverse proxy.
// TraceUX deliberately does not ask the browser for geolocation or store raw
// IP addresses. The proxy must be listed in TRACE_UX_TRUSTED_PROXIES before
// any of these headers are accepted.
func (s *Server) countryFromRequest(r *http.Request) string {
	if r == nil || s.cfg == nil {
		return ""
	}
	remote := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	remoteIP := net.ParseIP(remote)
	if remoteIP == nil || !trustedProxy(remoteIP, s.cfg.TrustedProxyCIDRs) {
		return ""
	}

	for _, header := range []string{
		"CF-IPCountry",
		"CloudFront-Viewer-Country",
		"X-Country-Code",
		"X-Geo-Country",
		"X-Forwarded-Country",
	} {
		if country := normalizeCountryCode(r.Header.Get(header)); country != "" {
			return country
		}
	}
	return ""
}

func normalizeCountryCode(value string) string {
	value = strings.TrimSpace(value)
	if len(value) != 2 {
		return ""
	}
	code := []byte(strings.ToUpper(value))
	if string(code) == "XX" {
		return ""
	}
	for _, c := range code {
		if c < 'A' || c > 'Z' {
			return ""
		}
	}
	return string(code)
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
