package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Per-site configuration, managed from the dashboard and served to the
// tracker via GET /api/config/{siteKey}. The widget never manages this —
// the backend is the single source of truth.

type SurveyQuestion struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Type     string   `json:"type"`              // rating | text | choice
	Max      int      `json:"max,omitempty"`     // rating scale: 5 (stars) or 10 (NPS)
	Options  []string `json:"options,omitempty"` // choice
	Optional bool     `json:"optional,omitempty"`
}

// SiteAppearance brands the widget: colors, trigger label, radius and spacing.
// Empty values fall back to the defaults below.
type SiteAppearance struct {
	ButtonBg    string `json:"button_bg,omitempty"`
	ButtonText  string `json:"button_text,omitempty"`
	ButtonLabel string `json:"button_label,omitempty"`
	PanelBg     string `json:"panel_bg,omitempty"`
	PanelText   string `json:"panel_text,omitempty"`
	Accent      string `json:"accent,omitempty"`
	Primary     string `json:"primary,omitempty"`
	PrimaryText string `json:"primary_text,omitempty"`
	Radius      int    `json:"radius,omitempty"`
	Spacing     int    `json:"spacing,omitempty"`
}

func DefaultSiteAppearance() *SiteAppearance {
	return &SiteAppearance{
		ButtonBg:    "#1a1d29",
		ButtonText:  "#ffffff",
		ButtonLabel: "Feedback",
		PanelBg:     "#ffffff",
		PanelText:   "#1a1d29",
		Accent:      "#f5a623",
		Primary:     "#1a1d29",
		PrimaryText: "#ffffff",
		Radius:      14,
		Spacing:     16,
	}
}

// FeedbackTrigger controls when the widget shows up for a visitor.
type FeedbackTrigger struct {
	Mode    string   `json:"mode"`              // always | page | action
	Pages   []string `json:"pages,omitempty"`   // URL patterns with * wildcards
	Actions []string `json:"actions,omitempty"` // trace-ux-track-id names / track() names
}

type SiteSettings struct {
	FeedbackEnabled       bool             `json:"feedback_enabled"`
	FeedbackPosition      string           `json:"feedback_position"` // right | left
	SurveyID              string           `json:"survey_id"`
	SurveyTitle           string           `json:"survey_title"`
	SurveyType            string           `json:"survey_type"` // stars | nps | custom
	Questions             []SurveyQuestion `json:"questions,omitempty"`
	Appearance            *SiteAppearance  `json:"appearance,omitempty"`
	MaxConcurrentSessions int              `json:"max_concurrent_sessions,omitempty"` // 0 = unlimited
	RetentionSessionsDays int              `json:"retention_sessions_days,omitempty"` // 0 = server default
	RetentionFeedbackDays int              `json:"retention_feedback_days,omitempty"` // 0 = server default
	AllowDeleteRecordings bool             `json:"allow_delete_recordings"`
	FeedbackTrigger       *FeedbackTrigger `json:"feedback_trigger,omitempty"`
}

func DefaultSiteSettings() SiteSettings {
	return SiteSettings{
		FeedbackEnabled:       true,
		FeedbackPosition:      "right",
		SurveyID:              "default",
		SurveyTitle:           "How was your experience?",
		SurveyType:            "stars",
		AllowDeleteRecordings: true,
		FeedbackTrigger:       &FeedbackTrigger{Mode: "always"},
	}
}

// ParseSiteSettings layers stored JSON over the defaults, so new fields and
// partial config never break existing sites.
func ParseSiteSettings(configText string) SiteSettings {
	s := DefaultSiteSettings()
	if configText != "" {
		_ = json.Unmarshal([]byte(configText), &s)
	}
	if s.FeedbackPosition == "" {
		s.FeedbackPosition = "right"
	}
	if s.SurveyID == "" {
		s.SurveyID = "default"
	}
	if s.SurveyTitle == "" {
		s.SurveyTitle = "How was your experience?"
	}
	if s.SurveyType == "" {
		s.SurveyType = "stars"
	}
	return s
}

// ValidateSiteSettings guards the values the dashboard PUTs.
func ValidateSiteSettings(s SiteSettings) error {
	if s.FeedbackPosition != "right" && s.FeedbackPosition != "left" {
		return fmt.Errorf("feedback_position must be right or left")
	}
	if s.SurveyType != "stars" && s.SurveyType != "nps" && s.SurveyType != "custom" {
		return fmt.Errorf("survey_type must be stars, nps or custom")
	}
	if len(s.SurveyID) > 100 {
		return fmt.Errorf("survey_id too long")
	}
	if len(s.SurveyTitle) > 200 {
		return fmt.Errorf("survey_title too long")
	}
	if s.MaxConcurrentSessions < 0 || s.MaxConcurrentSessions > 100000 {
		return fmt.Errorf("max_concurrent_sessions must be 0-100000")
	}
	if s.RetentionSessionsDays < 0 || s.RetentionSessionsDays > 3650 {
		return fmt.Errorf("retention_sessions_days must be 0-3650")
	}
	if s.RetentionFeedbackDays < 0 || s.RetentionFeedbackDays > 3650 {
		return fmt.Errorf("retention_feedback_days must be 0-3650")
	}

	// Appearance applies to every survey type: colors must be hex, geometry
	// bounded, label short.
	if a := s.Appearance; a != nil {
		validColor := func(c string) bool {
			if len(c) != 4 && len(c) != 7 {
				return false
			}
			if c[0] != '#' {
				return false
			}
			for _, r := range c[1:] {
				ok := (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')
				if !ok {
					return false
				}
			}
			return true
		}
		colors := map[string]string{
			"button_bg": a.ButtonBg, "button_text": a.ButtonText,
			"panel_bg": a.PanelBg, "panel_text": a.PanelText,
			"accent": a.Accent, "primary": a.Primary, "primary_text": a.PrimaryText,
		}
		for name, c := range colors {
			if c != "" && !validColor(c) {
				return fmt.Errorf("appearance.%s must be a hex color like #1a1d29", name)
			}
		}
		if a.Radius < 0 || a.Radius > 40 {
			return fmt.Errorf("appearance.radius must be 0-40")
		}
		if a.Spacing != 0 && (a.Spacing < 6 || a.Spacing > 48) {
			return fmt.Errorf("appearance.spacing must be 6-48")
		}
		if len(a.ButtonLabel) > 40 {
			return fmt.Errorf("appearance.button_label too long")
		}
	}

	// Feedback trigger targeting applies to every survey type.
	if t := s.FeedbackTrigger; t != nil {
		if t.Mode != "always" && t.Mode != "page" && t.Mode != "action" {
			return fmt.Errorf("feedback_trigger.mode must be always, page or action")
		}
		if len(t.Pages) > 10 {
			return fmt.Errorf("feedback_trigger.pages: max 10 patterns")
		}
		for _, p := range t.Pages {
			if p == "" || len(p) > 200 {
				return fmt.Errorf("feedback_trigger.pages: patterns must be 1-200 chars")
			}
		}
		if len(t.Actions) > 10 {
			return fmt.Errorf("feedback_trigger.actions: max 10 names")
		}
		for _, a := range t.Actions {
			if a == "" || len(a) > 100 {
				return fmt.Errorf("feedback_trigger.actions: names must be 1-100 chars")
			}
		}
	}

	if s.SurveyType != "custom" {
		return nil // stars/nps use the built-in question set
	}
	if len(s.Questions) == 0 || len(s.Questions) > 10 {
		return fmt.Errorf("custom surveys need 1-10 questions")
	}
	seen := map[string]bool{}
	for i, q := range s.Questions {
		if q.ID == "" || len(q.ID) > 100 {
			return fmt.Errorf("question %d: id required (max 100 chars)", i+1)
		}
		if seen[q.ID] {
			return fmt.Errorf("question %d: duplicate id %q", i+1, q.ID)
		}
		seen[q.ID] = true
		if q.Label == "" || len(q.Label) > 200 {
			return fmt.Errorf("question %d: label required (max 200 chars)", i+1)
		}
		switch q.Type {
		case "rating":
			if q.Max != 5 && q.Max != 10 {
				return fmt.Errorf("question %d: rating max must be 5 or 10", i+1)
			}
		case "text":
			// optional flag decides requirement; nothing else to check
		case "choice":
			if len(q.Options) < 2 || len(q.Options) > 10 {
				return fmt.Errorf("question %d: choice needs 2-10 options", i+1)
			}
			for _, o := range q.Options {
				if o == "" || len(o) > 100 {
					return fmt.Errorf("question %d: options must be 1-100 chars", i+1)
				}
			}
		default:
			return fmt.Errorf("question %d: type must be rating, text or choice", i+1)
		}
	}
	return nil
}

// ---- store operations ----

// CanStartRecording enforces the per-site cap on simultaneous recordings.
// Sessions that are already recording (hold events, seen < 30 min ago) always
// continue; a new session is admitted only while fewer than max sessions are
// actively recording. max <= 0 means unlimited.
func (s *Store) CanStartRecording(siteID int64, sessionID string, maxConcurrent int) (bool, error) {
	if maxConcurrent <= 0 {
		return true, nil
	}
	var alreadyRecording int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = ? AND site_id = ? AND event_count > 0 AND last_seen > ?`,
		sessionID, siteID, time.Now().Add(-30*time.Minute).Unix()).Scan(&alreadyRecording); err != nil {
		return false, err
	}
	if alreadyRecording > 0 {
		return true, nil
	}
	cutoff := time.Now().Add(-30 * time.Minute).Unix()
	var activeOthers int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE site_id = ? AND last_seen > ? AND event_count > 0 AND id != ?`,
		siteID, cutoff, sessionID).Scan(&activeOthers); err != nil {
		return false, err
	}
	return activeOthers < maxConcurrent, nil
}

// RetentionSweep applies each site's retention windows: sessions (recordings)
// and feedback are deleted independently. Sites without an explicit window
// fall back to the server default.
func (s *Store) RetentionSweep(defaultDays int) (int64, error) {
	sites, err := s.ListSites()
	if err != nil {
		return 0, err
	}
	var total int64
	for _, st := range sites {
		days := st.Settings.RetentionSessionsDays
		if days <= 0 {
			days = defaultDays
		}
		cutoff := time.Now().AddDate(0, 0, -days).Unix()
		res, err := s.db.Exec(`DELETE FROM sessions WHERE site_id = ? AND last_seen < ?`, st.ID, cutoff)
		if err != nil {
			return total, err
		}
		n, _ := res.RowsAffected()
		total += n

		fdays := st.Settings.RetentionFeedbackDays
		if fdays <= 0 {
			fdays = defaultDays
		}
		fcutoff := time.Now().AddDate(0, 0, -fdays).Unix()
		res, err = s.db.Exec(`DELETE FROM feedback WHERE site_id = ? AND created_at < ?`, st.ID, fcutoff)
		if err != nil {
			return total, err
		}
		n, _ = res.RowsAffected()
		total += n
	}
	return total, nil
}

func (s *Store) DeleteSession(id string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

// SessionActivityCounts splits stored sessions into in-progress and completed
// using the same 30-minute window as the list's active flag.
func (s *Store) SessionActivityCounts(siteID int64) (active, completed int64, err error) {
	cutoff := time.Now().Add(-30 * time.Minute).Unix()
	q := `SELECT
		COALESCE(SUM(CASE WHEN last_seen > ? THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN last_seen <= ? THEN 1 ELSE 0 END), 0)
		FROM sessions`
	args := []any{cutoff, cutoff}
	if siteID > 0 {
		q += ` WHERE site_id = ?`
		args = append(args, siteID)
	}
	err = s.db.QueryRow(q, args...).Scan(&active, &completed)
	return
}

func (s *Store) UpdateSiteRecording(siteID int64, enabled bool) error {
	_, err := s.db.Exec(`UPDATE sites SET recording_enabled = ? WHERE id = ?`, boolToInt(enabled), siteID)
	return err
}

func (s *Store) UpdateSiteURL(siteID int64, url string) error {
	_, err := s.db.Exec(`UPDATE sites SET url = ? WHERE id = ?`, url, siteID)
	return err
}

func (s *Store) UpdateSiteSettings(siteID int64, settings SiteSettings) error {
	b, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE sites SET config = ? WHERE id = ?`, string(b), siteID)
	return err
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// SiteStats is the overall feedback health of one site.
type SiteStats struct {
	FeedbackCount int64   `json:"feedback_count"`
	AvgRating     float64 `json:"avg_rating"`
	PositivePct   float64 `json:"positive_pct"` // share of ratings that are 4-5 (stars) or 8-10 (NPS)
}

// GetSiteDetail returns everything the site hub page needs: the site with its
// settings, the latest 5 recordings, the latest 5 feedback responses and the
// overall feedback stats.
func (s *Store) GetSiteDetail(siteID int64) (*Site, []Session, []Feedback, *SiteStats, error) {
	st, err := scanSite(s.db.QueryRow(`SELECT `+siteCols+` FROM sites s WHERE s.id = ?`, siteID))
	if err == sql.ErrNoRows {
		return nil, nil, nil, nil, nil
	}
	if err != nil {
		return nil, nil, nil, nil, err
	}

	sessions, err := s.ListSessions(SessionFilter{SiteID: siteID, Limit: 5})
	if err != nil {
		return nil, nil, nil, nil, err
	}
	feedback, err := s.ListFeedback(FeedbackFilter{SiteID: siteID, Limit: 5})
	if err != nil {
		return nil, nil, nil, nil, err
	}

	var stats SiteStats
	err = s.db.QueryRow(`SELECT COUNT(*), COALESCE(AVG(rating), 0),
			COALESCE(SUM(CASE WHEN (rating BETWEEN 4 AND 5) OR rating >= 8 THEN 1 ELSE 0 END), 0)
		FROM feedback WHERE site_id = ?`, siteID).
		Scan(&stats.FeedbackCount, &stats.AvgRating, &stats.PositivePct)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if stats.FeedbackCount > 0 {
		stats.PositivePct = stats.PositivePct * 100 / float64(stats.FeedbackCount)
	}
	return st, sessions, feedback, &stats, nil
}
