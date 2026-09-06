package main

import (
	"net/http"
	"strconv"
)

// ---- Feedback endpoints (dashboard, auth-protected) ----

func (s *Server) handleListFeedback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := FeedbackFilter{SurveyID: q.Get("survey_id")}
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
	items, err := s.store.ListFeedback(f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
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
