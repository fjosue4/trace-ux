package main

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// ---- Dashboard session endpoints (auth-protected, same-origin) ----

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	siteID, err := strconv.ParseInt(q.Get("site_id"), 10, 64)
	if err != nil || siteID <= 0 {
		writeErr(w, http.StatusBadRequest, "site_id is required")
		return
	}
	f := SessionFilter{
		Browser: q.Get("browser"),
		OS:      q.Get("os"),
		Device:  q.Get("device"),
		URL:     q.Get("url"),
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
	sessions, err := s.store.ListSessions(siteID, f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sessions)
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
	writeJSON(w, http.StatusOK, map[string]any{"session": sess, "pages": pages})
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
