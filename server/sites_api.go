package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
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
	performanceKeys, err := s.store.ListPerformanceKeys(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"site":             site,
		"sessions":         sessions,
		"feedback":         feedback,
		"stats":            stats,
		"performance_keys": performanceKeys,
	})
}

// PATCH /api/sites/{id} — toggle recording on/off and/or update the site URL
// (the origin the tracker is allowed to record from).
func (s *Server) handleUpdateSite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	var body struct {
		RecordingEnabled *bool   `json:"recording_enabled"`
		URL              *string `json:"url"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	if body.RecordingEnabled == nil && body.URL == nil {
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
	if body.URL != nil {
		siteURL, err := normalizeSiteURL(*body.URL)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := s.store.UpdateSiteURL(id, siteURL); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if body.RecordingEnabled != nil {
		if err := s.store.UpdateSiteRecording(id, *body.RecordingEnabled); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	resp := map[string]any{"ok": true}
	if body.RecordingEnabled != nil {
		resp["recording_enabled"] = *body.RecordingEnabled
	}
	if body.URL != nil {
		resp["url"] = strings.TrimSpace(*body.URL)
	}
	writeJSON(w, http.StatusOK, resp)
}

// PUT /api/sites/{id}/settings — the feedback widget + survey configuration.
// Fields absent from the body keep their defaults; fields present win (an
// explicit false is respected).
func (s *Server) handlePutSiteSettings(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	var raw map[string]json.RawMessage
	if err := readJSON(w, r, &raw); err != nil {
		return
	}
	settings := DefaultSiteSettings()
	apply := func(key string, target any) error {
		if v, ok := raw[key]; ok {
			if err := json.Unmarshal(v, target); err != nil {
				return fmt.Errorf("invalid %s", key)
			}
		}
		return nil
	}
	for key, target := range map[string]any{
		"updates_enabled":         &settings.UpdatesEnabled,
		"updates_position":        &settings.UpdatesPosition,
		"feedback_enabled":        &settings.FeedbackEnabled,
		"feedback_position":       &settings.FeedbackPosition,
		"survey_id":               &settings.SurveyID,
		"survey_title":            &settings.SurveyTitle,
		"survey_type":             &settings.SurveyType,
		"max_concurrent_sessions": &settings.MaxConcurrentSessions,
		"retention_sessions_days": &settings.RetentionSessionsDays,
		"retention_feedback_days": &settings.RetentionFeedbackDays,
		"allow_delete_recordings": &settings.AllowDeleteRecordings,
		"questions":               &settings.Questions,
		"logs":                    &settings.Logs,
	} {
		if err := apply(key, target); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if v, ok := raw["updates_appearance"]; ok {
		var a AnnouncementAppearance
		if err := json.Unmarshal(v, &a); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid updates_appearance")
			return
		}
		settings.UpdatesAppearance = &a
	}
	if v, ok := raw["appearance"]; ok {
		var a SiteAppearance
		if err := json.Unmarshal(v, &a); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid appearance")
			return
		}
		settings.Appearance = &a
	}
	if v, ok := raw["feedback_trigger"]; ok {
		var t FeedbackTrigger
		if err := json.Unmarshal(v, &t); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid feedback_trigger")
			return
		}
		settings.FeedbackTrigger = &t
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
