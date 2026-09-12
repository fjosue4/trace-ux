package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// ---- Dashboard session endpoints (auth-protected, same-origin) ----

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	// site_id is optional: without it the list spans every site and rows carry
	// their site name (the global Sessions page).
	f := SessionFilter{
		Browser:  q.Get("browser"),
		OS:       q.Get("os"),
		Device:   q.Get("device"),
		Country:  strings.ToUpper(strings.TrimSpace(q.Get("country"))),
		URL:      q.Get("url"),
		Action:   q.Get("action"),
		Identity: q.Get("visitor"),
	}
	if v := q.Get("site_id"); v != "" {
		siteID, err := strconv.ParseInt(v, 10, 64)
		if err != nil || siteID <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid site_id")
			return
		}
		f.SiteID = siteID
	}
	if v := q.Get("min_duration_ms"); v != "" {
		f.MinDurationMs, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := q.Get("before"); v != "" {
		f.Before, _ = strconv.ParseInt(v, 10, 64)
	}
	f.Limit = 50
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			f.Limit = n
		}
	}
	sessions, err := s.store.ListSessions(f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

// GET /api/sessions/countries?site_id=N — distinct country codes available
// for the sessions filter. The list is intentionally small and derived from
// stored session metadata rather than shipping a large country catalogue.
func (s *Server) handleListSessionCountries(w http.ResponseWriter, r *http.Request) {
	query := `SELECT DISTINCT country FROM sessions WHERE country != ''`
	args := []any{}
	if v := r.URL.Query().Get("site_id"); v != "" {
		siteID, err := strconv.ParseInt(v, 10, 64)
		if err != nil || siteID <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid site_id")
			return
		}
		query += ` AND site_id = ?`
		args = append(args, siteID)
	}
	query += ` ORDER BY country`

	rows, err := s.store.db.Query(query, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	countries := []string{}
	for rows.Next() {
		var country string
		if err := rows.Scan(&country); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		countries = append(countries, country)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, countries)
}

// GET /api/sessions/stats?site_id=N — in-progress vs completed session counts.
func (s *Server) handleSessionStats(w http.ResponseWriter, r *http.Request) {
	var siteID int64
	if v := r.URL.Query().Get("site_id"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil || id <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid site_id")
			return
		}
		siteID = id
	}
	active, completed, err := s.store.SessionActivityCounts(siteID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"active": active, "completed": completed})
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sess, err := s.store.GetSession(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "session not found")
		return
	}
	pages, err := s.store.GetSessionPages(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	activity, err := s.store.GetCustomEvents(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logs, err := s.store.GetSessionLogs(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"session":       sess,
		"pages":         pages,
		"custom_events": activity,
		"logs":          logs,
	})
}

// handleSessionEvents streams decompressed rrweb events page by page.
// GET /api/sessions/{id}/events?after_seq=N&max_events=M
// Response: {next_seq, has_more, events} — the player keeps calling until
// has_more is false, so long sessions load incrementally.
func (s *Server) handleSessionEvents(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	afterSeq := -1
	if v := r.URL.Query().Get("after_seq"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < -1 {
			writeErr(w, http.StatusBadRequest, "invalid after_seq")
			return
		}
		afterSeq = n
	}
	maxEvents := 200
	if v := r.URL.Query().Get("max_events"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 2000 {
			maxEvents = n
		}
	}

	seqs, err := s.store.GetSessionChunkSeqs(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	events := make([]json.RawMessage, 0, maxEvents)
	nextSeq := afterSeq
	hasMore := false
	for _, seq := range seqs {
		if seq <= afterSeq {
			continue
		}
		chunkEvents, err := s.store.GetSessionChunk(id, seq)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, ev := range chunkEvents {
			if len(events) == maxEvents {
				hasMore = true
				break
			}
			events = append(events, ev)
		}
		if hasMore {
			nextSeq = seq
			break
		}
		nextSeq = seq
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"next_seq": nextSeq,
		"has_more": hasMore,
		"events":   events,
	})
}

// handleDeleteSession removes a recording permanently. Allowed only when the
// owning site enables manual deletion, and only for admins (route gated).
func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sess, err := s.store.GetSession(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "session not found")
		return
	}
	site, _, _, _, err := s.store.GetSiteDetail(sess.SiteID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if site == nil || !site.Settings.AllowDeleteRecordings {
		writeErr(w, http.StatusForbidden, "manual recording deletion is disabled for this site")
		return
	}
	if err := s.store.DeleteSession(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
