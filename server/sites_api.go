package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"trace-ux/server/store"
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
	// Metadata only — the dashboard renders the preview from the public icon
	// endpoint rather than carrying the blob through this response.
	widgetIcon, err := s.store.GetWidgetIcon(id, false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	iconURL := ""
	if widgetIcon != nil {
		iconURL = "/api/widget-icon/" + url.PathEscape(site.SiteKey) + "?v=" + widgetIcon.ETag
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"site":             site,
		"sessions":         sessions,
		"feedback":         feedback,
		"stats":            stats,
		"performance_keys": performanceKeys,
		"widget_icon":      widgetIcon,
		"widget_icon_url":  iconURL,
	})
}

// validateSiteName is the single definition of what a site may be called, so
// creating a site and renaming one cannot drift apart.
func validateSiteName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" || len([]rune(name)) > 100 {
		return "", errors.New("name must be 1-100 characters")
	}
	return name, nil
}

// PATCH /api/sites/{id} — rename the site, change the origin the tracker is
// allowed to record from, and/or toggle recording. Every field is optional; a
// field that is absent is left alone.
func (s *Server) handleUpdateSite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	var body struct {
		RecordingEnabled *bool   `json:"recording_enabled"`
		Name             *string `json:"name"`
		URL              *string `json:"url"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	if body.RecordingEnabled == nil && body.Name == nil && body.URL == nil {
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
	// Both fields are validated before either is written. They are separate
	// UPDATEs, so validating as we go would let a good name land and a bad URL
	// 400 -- reporting failure on a request that changed something.
	var name, siteURL string
	if body.Name != nil {
		if name, err = validateSiteName(*body.Name); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if body.URL != nil {
		if siteURL, err = normalizeSiteURL(*body.URL); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if body.Name != nil {
		if err := s.store.UpdateSiteName(id, name); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if body.URL != nil {
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
	if body.Name != nil {
		resp["name"] = name
	}
	// The stored value, not the raw input, so the echo stays truthful if
	// normalizeSiteURL ever does more than trim.
	if body.URL != nil {
		resp["url"] = siteURL
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
	settings := store.DefaultSiteSettings()
	if _, ok := raw["widget_enabled"]; !ok {
		// Keep legacy rows legacy when an older dashboard (or a GET/PUT
		// round-trip from one) does not include the new master switch.
		settings.WidgetEnabled = nil
	}
	apply := func(key string, target any) error {
		if v, ok := raw[key]; ok {
			if err := json.Unmarshal(v, target); err != nil {
				return fmt.Errorf("invalid %s", key)
			}
		}
		return nil
	}
	for key, target := range map[string]any{
		"widget_position":         &settings.WidgetPosition,
		"widget_enabled":          &settings.WidgetEnabled,
		"updates_enabled":         &settings.UpdatesEnabled,
		"updates_position":        &settings.UpdatesPosition,
		"feedback_enabled":        &settings.FeedbackEnabled,
		"feedback_position":       &settings.FeedbackPosition,
		"tickets_enabled":         &settings.TicketsEnabled,
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
	if rawLogs, ok := raw["logs"]; ok {
		// A legacy payload can still send minimum_severity without the new
		// allow-list. Clear the default selection so normalization migrates the
		// threshold instead of silently keeping only errors.
		var logRaw map[string]json.RawMessage
		if err := json.Unmarshal(rawLogs, &logRaw); err == nil {
			if _, ok := logRaw["severities"]; !ok {
				settings.Logs.Severities = nil
			}
		}
	}
	if v, ok := raw["updates_appearance"]; ok {
		var a store.AnnouncementAppearance
		if err := json.Unmarshal(v, &a); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid updates_appearance")
			return
		}
		settings.UpdatesAppearance = &a
	}
	if v, ok := raw["appearance"]; ok {
		var a store.SiteAppearance
		if err := json.Unmarshal(v, &a); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid appearance")
			return
		}
		settings.Appearance = &a
	}
	if v, ok := raw["feedback_trigger"]; ok {
		var t store.FeedbackTrigger
		if err := json.Unmarshal(v, &t); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid feedback_trigger")
			return
		}
		settings.FeedbackTrigger = &t
	}
	// Validate what the caller actually sent, before any position promotion —
	// normalizing first would quietly coerce a bad value into a valid corner
	// instead of reporting it.
	if err := store.ValidateSiteSettings(settings); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	store.NormalizeLogSettings(&settings.Logs)

	// Position is one widget-level setting now. A payload that still sends it
	// per section (an older dashboard) is honoured by promoting whichever key
	// it supplied; normalize then mirrors the result back across both, so the
	// stored settings, the PUT response and the config endpoint all agree.
	if _, ok := raw["widget_position"]; !ok {
		if _, ok := raw["updates_position"]; ok {
			settings.WidgetPosition = settings.UpdatesPosition
		} else if _, ok := raw["feedback_position"]; ok {
			settings.WidgetPosition = settings.FeedbackPosition
		}
	}
	store.NormalizeWidgetPosition(&settings)
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
