package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// ---- Dashboard log endpoints (auth-protected, same-origin) ----

func parseLogFilter(r *http.Request) (LogFilter, error) {
	q := r.URL.Query()
	f := LogFilter{
		Severity:  strings.TrimSpace(q.Get("severity")),
		SessionID: strings.TrimSpace(q.Get("session_id")),
		Limit:     maxLogListLimit,
	}
	if f.Severity != "" && !validLogSeverity(f.Severity) {
		return f, fmt.Errorf("invalid severity")
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
		if err != nil || n <= 0 || n > maxLogListLimit {
			return f, fmt.Errorf("limit must be 1-%d", maxLogListLimit)
		}
		f.Limit = n
	}
	return f, nil
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
