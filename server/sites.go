package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// Per-site configuration, managed from the dashboard and served to the
// tracker via GET /api/config/{siteKey}. The widget never manages this —
// the backend is the single source of truth.

type SurveyQuestion struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Type     string   `json:"type"` // rating | text | choice
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

type SiteSettings struct {
	FeedbackEnabled  bool             `json:"feedback_enabled"`
	FeedbackPosition string           `json:"feedback_position"` // right | left
	SurveyID         string           `json:"survey_id"`
	SurveyTitle      string           `json:"survey_title"`
	SurveyType       string           `json:"survey_type"` // stars | nps | custom
	Questions        []SurveyQuestion `json:"questions,omitempty"`
	Appearance       *SiteAppearance  `json:"appearance,omitempty"`
}

func DefaultSiteSettings() SiteSettings {
	return SiteSettings{
		FeedbackEnabled:  true,
		FeedbackPosition: "right",
		SurveyID:         "default",
		SurveyTitle:      "How was your experience?",
		SurveyType:       "stars",
		Appearance:       DefaultSiteAppearance(),
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

	// Appearance applies to every survey type: colors must be hex, geometry
	// bounded, label short.
	if a := s.Appearance; a != nil {
		validColor := func(c string) bool {
			if len(c) != 4 && len(c) != 7 {
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

func (s *Store) UpdateSiteRecording(siteID int64, enabled bool) error {
	_, err := s.db.Exec(`UPDATE sites SET recording_enabled = ? WHERE id = ?`, boolToInt(enabled), siteID)
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
