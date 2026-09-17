package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"trace-ux/server/store"
)

// ---- Dashboard session endpoints (auth-protected, same-origin) ----

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	// site_id is optional: without it the list spans every site and rows carry
	// their site name (the global Sessions page).
	f := store.SessionFilter{
		Browser:  q.Get("browser"),
		OS:       q.Get("os"),
		Device:   q.Get("device"),
		Country:  strings.ToUpper(strings.TrimSpace(q.Get("country"))),
		URL:      q.Get("url"),
		Action:   strings.TrimSpace(q.Get("action")),
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

	rows, err := s.store.DB.Query(query, args...)
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
	// css=ref leaves stylesheet references unexpanded; the client resolves them
	// against /api/css-assets/{hash}, which it can cache. Default stays expanded
	// so an older dashboard keeps working unchanged.
	rawCSS := r.URL.Query().Get("css") == "ref"

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
		var chunkEvents []json.RawMessage
		if rawCSS {
			chunkEvents, err = s.store.GetSessionChunkRaw(id, seq)
		} else {
			chunkEvents, err = s.store.GetSessionChunk(id, seq)
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Whole chunks only. Splitting one silently LOSES the remainder: the
		// page stops at maxEvents and reports next_seq = this chunk, so the
		// following request resumes AFTER it and the leftover events are never
		// sent. Measured on a real 233-chunk recording: 5,935 of 25,629 events
		// -- 23% of the session -- vanished between the database and the player.
		//
		// A page may therefore overshoot maxEvents by up to one chunk. That is
		// the right trade: the cap exists to bound response size, not to be
		// exact, and no bound is worth dropping a quarter of a recording.
		events = append(events, chunkEvents...)
		nextSeq = seq
		if len(events) >= maxEvents {
			hasMore = true
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"next_seq": nextSeq,
		"has_more": hasMore,
		"events":   events,
	})
}

// cachedIndex is a seek table plus the chunk count it was built from, which is
// how staleness is detected on a recording that is still being written.
type cachedIndex struct {
	chunks []store.ChunkIndex
	nChunk int
}

// handleSessionIndex serves the seek table: which chunk covers which moment,
// and which chunks are valid starting points.
//
// Without this the player must download a recording from the beginning to find
// out where minute 20 lives. With it, seeking resolves to the nearest preceding
// FullSnapshot and loads from there -- the same reason a video file carries an
// index rather than making the player scan it.
func (s *Server) handleSessionIndex(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	seqs, err := s.store.GetSessionChunkSeqs(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.indexMu.Lock()
	if s.indexCache == nil {
		s.indexCache = map[string]cachedIndex{}
	}
	hit, ok := s.indexCache[id]
	s.indexMu.Unlock()

	// A live recording keeps gaining chunks, so an index built earlier
	// describes only part of it. Comparing counts is enough: chunks are
	// append-only and never rewritten.
	if !ok || hit.nChunk != len(seqs) {
		built, err := s.store.SessionIndex(id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		hit = cachedIndex{chunks: built, nChunk: len(seqs)}
		s.indexMu.Lock()
		// Bounded: a dashboard open on many recordings at once should not pin
		// every index in memory forever.
		if len(s.indexCache) > 32 {
			s.indexCache = map[string]cachedIndex{}
		}
		s.indexCache[id] = hit
		s.indexMu.Unlock()
	}

	var firstTS, lastTS int64
	for i, c := range hit.chunks {
		if i == 0 || c.FirstTS < firstTS {
			firstTS = c.FirstTS
		}
		if c.LastTS > lastTS {
			lastTS = c.LastTS
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chunks":   hit.chunks,
		"first_ts": firstTS,
		"last_ts":  lastTS,
	})
}

// handleCSSAsset serves one deduplicated stylesheet.
//
// The hash IS the content, so the response can never go stale: it is immutable
// and cached for a year. That is what makes the split pay off -- the browser
// fetches each sheet once and reuses it for every other recording of the same
// site, instead of re-downloading it inside every checkout snapshot.
func (s *Server) handleCSSAsset(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	// Fixed shape, hex only: this value reaches a query, and a strict check here
	// is cheaper to reason about than trusting the driver.
	if len(hash) != 64 {
		writeErr(w, http.StatusBadRequest, "invalid stylesheet hash")
		return
	}
	for i := 0; i < len(hash); i++ {
		c := hash[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			writeErr(w, http.StatusBadRequest, "invalid stylesheet hash")
			return
		}
	}

	gz, rawLen, err := s.store.GetCSSAssetGzip(hash)
	if err != nil {
		if errors.Is(err, store.ErrNoCSSAsset) {
			writeErr(w, http.StatusNotFound, "stylesheet not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("ETag", `"`+hash+`"`)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	if match := r.Header.Get("If-None-Match"); match == `"`+hash+`"` {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("X-Uncompressed-Length", strconv.Itoa(rawLen))
	// Stored gzipped; shipped gzipped. No decompress, no recompress.
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Set("Content-Length", strconv.Itoa(len(gz)))
	w.Write(gz)
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
