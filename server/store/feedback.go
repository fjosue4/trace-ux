package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// Visitor feedback and survey responses, collected in-app on tracked sites
// via the tracker widget or window.TraceUX.feedback(). Surveys are fully
// custom: the widget collects any list of questions, stored as JSON answers.

type FeedbackAnswer struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
	Value string `json:"value"`
}

type Feedback struct {
	ID                 int64            `json:"id"`
	SiteID             int64            `json:"site_id"`
	SiteName           string           `json:"site_name,omitempty"`
	SessionID          string           `json:"session_id,omitempty"`
	VisitorKey         string           `json:"visitor_key,omitempty"`
	UserID             string           `json:"user_id,omitempty"`
	SurveyID           string           `json:"survey_id"`
	CampaignID         int64            `json:"campaign_id,omitempty"`
	CampaignKey        string           `json:"campaign_key,omitempty"`
	CampaignName       string           `json:"campaign_name,omitempty"`
	CampaignAnswerType string           `json:"campaign_answer_type,omitempty"`
	Rating             int              `json:"rating"` // derived: first numeric answer; 0 = none
	Comment            string           `json:"comment"`
	Answers            []FeedbackAnswer `json:"answers,omitempty"`
	CreatedAt          int64            `json:"created_at"`
	Browser            string           `json:"browser,omitempty"`
	OS                 string           `json:"os,omitempty"`
	Device             string           `json:"device,omitempty"`
}

type FeedbackFilter struct {
	SiteID     int64  // 0 = all sites
	SurveyID   string // empty = all surveys
	CampaignID int64  // 0 = all campaigns
	Limit      int
}

// SaveFeedback stores one response. When sessionID is set, the response is
// linked to the recording so the dashboard can jump from feedback to replay.
// NewFeedback is one submitted response. VisitorKey and UserID identify who
// sent it: the key is the widget's own anonymous id, the user id is whatever
// the host page passed to identify(). Both may be empty.
type NewFeedback struct {
	SiteID        int64
	SessionID     string
	VisitorKey    string
	UserID        string
	SurveyID      string
	Rating        int
	Comment       string
	AnswersJSON   string
	DeliveryToken string
}

func (s *Store) SaveFeedback(in NewFeedback) (int64, error) {
	now := time.Now().Unix()
	if in.SessionID != "" {
		if err := s.EnsureSessionForSite(in.SiteID, in.SessionID, now); err != nil {
			return 0, err
		}
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var campaignID, deliveryID int64
	var snapshot string
	if in.DeliveryToken != "" {
		err = tx.QueryRow(`SELECT id, campaign_id, campaign_snapshot FROM feedback_deliveries
			WHERE site_id = ? AND token_hash = ? AND status = 'shown'`, in.SiteID, campaignTokenHash(in.DeliveryToken)).
			Scan(&deliveryID, &campaignID, &snapshot)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrDeliveryState
		}
		if err != nil {
			return 0, err
		}
	}
	res, err := tx.Exec(`INSERT INTO feedback
		(site_id, session_id, visitor_key, user_id, survey_id, rating, comment, answers, created_at, campaign_id, delivery_id, campaign_snapshot)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, 0), NULLIF(?, 0), ?)`,
		in.SiteID, in.SessionID, in.VisitorKey, in.UserID, in.SurveyID, in.Rating, in.Comment, in.AnswersJSON, now,
		campaignID, deliveryID, snapshot)
	if err != nil {
		return 0, err
	}
	if deliveryID > 0 {
		if _, err := tx.Exec(`UPDATE feedback_deliveries SET status = 'answered', completed_at = ? WHERE id = ? AND status = 'shown'`, now, deliveryID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

const feedbackCols = `f.id, f.site_id, f.session_id, f.visitor_key, f.user_id, f.survey_id,
	COALESCE(f.campaign_id, 0), COALESCE(c.campaign_key, ''), COALESCE(c.name, ''),
	COALESCE(c.answer_type, ''),
	f.rating, f.comment, f.answers, f.created_at,
	si.name, COALESCE(se.browser, ''), COALESCE(se.os, ''), COALESCE(se.device, '')`

func (s *Store) ListFeedback(f FeedbackFilter) ([]Feedback, error) {
	query := `SELECT ` + feedbackCols + ` FROM feedback f
		JOIN sites si ON si.id = f.site_id
		LEFT JOIN sessions se ON se.id = f.session_id
		LEFT JOIN feedback_campaigns c ON c.id = f.campaign_id`
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
	if f.CampaignID > 0 {
		query += ` AND f.campaign_id = ?`
		args = append(args, f.CampaignID)
	}
	query += ` ORDER BY f.created_at DESC, f.id DESC LIMIT ?`
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 100
	}
	args = append(args, f.Limit)

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Feedback{}
	for rows.Next() {
		var fb Feedback
		var answers string
		if err := rows.Scan(&fb.ID, &fb.SiteID, &fb.SessionID, &fb.VisitorKey, &fb.UserID, &fb.SurveyID,
			&fb.CampaignID, &fb.CampaignKey, &fb.CampaignName, &fb.CampaignAnswerType, &fb.Rating, &fb.Comment, &answers, &fb.CreatedAt,
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

// ListFeedbackBySession returns the feedback linked to one recording, oldest
// first, for the replay page's activity feed.
func (s *Store) ListFeedbackBySession(sessionID string) ([]Feedback, error) {
	rows, err := s.DB.Query(`SELECT `+feedbackCols+` FROM feedback f
		JOIN sites si ON si.id = f.site_id
		LEFT JOIN sessions se ON se.id = f.session_id
		LEFT JOIN feedback_campaigns c ON c.id = f.campaign_id
		WHERE f.session_id = ? ORDER BY f.created_at, f.id`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Feedback{}
	for rows.Next() {
		var fb Feedback
		var answers string
		if err := rows.Scan(&fb.ID, &fb.SiteID, &fb.SessionID, &fb.VisitorKey, &fb.UserID, &fb.SurveyID,
			&fb.CampaignID, &fb.CampaignKey, &fb.CampaignName, &fb.CampaignAnswerType, &fb.Rating, &fb.Comment, &answers, &fb.CreatedAt,
			&fb.SiteName, &fb.Browser, &fb.OS, &fb.Device); err != nil {
			return nil, err
		}
		if answers != "" {
			_ = json.Unmarshal([]byte(answers), &fb.Answers)
		}
		out = append(out, fb)
	}
	return out, rows.Err()
}

type FeedbackSurveySummary struct {
	SurveyID           string  `json:"survey_id"`
	CampaignID         int64   `json:"campaign_id,omitempty"`
	CampaignName       string  `json:"campaign_name,omitempty"`
	CampaignAnswerType string  `json:"campaign_answer_type,omitempty"`
	Count              int64   `json:"count"`
	Average            float64 `json:"average"`
}

// FeedbackSummary aggregates responses per survey. Rating is derived from the
// first numeric question, so averages only make sense when the survey asks
// one; zero-rated (text/choice-only) responses are excluded from the average.
func (s *Store) FeedbackSummary(siteID int64, surveyID string) ([]FeedbackSurveySummary, error) {
	query := `SELECT f.survey_id, COALESCE(c.id, 0), COALESCE(c.name, ''), COALESCE(c.answer_type, ''), COUNT(*), AVG(f.rating)
		FROM feedback f LEFT JOIN feedback_campaigns c ON c.id = f.campaign_id`
	args := []any{}
	if siteID > 0 {
		query += ` WHERE f.site_id = ?`
		args = append(args, siteID)
	} else {
		query += ` WHERE 1=1`
	}
	if surveyID != "" {
		query += ` AND f.survey_id = ?`
		args = append(args, surveyID)
	}
	query += ` GROUP BY f.survey_id, c.id, c.name, c.answer_type ORDER BY f.survey_id`

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FeedbackSurveySummary{}
	for rows.Next() {
		var f FeedbackSurveySummary
		if err := rows.Scan(&f.SurveyID, &f.CampaignID, &f.CampaignName, &f.CampaignAnswerType, &f.Count, &f.Average); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) DeleteFeedback(id int64) error {
	_, err := s.DB.Exec(`DELETE FROM feedback WHERE id = ?`, id)
	return err
}
