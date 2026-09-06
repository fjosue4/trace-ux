package main

import (
	"net/http"
	"strconv"
)

// ---- Site management endpoints ----

// GET /api/sites/{id} — the site hub: site + settings + last 5 recordings +
// last 5 feedback + overall feedback stats.
func (s *Server) handleGetSite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	site, sessions, feedback, stats, err := s.store.GetSiteDetail(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if site == nil {
		writeErr(w, http.StatusNotFound, "site not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"site":     site,
		"sessions": sessions,
		"feedback": feedback,
		"stats":    stats,
	})
}

// PATCH /api/sites/{id} — toggle recording on/off.
func (s *Server) handleUpdateSite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	var body struct {
		RecordingEnabled *bool `json:"recording_enabled"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	if body.RecordingEnabled == nil {
		writeErr(w, http.StatusBadRequest, "nothing to update")
		return
	}
	site, _, _, _, err := s.store.GetSiteDetail(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if site == nil {
		writeErr(w, http.StatusNotFound, "site not found")
		return
	}
	if err := s.store.UpdateSiteRecording(id, *body.RecordingEnabled); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true, "recording_enabled": *body.RecordingEnabled})
}

// PUT /api/sites/{id}/settings — the feedback widget + survey configuration.
func (s *Server) handlePutSiteSettings(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	var settings SiteSettings
	if err := readJSON(w, r, &settings); err != nil {
		return
	}
	if err := ValidateSiteSettings(settings); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	site, _, _, _, err := s.store.GetSiteDetail(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if site == nil {
		writeErr(w, http.StatusNotFound, "site not found")
		return
	}
	if err := s.store.UpdateSiteSettings(id, settings); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settings)
}
