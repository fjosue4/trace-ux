package main

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"trace-ux/server/store"
)

// ---- Feedback endpoints (dashboard, auth-protected) ----

func (s *Server) handleListFeedback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.FeedbackFilter{SurveyID: q.Get("survey_id")}
	if v := q.Get("site_id"); v != "" {
		siteID, err := strconv.ParseInt(v, 10, 64)
		if err != nil || siteID <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid site_id")
			return
		}
		f.SiteID = siteID
	}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			f.Limit = n
		}
	}
	if v := q.Get("campaign_id"); v != "" {
		campaignID, err := strconv.ParseInt(v, 10, 64)
		if err != nil || campaignID <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid campaign_id")
			return
		}
		f.CampaignID = campaignID
	}
	items, err := s.store.ListFeedback(f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ---- Feedback campaigns (dashboard) ----

func campaignInputFromRequest(w http.ResponseWriter, r *http.Request) (store.FeedbackCampaignInput, bool) {
	var in store.FeedbackCampaignInput
	if err := readJSON(w, r, &in); err != nil {
		return in, false
	}
	in.CampaignKey = strings.TrimSpace(in.CampaignKey)
	in.Name = strings.TrimSpace(in.Name)
	in.Question = strings.TrimSpace(in.Question)
	if err := store.ValidateFeedbackCampaignInput(in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return in, false
	}
	return in, true
}

func (s *Server) handleListFeedbackCampaigns(w http.ResponseWriter, r *http.Request) {
	siteID, err := strconv.ParseInt(r.URL.Query().Get("site_id"), 10, 64)
	if err != nil || siteID <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site_id")
		return
	}
	items, err := s.store.ListFeedbackCampaigns(siteID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateFeedbackCampaign(w http.ResponseWriter, r *http.Request) {
	in, ok := campaignInputFromRequest(w, r)
	if !ok {
		return
	}
	item, err := s.store.CreateFeedbackCampaign(in)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeErr(w, http.StatusConflict, "campaign key already exists for this site")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateFeedbackCampaign(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid campaign id")
		return
	}
	in, ok := campaignInputFromRequest(w, r)
	if !ok {
		return
	}
	item, err := s.store.UpdateFeedbackCampaign(id, in)
	if errors.Is(err, store.ErrCampaignNotFound) {
		writeErr(w, http.StatusNotFound, "campaign not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// ---- Feedback campaigns (public tracker) ----

func (s *Server) handleFeedbackCampaignEligibility(w http.ResponseWriter, r *http.Request) {
	site, err := s.store.GetSiteByKey(r.PathValue("siteKey"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if site.ID == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"eligible": false, "reason": "not_found"})
		return
	}
	if !site.Settings.WidgetOn() {
		writeJSON(w, http.StatusOK, map[string]any{"eligible": false, "reason": "widget_disabled"})
		return
	}
	var body struct {
		VisitorKey   string `json:"visitor_key"`
		UserID       string `json:"user_id"`
		SessionID    string `json:"session_id"`
		OccurrenceID string `json:"occurrence_id"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	if len(body.VisitorKey) > 100 || len(body.UserID) > maxIdentityLength || len(body.SessionID) > maxSessionIDLength || len(body.OccurrenceID) > 100 {
		writeErr(w, http.StatusBadRequest, "campaign request is too long")
		return
	}
	s.initSecurity()
	if !s.ingestIPLimiter.allow("campaign-ip:"+s.clientIP(r)) || !s.ingestSiteLimiter.allow("campaign-site:"+strconv.FormatInt(site.ID, 10)) {
		writeRateLimited(w, "feedback campaign rate limit exceeded")
		return
	}
	reservation, err := s.store.ReserveFeedbackCampaign(site.ID, r.PathValue("campaignKey"), body.VisitorKey, body.UserID, body.SessionID, body.OccurrenceID)
	if err != nil {
		reason := ""
		switch {
		case errors.Is(err, store.ErrCampaignNotFound):
			reason = "not_found"
		case errors.Is(err, store.ErrCampaignDisabled):
			reason = "disabled"
		case errors.Is(err, store.ErrCampaignRecurrence):
			reason = "recurrence"
		}
		if reason != "" {
			writeJSON(w, http.StatusOK, map[string]any{"eligible": false, "reason": reason})
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not reserve feedback campaign")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"eligible":       true,
		"delivery_token": reservation.DeliveryToken,
		"campaign":       reservation.Campaign,
	})
}

func (s *Server) handleFeedbackCampaignDelivery(w http.ResponseWriter, r *http.Request) {
	site, err := s.store.GetSiteByKey(r.PathValue("siteKey"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if site.ID == 0 {
		writeErr(w, http.StatusNotFound, "delivery not found")
		return
	}
	action := r.PathValue("action")
	if action != "shown" && action != "dismissed" && action != "skipped" {
		writeErr(w, http.StatusBadRequest, "invalid delivery action")
		return
	}
	if err := s.store.MarkFeedbackDelivery(site.ID, r.PathValue("token"), action); err != nil {
		if errors.Is(err, store.ErrDeliveryState) {
			writeErr(w, http.StatusConflict, "delivery is no longer active")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleFeedbackSummary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	siteID := int64(0)
	if v := q.Get("site_id"); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil || parsed <= 0 {
			writeErr(w, http.StatusBadRequest, "invalid site_id")
			return
		}
		siteID = parsed
	}
	summary, err := s.store.FeedbackSummary(siteID, q.Get("survey_id"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleDeleteFeedback(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid feedback id")
		return
	}
	if err := s.store.DeleteFeedback(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
