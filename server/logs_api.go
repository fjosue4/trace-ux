package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"trace-ux/server/store"
)

// ---- Dashboard log endpoints (auth-protected, same-origin) ----

func parseLogFilter(r *http.Request) (store.LogFilter, error) {
	q := r.URL.Query()
	f := store.LogFilter{
		SessionID: strings.TrimSpace(q.Get("session_id")),
		Search:    strings.TrimSpace(q.Get("search")),
		Limit:     store.MaxLogListLimit,
	}
	if value := strings.TrimSpace(q.Get("service_id")); value != "" {
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id <= 0 {
			return f, fmt.Errorf("invalid service_id")
		}
		f.ServiceID = id
	}
	f.Environment = strings.TrimSpace(q.Get("environment"))
	if len(f.Environment) > store.MaxLogEnvironmentLength {
		return f, fmt.Errorf("environment is too long")
	}
	f.SearchIn = strings.TrimSpace(q.Get("search_in"))
	if f.SearchIn == "" {
		// Preserve the original broad dashboard/API search for older callers.
		// The new dashboard sends an explicit message/extra/both scope.
		f.SearchIn = "all"
	}
	if f.SearchIn != "message" && f.SearchIn != "extra" && f.SearchIn != "both" && f.SearchIn != "all" {
		return f, fmt.Errorf("search_in must be message, extra, or both")
	}
	if len(f.Search) > 256 {
		return f, fmt.Errorf("search must be 256 characters or fewer")
	}
	var severities []string
	seenSeverities := map[string]bool{}
	for _, raw := range q["severity"] {
		for _, value := range strings.Split(raw, ",") {
			severity := strings.TrimSpace(value)
			if severity == "" {
				continue
			}
			if !store.ValidLogSeverity(severity) {
				return f, fmt.Errorf("invalid severity")
			}
			if !seenSeverities[severity] {
				severities = append(severities, severity)
				seenSeverities[severity] = true
			}
		}
	}
	if len(severities) == 1 {
		f.Severity = severities[0]
	} else if len(severities) > 1 {
		f.Severities = severities
	}
	if f.SessionID != "" && (len(f.SessionID) > maxSessionIDLength || !validSessionID(f.SessionID)) {
		return f, fmt.Errorf("invalid session_id")
	}
	if value := q.Get("site_id"); value != "" {
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id <= 0 {
			return f, fmt.Errorf("invalid site_id")
		}
		f.SiteID = id
	}
	if value := q.Get("before_id"); value != "" {
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id <= 0 {
			return f, fmt.Errorf("invalid before_id")
		}
		f.BeforeID = id
	}
	for key, target := range map[string]*int64{"from_ms": &f.FromMs, "to_ms": &f.ToMs} {
		if value := q.Get(key); value != "" {
			ms, err := strconv.ParseInt(value, 10, 64)
			if err != nil || ms <= 0 {
				return f, fmt.Errorf("invalid %s", key)
			}
			*target = ms
		}
	}
	if f.FromMs > 0 && f.ToMs > 0 && f.FromMs > f.ToMs {
		return f, fmt.Errorf("from_ms must be before to_ms")
	}
	if value := q.Get("limit"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n <= 0 || n > store.MaxLogListLimit {
			return f, fmt.Errorf("limit must be 1-%d", store.MaxLogListLimit)
		}
		f.Limit = n
	}
	return f, nil
}

func (s *Server) handleLogOptions(w http.ResponseWriter, r *http.Request) {
	var siteID int64
	if value := r.URL.Query().Get("site_id"); value != "" {
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid site_id")
			return
		}
		siteID = id
	}
	options, err := s.store.LogOptions(siteID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, options)
}

type serviceLogIngestRequest struct {
	Logs []store.ServiceLogEntry `json:"logs"`
}

// handleServiceLogIngest is intentionally independent from tracker ingest.
// The generated service key identifies both the site and service; callers may
// use either the dedicated header or a Bearer token.
func (s *Server) handleServiceLogIngest(w http.ResponseWriter, r *http.Request) {
	key := serviceKeyFromRequest(r, "X-TraceUX-Log-Key")
	service, allowed, valid, err := s.store.ServiceForKey(key)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !valid {
		writeErr(w, http.StatusUnauthorized, "invalid service key")
		return
	}
	s.initSecurity()
	if !s.ingestIPLimiter.allow("ip:"+s.clientIP(r)) || !s.ingestSiteLimiter.allow(fmt.Sprintf("logs-service:%d", service.ID)) {
		writeRateLimited(w, "log ingest rate limit exceeded")
		return
	}
	body, err := readBody(r)
	if err != nil {
		if err == errRequestBodyTooLarge {
			writeErr(w, http.StatusRequestEntityTooLarge, "request body too large")
		} else {
			writeErr(w, http.StatusBadRequest, "unreadable body")
		}
		return
	}
	var payload serviceLogIngestRequest
	dec := json.NewDecoder(strings.NewReader(string(body)))
	if err := dec.Decode(&payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(payload.Logs) == 0 || len(payload.Logs) > store.MaxServiceLogBatch {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("logs must contain 1-%d entries", store.MaxServiceLogBatch))
		return
	}
	inserted, skipped, err := s.store.SaveServiceLogsReturning(service, allowed, payload.Logs)
	if err != nil {
		if strings.Contains(err.Error(), "logs[") {
			writeErr(w, http.StatusBadRequest, err.Error())
		} else {
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	// Service logs feed the same per-site Slack log alert as browser logs.
	if len(inserted) > 0 {
		if name, err := s.store.SiteName(service.SiteID); err == nil {
			s.notifySlackLogs(store.Site{ID: service.SiteID, Name: name}, inserted, r)
		} else {
			log.Printf("slack logs: site %d: %v", service.SiteID, err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"accepted": len(inserted), "skipped": skipped})
}

// serviceKeyFromRequest keeps the generated service credential independent of
// any one telemetry stream. Stream-specific headers remain accepted while
// integrations migrate to the shared header.
func serviceKeyFromRequest(r *http.Request, legacyHeaders ...string) string {
	if key := strings.TrimSpace(r.Header.Get("X-TraceUX-Service-Key")); key != "" {
		return key
	}
	for _, header := range legacyHeaders {
		if key := strings.TrimSpace(r.Header.Get(header)); key != "" {
			return key
		}
	}
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[len("Bearer "):])
	}
	return ""
}

func (s *Server) handleListLogs(w http.ResponseWriter, r *http.Request) {
	f, err := parseLogFilter(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	logs, err := s.store.ListLogs(f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func (s *Server) handleFrequentErrors(w http.ResponseWriter, r *http.Request) {
	f, err := parseLogFilter(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	errors, err := s.store.FrequentErrors(f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, errors)
}

func (s *Server) handleFrequentErrorOccurrences(w http.ResponseWriter, r *http.Request) {
	representativeID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || representativeID <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid representative log id")
		return
	}
	f, err := parseLogFilter(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	logs, err := s.store.FrequentErrorOccurrences(representativeID, f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

// handleGetLog serves one log for a direct link (/logs/log/<id>). It uses the
// same auth as the list: anyone who can see the Logs page can open a log.
func (s *Server) handleGetLog(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid log id")
		return
	}
	item, err := s.store.GetLog(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		writeErr(w, http.StatusNotFound, "log not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleLogStats(w http.ResponseWriter, r *http.Request) {
	f, err := parseLogFilter(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	stats, err := s.store.LogStats(f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}
