package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ---- Sites ----

type Site struct {
	ID               int64        `json:"id"`
	Name             string       `json:"name"`
	URL              string       `json:"url"`
	SiteKey          string       `json:"site_key"`
	CreatedAt        int64        `json:"created_at"`
	SessionCount     int64        `json:"session_count"`
	RecordingEnabled bool         `json:"recording_enabled"`
	Settings         SiteSettings `json:"settings"`
	// PerformanceKey is only populated on site creation or explicit key creation;
	// stored/listed sites never expose the hashed credential.
	PerformanceKey string `json:"performance_key,omitempty"`
}

func newKey(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	return hex.EncodeToString(b)
}

func (s *Store) CreateSite(name, url string) (Site, error) {
	now := time.Now().Unix()
	key := newKey(16)
	performanceKey := newPerformanceKey()
	tx, err := s.DB.Begin()
	if err != nil {
		return Site{}, err
	}
	res, err := tx.Exec(`INSERT INTO sites (name, url, site_key, created_at) VALUES (?, ?, ?, ?)`, name, url, key, now)
	if err != nil {
		tx.Rollback()
		return Site{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		tx.Rollback()
		return Site{}, err
	}
	if _, err := tx.Exec(`INSERT INTO performance_keys (site_id, key_hash, key_prefix, key_suffix, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, hashPerformanceKey(performanceKey), performanceKey[:4], performanceKey[len(performanceKey)-4:], now); err != nil {
		tx.Rollback()
		return Site{}, err
	}
	if err := tx.Commit(); err != nil {
		return Site{}, err
	}
	return Site{ID: id, Name: name, URL: url, SiteKey: key, CreatedAt: now, RecordingEnabled: true, Settings: DefaultSiteSettings(), PerformanceKey: performanceKey}, nil
}

const siteCols = `s.id, s.name, s.url, s.site_key, s.created_at, s.recording_enabled, s.config,
	(SELECT COUNT(*) FROM sessions se WHERE se.site_id = s.id) AS session_count`

func scanSite(row interface{ Scan(...any) error }) (*Site, error) {
	var st Site
	var recording int
	var config string
	if err := row.Scan(&st.ID, &st.Name, &st.URL, &st.SiteKey, &st.CreatedAt, &recording, &config, &st.SessionCount); err != nil {
		return nil, err
	}
	st.RecordingEnabled = recording != 0
	st.Settings = ParseSiteSettings(config)
	return &st, nil
}

const listSitesQuery = `SELECT ` + siteCols + ` FROM sites s ORDER BY s.created_at DESC`

const siteByKeyQuery = `SELECT ` + siteCols + ` FROM sites s WHERE s.site_key = ?`

func (s *Store) ListSites() ([]Site, error) {
	rows, err := s.DB.Query(listSitesQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sites := []Site{}
	for rows.Next() {
		st, err := scanSite(rows)
		if err != nil {
			return nil, err
		}
		sites = append(sites, *st)
	}
	return sites, rows.Err()
}

func (s *Store) GetSiteByKey(key string) (Site, error) {
	st, err := scanSite(s.DB.QueryRow(siteByKeyQuery, key))
	if err == sql.ErrNoRows {
		return Site{}, nil // unknown key: zero Site, no error; caller decides
	}
	if st != nil {
		return *st, err
	}
	return Site{}, err
}

func (s *Store) DeleteSite(id int64) error {
	_, err := s.DB.Exec(`DELETE FROM sites WHERE id = ?`, id)
	return err
}

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

type AnnouncementAppearance struct {
	Theme       string `json:"theme,omitempty"`
	ButtonBg    string `json:"button_bg,omitempty"`
	ButtonText  string `json:"button_text,omitempty"`
	ButtonLabel string `json:"button_label,omitempty"`
	PanelBg     string `json:"panel_bg,omitempty"`
	PanelText   string `json:"panel_text,omitempty"`
	Accent      string `json:"accent,omitempty"`
	ActionBg    string `json:"action_bg,omitempty"`
	ActionText  string `json:"action_text,omitempty"`
	Radius      int    `json:"radius,omitempty"`
	MaxWidth    int    `json:"max_width,omitempty"`
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
	// WidgetPosition is the corner the single launcher anchors to. The
	// per-section UpdatesPosition/FeedbackPosition below predate the merge of
	// the two widgets and are kept only so rows written by an older build
	// still resolve; ParseSiteSettings derives this field from them, and the
	// dashboard mirrors this value back into both on save.
	WidgetPosition string `json:"widget_position"` // right | left
	// WidgetEnabled is the master switch for the whole widget: with it off the
	// tracker mounts nothing, whatever the per-section flags say. It is a
	// pointer because rows written before it existed carry no key at all, and
	// a plain bool would read as false and switch off every widget in the
	// field the first time its settings were parsed. nil means "derive from
	// the sections", which is exactly how the widget behaved before.
	WidgetEnabled         *bool                   `json:"widget_enabled,omitempty"`
	UpdatesEnabled        bool                    `json:"updates_enabled"`
	UpdatesPosition       string                  `json:"updates_position"`
	UpdatesAppearance     *AnnouncementAppearance `json:"updates_appearance,omitempty"`
	FeedbackEnabled       bool                    `json:"feedback_enabled"`
	FeedbackPosition      string                  `json:"feedback_position"` // right | left
	TicketsEnabled        bool                    `json:"tickets_enabled"`
	SurveyID              string                  `json:"survey_id"`
	SurveyTitle           string                  `json:"survey_title"`
	SurveyType            string                  `json:"survey_type"` // stars | nps | custom
	Questions             []SurveyQuestion        `json:"questions,omitempty"`
	Appearance            *SiteAppearance         `json:"appearance,omitempty"`
	MaxConcurrentSessions int                     `json:"max_concurrent_sessions,omitempty"` // 0 = unlimited
	RetentionSessionsDays int                     `json:"retention_sessions_days,omitempty"` // 0 = server default
	RetentionFeedbackDays int                     `json:"retention_feedback_days,omitempty"` // 0 = server default
	AllowDeleteRecordings bool                    `json:"allow_delete_recordings"`
	FeedbackTrigger       *FeedbackTrigger        `json:"feedback_trigger,omitempty"`
	Logs                  LogSettings             `json:"logs"`
}

func boolPtr(v bool) *bool { return &v }

// WidgetOn reports whether the widget is allowed to mount at all. Sites
// configured before the master switch existed have no stored value; they keep
// the old behaviour, where having any section switched on was what made the
// widget appear.
func (s SiteSettings) WidgetOn() bool {
	if s.WidgetEnabled != nil {
		return *s.WidgetEnabled
	}
	return s.UpdatesEnabled || s.FeedbackEnabled || s.TicketsEnabled
}

func DefaultSiteSettings() SiteSettings {
	return SiteSettings{
		WidgetPosition:        "right",
		WidgetEnabled:         boolPtr(true),
		UpdatesEnabled:        true,
		UpdatesPosition:       "right",
		FeedbackEnabled:       true,
		FeedbackPosition:      "right",
		TicketsEnabled:        false,
		SurveyID:              "default",
		SurveyTitle:           "How was your experience?",
		SurveyType:            "stars",
		AllowDeleteRecordings: true,
		FeedbackTrigger:       &FeedbackTrigger{Mode: "always"},
		Logs:                  DefaultLogSettings(),
	}
}

// ParseSiteSettings layers stored JSON over the defaults, so new fields and
// partial config never break existing sites.
func ParseSiteSettings(configText string) SiteSettings {
	s := DefaultSiteSettings()
	if configText != "" {
		// DefaultSiteSettings supplies the new default for newly created sites,
		// but older stored JSON has no widget_enabled key. Preserve that
		// distinction so legacy sites continue deriving the master state from
		// their existing section flags until an operator explicitly saves it.
		var raw map[string]json.RawMessage
		if err := json.Unmarshal([]byte(configText), &raw); err == nil {
			if _, ok := raw["widget_enabled"]; !ok {
				s.WidgetEnabled = nil
			}
			// A row written by an older dashboard has only the threshold field.
			// Clear the new default so normalization below can migrate that
			// threshold into its equivalent explicit selection.
			if rawLogs, ok := raw["logs"]; ok {
				var logRaw map[string]json.RawMessage
				if err := json.Unmarshal(rawLogs, &logRaw); err == nil {
					if _, ok := logRaw["severities"]; !ok {
						s.Logs.Severities = nil
					}
				}
			}
		}
		_ = json.Unmarshal([]byte(configText), &s)
	}
	if s.FeedbackPosition == "" {
		s.FeedbackPosition = "right"
	}
	if s.UpdatesPosition == "" {
		s.UpdatesPosition = "right"
	}
	NormalizeWidgetPosition(&s)
	if s.SurveyID == "" {
		s.SurveyID = "default"
	}
	if s.SurveyTitle == "" {
		s.SurveyTitle = "How was your experience?"
	}
	if s.SurveyType == "" {
		s.SurveyType = "stars"
	}
	if !ValidLogSeverity(s.Logs.MinimumSeverity) {
		s.Logs.MinimumSeverity = LogSeverityError
	}
	if s.Logs.RetentionDays < 0 || s.Logs.RetentionDays > maxLogRetentionDays {
		s.Logs.RetentionDays = defaultLogRetentionDays
	}
	if s.Logs.MaxRows < 0 || s.Logs.MaxRows > maxLogRows {
		s.Logs.MaxRows = defaultLogMaxRows
	}
	NormalizeLogSettings(&s.Logs)
	sanitizeAppearance(&s)
	return s
}

// NormalizeWidgetPosition settles the single corner the launcher anchors to.
// Rows written before the two widgets merged carry only the per-section
// positions, so an operator who had moved either one to the left keeps that
// choice. The legacy fields are then kept in step: one launcher cannot be in
// two corners, and the backwards-compatible config blocks must not disagree
// with the widget block.
func NormalizeWidgetPosition(s *SiteSettings) {
	switch s.WidgetPosition {
	case "right", "left", "middle-right", "middle-left":
		// Recognised. middle-* anchors the launcher to the side edge; the
		// server splits it into position + anchor for the tracker.
	default:
		// Unset, or a value this build does not know. Promote whatever an
		// older dashboard sent per section, else fall back to bottom-right.
		if s.UpdatesPosition == "left" || s.FeedbackPosition == "left" {
			s.WidgetPosition = "left"
		} else {
			s.WidgetPosition = "right"
		}
	}
	// The per-section fields predate the unified setting and only ever meant
	// left|right. Older trackers still read them, so they get the SIDE and
	// never the anchor -- mirroring "middle-left" into them would hand those
	// trackers a value they resolve to "right", putting the widget on the
	// wrong edge for anyone who has not upgraded.
	side := "right"
	if strings.HasSuffix(s.WidgetPosition, "left") {
		side = "left"
	}
	s.UpdatesPosition = side
	s.FeedbackPosition = side
}

// sanitizeAppearance drops any stored color that is not a hex triplet. The PUT
// handler validates on the way in, but rows written by an older build (whose
// announcement-color check accepted any 4- or 7-character string starting with
// '#') must not reach the tracker's <style> block either.
func sanitizeAppearance(s *SiteSettings) {
	if a := s.Appearance; a != nil {
		for _, c := range []*string{&a.ButtonBg, &a.ButtonText, &a.PanelBg, &a.PanelText, &a.Accent, &a.Primary, &a.PrimaryText} {
			if *c != "" && !validHexColor(*c) {
				*c = ""
			}
		}
	}
	if a := s.UpdatesAppearance; a != nil {
		for _, c := range []*string{&a.ButtonBg, &a.ButtonText, &a.PanelBg, &a.PanelText, &a.Accent, &a.ActionBg, &a.ActionText} {
			if *c != "" && !validHexColor(*c) {
				*c = ""
			}
		}
	}
}

// validHexColor accepts #rgb and #rrggbb only. Widget colors are interpolated
// straight into the <style> block the tracker injects into visitors' pages, so
// anything that is not literally a hex triplet is rejected here rather than
// escaped downstream.
func validHexColor(c string) bool {
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

// ValidateSiteSettings guards the values the dashboard PUTs.
func ValidateSiteSettings(s SiteSettings) error {
	// The unified setting also carries the anchor. The per-section fields below
	// keep the old left|right rule: NormalizeWidgetPosition only ever writes a
	// side into them, so an older tracker reading them cannot see an anchor it
	// would resolve to the wrong edge.
	switch s.WidgetPosition {
	case "", "right", "left", "middle-right", "middle-left":
	default:
		return fmt.Errorf("widget_position must be right, left, middle-right or middle-left")
	}
	if s.UpdatesPosition != "right" && s.UpdatesPosition != "left" {
		return fmt.Errorf("updates_position must be right or left")
	}
	if a := s.UpdatesAppearance; a != nil {
		if a.Theme != "" && a.Theme != "light" && a.Theme != "dark" {
			return fmt.Errorf("announcement theme must be light or dark")
		}
		if len(a.ButtonLabel) > 40 || (a.Radius != 0 && (a.Radius < 6 || a.Radius > 40)) || (a.MaxWidth != 0 && (a.MaxWidth < 300 || a.MaxWidth > 560)) {
			return fmt.Errorf("invalid announcements appearance")
		}
		for _, c := range []string{a.ButtonBg, a.ButtonText, a.PanelBg, a.PanelText, a.Accent, a.ActionBg, a.ActionText} {
			if c != "" && !validHexColor(c) {
				return fmt.Errorf("announcement colors must be hex, e.g. #2f7d4a")
			}
		}
	}
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
	if !ValidLogSeverities(s.Logs.Severities) {
		return fmt.Errorf("logs.severities must contain only unique values: debug, info, warn or error")
	}
	if !ValidLogSeverity(s.Logs.MinimumSeverity) {
		return fmt.Errorf("logs.minimum_severity must be debug, info, warn or error")
	}
	if s.Logs.RetentionDays < 0 || s.Logs.RetentionDays > maxLogRetentionDays {
		return fmt.Errorf("logs.retention_days must be 0-%d", maxLogRetentionDays)
	}
	if s.Logs.MaxRows < 0 || s.Logs.MaxRows > maxLogRows {
		return fmt.Errorf("logs.max_rows must be 0-%d", maxLogRows)
	}

	// Appearance applies to every survey type: colors must be hex, geometry
	// bounded, label short.
	if a := s.Appearance; a != nil {
		colors := map[string]string{
			"button_bg": a.ButtonBg, "button_text": a.ButtonText,
			"panel_bg": a.PanelBg, "panel_text": a.PanelText,
			"accent": a.Accent, "primary": a.Primary, "primary_text": a.PrimaryText,
		}
		for name, c := range colors {
			if c != "" && !validHexColor(c) {
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
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = ? AND site_id = ? AND event_count > 0 AND last_seen > ?`,
		sessionID, siteID, time.Now().Add(-30*time.Minute).Unix()).Scan(&alreadyRecording); err != nil {
		return false, err
	}
	if alreadyRecording > 0 {
		return true, nil
	}
	cutoff := time.Now().Add(-30 * time.Minute).Unix()
	var activeOthers int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE site_id = ? AND last_seen > ? AND event_count > 0 AND id != ?`,
		siteID, cutoff, sessionID).Scan(&activeOthers); err != nil {
		return false, err
	}
	return activeOthers < maxConcurrent, nil
}

// RetentionSweep applies each site's retention windows: sessions (recordings)
// and feedback are deleted independently. Sites without an explicit window
// fall back to the server default.
// RetentionSweep and SweepToBudget both end by collecting stylesheets nothing
// references any more. Deleting sessions without this would leave the blobs
// behind, so the disk budget would measure bytes it can never reclaim and keep
// pruning in a loop looking for them.
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
		res, err := s.DB.Exec(`DELETE FROM sessions WHERE site_id = ? AND last_seen < ?`, st.ID, cutoff)
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
		res, err = s.DB.Exec(`DELETE FROM feedback WHERE site_id = ? AND created_at < ?`, st.ID, fcutoff)
		if err != nil {
			return total, err
		}
		n, _ = res.RowsAffected()
		total += n

		logSettings := st.Settings.Logs
		if logSettings.RetentionDays > 0 {
			logCutoff := time.Now().AddDate(0, 0, -logSettings.RetentionDays).Unix()
			res, err = s.DB.Exec(`DELETE FROM logs
				WHERE session_id IN (SELECT id FROM sessions WHERE site_id = ?)
				AND created_at < ?`, st.ID, logCutoff)
			if err != nil {
				return total, err
			}
			n, _ = res.RowsAffected()
			total += n
		}

		if logSettings.MaxRows > 0 {
			var logCount int64
			if err := s.DB.QueryRow(`SELECT COUNT(*) FROM logs l
				JOIN sessions se ON se.id = l.session_id
				WHERE se.site_id = ?`, st.ID).Scan(&logCount); err != nil {
				return total, err
			}
			if logCount > int64(logSettings.MaxRows) {
				remove := logCount - int64(logSettings.MaxRows)
				res, err = s.DB.Exec(`DELETE FROM logs WHERE id IN (
					SELECT l.id FROM logs l
					JOIN sessions se ON se.id = l.session_id
					WHERE se.site_id = ?
					ORDER BY l.id ASC
					LIMIT ?
				)`, st.ID, remove)
				if err != nil {
					return total, err
				}
				n, _ = res.RowsAffected()
				total += n
			}
		}
	}
	// Backend latency uses the server retention window. Its rows are already
	// minute-level aggregates, so one global delete keeps the APM store bounded
	// without coupling it to the browser recording settings.
	if n, err := s.DeleteOldPerformanceMetrics(defaultDays); err != nil {
		return total, err
	} else {
		total += n
	}
	if _, err := s.GCCSSAssets(); err != nil {
		return total, err
	}
	return total, nil
}

func (s *Store) DeleteSession(id string) error {
	_, err := s.DB.Exec(`DELETE FROM sessions WHERE id = ?`, id)
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
	err = s.DB.QueryRow(q, args...).Scan(&active, &completed)
	return
}

func (s *Store) UpdateSiteRecording(siteID int64, enabled bool) error {
	_, err := s.DB.Exec(`UPDATE sites SET recording_enabled = ? WHERE id = ?`, boolToInt(enabled), siteID)
	return err
}

func (s *Store) UpdateSiteName(siteID int64, name string) error {
	_, err := s.DB.Exec(`UPDATE sites SET name = ? WHERE id = ?`, name, siteID)
	return err
}

func (s *Store) UpdateSiteURL(siteID int64, url string) error {
	_, err := s.DB.Exec(`UPDATE sites SET url = ? WHERE id = ?`, url, siteID)
	return err
}

func (s *Store) UpdateSiteSettings(siteID int64, settings SiteSettings) error {
	b, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`UPDATE sites SET config = ? WHERE id = ?`, string(b), siteID)
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
	st, err := scanSite(s.DB.QueryRow(`SELECT `+siteCols+` FROM sites s WHERE s.id = ?`, siteID))
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
	err = s.DB.QueryRow(`SELECT COUNT(*), COALESCE(AVG(rating), 0),
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
