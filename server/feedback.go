package main

import (
	"encoding/json"
	"time"
)

// Visitor feedback and survey responses, collected in-app on tracked sites
// via the tracker widget or window.Webshots.feedback(). Surveys are fully
// custom: the widget collects any list of questions, stored as JSON answers.

type FeedbackAnswer struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
	Value string `json:"value"`
}

type Feedback struct {
	ID        int64            `json:"id"`
	SiteID    int64            `json:"site_id"`
	SiteName  string           `json:"site_name,omitempty"`
	SessionID string           `json:"session_id,omitempty"`
	SurveyID  string           `json:"survey_id"`
	Rating    int              `json:"rating"` // derived: first numeric answer; 0 = none
	Comment   string           `json:"comment"`
	Answers   []FeedbackAnswer `json:"answers,omitempty"`
	CreatedAt int64            `json:"created_at"`
	Browser   string           `json:"browser,omitempty"`
	OS        string           `json:"os,omitempty"`
	Device    string           `json:"device,omitempty"`
}

type FeedbackFilter struct {
	SiteID   int64  // 0 = all sites
	SurveyID string // empty = all surveys
	Limit    int
}

// SaveFeedback stores one response. When sessionID is set, the response is
// linked to the recording so the dashboard can jump from feedback to replay.
func (s *Store) SaveFeedback(siteID int64, sessionID, surveyID string, rating int, comment, answersJSON string) (int64, error) {
	now := time.Now().Unix()
	if sessionID != "" {
		if _, err := s.db.Exec(ensureSession, sessionID, siteID, now, now); err != nil {
			return 0, err
		}
	}
	res, err := s.db.Exec(`INSERT INTO feedback (site_id, session_id, survey_id, rating, comment, answers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		siteID, sessionID, surveyID, rating, comment, answersJSON, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

const feedbackCols = `f.id, f.site_id, f.session_id, f.survey_id, f.rating, f.comment, f.answers, f.created_at,
	si.name, COALESCE(se.browser, ''), COALESCE(se.os, ''), COALESCE(se.device, '')`

func (s *Store) ListFeedback(f FeedbackFilter) ([]Feedback, error) {
	query := `SELECT ` + feedbackCols + ` FROM feedback f
		JOIN sites si ON si.id = f.site_id
		LEFT JOIN sessions se ON se.id = f.session_id`
	args := []any{}
	if f.SiteID > 0 {
		query += ` WHERE f.site_id = ?`
		args = append(args, f.SiteID)
	} else {
		query += ` WHERE 1=1`
	}
	if f.SurveyID != "" {
		query += ` AND f.survey_id = ?`
		args = append(args, f.SurveyID)
	}
	query += ` ORDER BY f.created_at DESC, f.id DESC LIMIT ?`
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 100
	}
	args = append(args, f.Limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Feedback{}
	for rows.Next() {
		var fb Feedback
		var answers string
		if err := rows.Scan(&fb.ID, &fb.SiteID, &fb.SessionID, &fb.SurveyID, &fb.Rating, &fb.Comment, &answers, &fb.CreatedAt,
			&fb.SiteName, &fb.Browser, &fb.OS, &fb.Device); err != nil {
			return nil, err
		}
		if answers != "" {
			// Malformed answers never break the listing.
			_ = json.Unmarshal([]byte(answers), &fb.Answers)
		}
		out = append(out, fb)
	}
	return out, rows.Err()
}

type FeedbackSurveySummary struct {
	SurveyID string  `json:"survey_id"`
	Count    int64   `json:"count"`
	Average  float64 `json:"average"`
}

// FeedbackSummary aggregates responses per survey. Rating is derived from the
// first numeric question, so averages only make sense when the survey asks
// one; zero-rated (text/choice-only) responses are excluded from the average.
func (s *Store) FeedbackSummary(siteID int64, surveyID string) ([]FeedbackSurveySummary, error) {
	query := `SELECT survey_id, COUNT(*), AVG(rating) FROM feedback`
	args := []any{}
	if siteID > 0 {
		query += ` WHERE site_id = ?`
		args = append(args, siteID)
	} else {
		query += ` WHERE 1=1`
	}
	if surveyID != "" {
		query += ` AND survey_id = ?`
		args = append(args, surveyID)
	}
	query += ` GROUP BY survey_id ORDER BY survey_id`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FeedbackSurveySummary{}
	for rows.Next() {
		var f FeedbackSurveySummary
		if err := rows.Scan(&f.SurveyID, &f.Count, &f.Average); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) DeleteFeedback(id int64) error {
	_, err := s.db.Exec(`DELETE FROM feedback WHERE id = ?`, id)
	return err
}
