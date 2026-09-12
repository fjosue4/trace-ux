package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// ---- Dashboard performance endpoints (auth-protected) ----

func parsePerformanceFilter(r *http.Request) (PerformanceFilter, error) {
	q := r.URL.Query()
	f := PerformanceFilter{Limit: maxPerformanceQueryLimit}
	if value := q.Get("site_id"); value != "" {
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id <= 0 {
			return f, errors.New("invalid site_id")
		}
		f.SiteID = id
	}
	for key, target := range map[string]*string{
		"environment": &f.Environment,
		"service":     &f.Service,
		"version":     &f.Version,
	} {
		value := strings.TrimSpace(q.Get(key))
		if len(value) > maxPerformanceDimensionLength {
			return f, fmt.Errorf("%s is too long", key)
		}
		*target = value
	}
	for key, target := range map[string]*int64{"from": &f.From, "to": &f.To} {
		if value := q.Get(key); value != "" {
			timestamp, err := strconv.ParseInt(value, 10, 64)
			if err != nil || timestamp <= 0 {
				return f, fmt.Errorf("invalid %s", key)
			}
			*target = timestamp
		}
	}
	if f.From > 0 && f.To > 0 && f.From >= f.To {
		return f, errors.New("from must be before to")
	}
	if value := q.Get("limit"); value != "" {
		limit, err := strconv.Atoi(value)
		if err != nil || limit <= 0 || limit > maxPerformanceQueryLimit {
			return f, fmt.Errorf("limit must be 1-%d", maxPerformanceQueryLimit)
		}
		f.Limit = limit
	}
	return f, nil
}

func (s *Server) handlePerformance(w http.ResponseWriter, r *http.Request) {
	f, err := parsePerformanceFilter(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	report, err := s.store.GetPerformance(f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}

func (s *Server) handleListPerformanceKeys(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	keys, err := s.store.ListPerformanceKeys(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, keys)
}

func (s *Server) handleCreatePerformanceKey(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	info, key, err := s.store.CreatePerformanceKey(id)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "site not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"key_id":          info.ID,
		"key_hint":        info.KeyHint,
		"created_at":      info.CreatedAt,
		"performance_key": key,
	})
}

func (s *Server) handleDeletePerformanceKey(w http.ResponseWriter, r *http.Request) {
	siteID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || siteID <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	keyID, err := strconv.ParseInt(r.PathValue("keyId"), 10, 64)
	if err != nil || keyID <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid performance key id")
		return
	}
	if err := s.store.RevokePerformanceKey(siteID, keyID); err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "performance key not found")
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
	} else {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

type performanceIngestRequest struct {
	Observations []PerformanceObservation `json:"observations"`
}

// handlePerformanceIngest is intentionally server-to-server. The backend key
// is accepted via X-TraceUX-Performance-Key or Authorization: Bearer and is
// stored only as a hash on the TraceUX server.
func (s *Server) handlePerformanceIngest(w http.ResponseWriter, r *http.Request) {
	site, err := s.store.GetSiteByKey(r.PathValue("siteKey"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if site.ID == 0 {
		// Keep unknown site keys opaque to probes, matching browser ingest.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	key := strings.TrimSpace(r.Header.Get("X-TraceUX-Performance-Key"))
	if key == "" {
		authorization := strings.TrimSpace(r.Header.Get("Authorization"))
		if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
			key = strings.TrimSpace(authorization[len("Bearer "):])
		}
	}
	valid, err := s.store.ValidatePerformanceKey(site.ID, key)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !valid {
		writeErr(w, http.StatusUnauthorized, "invalid performance key")
		return
	}
	s.initSecurity()
	clientKey := "ip:" + s.clientIP(r)
	if !s.ingestIPLimiter.allow(clientKey) || !s.ingestSiteLimiter.allow(fmt.Sprintf("performance-site:%d", site.ID)) {
		writeRateLimited(w, "performance ingest rate limit exceeded")
		return
	}

	body, err := readPerformanceBody(w, r)
	if err != nil {
		if errors.Is(err, errRequestBodyTooLarge) {
			writeErr(w, http.StatusRequestEntityTooLarge, "request body too large")
		} else {
			writeErr(w, http.StatusBadRequest, "unreadable body")
		}
		return
	}
	var payload performanceIngestRequest
	dec := json.NewDecoder(bytes.NewReader(body))
	if err := dec.Decode(&payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(payload.Observations) == 0 {
		writeJSON(w, http.StatusOK, map[string]int{"accepted": 0})
		return
	}
	if len(payload.Observations) > maxPerformanceObservationCount {
		writeErr(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("observations must be 1-%d", maxPerformanceObservationCount))
		return
	}
	if err := s.store.SavePerformanceObservations(site.ID, payload.Observations); err != nil {
		if strings.Contains(err.Error(), "must be") {
			writeErr(w, http.StatusBadRequest, err.Error())
		} else {
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"accepted": len(payload.Observations)})
}

func readPerformanceBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	// The generic tracker body reader already handles gzip and the 10 MB cap.
	// Keeping the same limit makes agent batching and browser ingest predictable.
	return readBody(r)
}

func (s *Server) handleRotatePerformanceKey(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	key, err := s.store.RotatePerformanceKey(id)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "site not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"performance_key": key,
		"key_hint":        performanceKeyHint(key[:4], key[len(key)-4:]),
	})
}
