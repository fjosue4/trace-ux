package main

import "strings"

// The feedback panel and the announcements panel are one widget: a single
// launcher opens a single panel whose sections depend on what the site has
// switched on. Historically the two halves carried separate appearance
// objects (SiteSettings.Appearance for feedback, SiteSettings.UpdatesAppearance
// for announcements) and the dashboard already told operators the two were
// "shared". WidgetAppearance is that shared object, resolved server-side so
// the tracker never has to reconcile the two legacy shapes.

// widgetPollIntervalMs is how often a mounted widget re-checks the
// announcements feed so a freshly published post can surface itself without a
// page reload. Change this one value to re-pace every tracker in the field —
// it is served in the config response, so no tracker rebuild is needed.
//
// DEBUG VALUE: 15s. Production pacing is 5 minutes (300_000).
const widgetPollIntervalMs = 15_000

const (
	defaultWidgetAccent    = "#2f7d4a"
	defaultWidgetRadius    = 18
	defaultWidgetMaxWidth  = 440
	defaultWidgetSpacing   = 16
	defaultWidgetLightBg   = "#ffffff"
	defaultWidgetLightText = "#142018"
	defaultWidgetDarkBg    = "#121b16"
	defaultWidgetDarkText  = "#eef5f0"
)

type WidgetAppearance struct {
	Theme       string `json:"theme"` // light | dark
	Accent      string `json:"accent"`
	ButtonBg    string `json:"button_bg"`
	ButtonText  string `json:"button_text"`
	PanelBg     string `json:"panel_bg"`
	PanelText   string `json:"panel_text"`
	Radius      int    `json:"radius"`
	MaxWidth    int    `json:"max_width"`
	Spacing     int    `json:"spacing"`
	IconURL     string `json:"icon_url"`      // "" when no custom icon is set
	LauncherTxt string `json:"launcher_text"` // label next to the icon
}

// WidgetConfig is what /api/config/{siteKey} hands the tracker. The tracker
// mounts one widget when Enabled is true and shows the tab strip only when
// both sections are available.
type WidgetConfig struct {
	Enabled         bool             `json:"enabled"`
	UpdatesEnabled  bool             `json:"updates_enabled"`
	FeedbackEnabled bool             `json:"feedback_enabled"`
	Position        string           `json:"position"` // right | left
	Title           string           `json:"title"`
	UpdatesLabel    string           `json:"updates_label"`
	FeedbackLabel   string           `json:"feedback_label"`
	PollIntervalMs  int              `json:"poll_interval_ms"`
	Appearance      WidgetAppearance `json:"appearance"`
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func firstPositive(values ...int) int {
	for _, v := range values {
		if v > 0 {
			return v
		}
	}
	return 0
}

// resolveWidgetAppearance folds the two legacy appearance objects into one.
// The announcements object wins because it is what the dashboard's Styles tab
// edits; the feedback object supplies anything the Styles tab does not cover
// and keeps sites that only ever configured the old feedback widget looking
// the way their operator left them.
func resolveWidgetAppearance(s SiteSettings, iconURL string) WidgetAppearance {
	updates := s.UpdatesAppearance
	feedback := s.Appearance
	if updates == nil {
		updates = &AnnouncementAppearance{}
	}
	if feedback == nil {
		feedback = &SiteAppearance{}
	}

	theme := updates.Theme
	if theme != "dark" {
		theme = "light"
	}
	panelBg, panelText := defaultWidgetLightBg, defaultWidgetLightText
	if theme == "dark" {
		panelBg, panelText = defaultWidgetDarkBg, defaultWidgetDarkText
	}

	accent := firstNonEmpty(updates.Accent, feedback.Accent, feedback.Primary, defaultWidgetAccent)
	appearance := WidgetAppearance{
		Theme:       theme,
		Accent:      accent,
		ButtonBg:    firstNonEmpty(updates.ButtonBg, feedback.ButtonBg, accent),
		ButtonText:  firstNonEmpty(updates.ButtonText, feedback.ButtonText, "#ffffff"),
		PanelBg:     firstNonEmpty(updates.PanelBg, feedback.PanelBg, panelBg),
		PanelText:   firstNonEmpty(updates.PanelText, feedback.PanelText, panelText),
		Radius:      firstPositive(updates.Radius, feedback.Radius, defaultWidgetRadius),
		MaxWidth:    firstPositive(updates.MaxWidth, defaultWidgetMaxWidth),
		Spacing:     firstPositive(feedback.Spacing, defaultWidgetSpacing),
		IconURL:     iconURL,
		LauncherTxt: firstNonEmpty(updates.ButtonLabel, feedback.ButtonLabel, "Help & updates"),
	}
	return appearance
}

// buildWidgetConfig decides which sections the visitor can reach. A site with
// only one of the two switched on still gets the widget — the panel simply
// opens straight into the section that exists, with no tab strip.
func buildWidgetConfig(site Site, iconURL string) WidgetConfig {
	s := site.Settings
	// Position is a property of the launcher, so it comes from the widget's own
	// setting (Styles tab) rather than from either section.
	position := firstNonEmpty(s.WidgetPosition, s.UpdatesPosition, s.FeedbackPosition, "right")
	if position != "left" {
		position = "right"
	}
	launcher := resolveWidgetAppearance(s, iconURL)

	// With only one section enabled the launcher should say what it opens
	// rather than carry a generic label the operator never chose.
	if strings.TrimSpace(launcher.LauncherTxt) == "" || launcher.LauncherTxt == "Help & updates" {
		switch {
		case s.UpdatesEnabled && !s.FeedbackEnabled:
			launcher.LauncherTxt = "What's new"
		case s.FeedbackEnabled && !s.UpdatesEnabled:
			launcher.LauncherTxt = "Feedback"
		}
	}

	return WidgetConfig{
		Enabled:         s.UpdatesEnabled || s.FeedbackEnabled,
		UpdatesEnabled:  s.UpdatesEnabled,
		FeedbackEnabled: s.FeedbackEnabled,
		Position:        position,
		Title:           firstNonEmpty(site.Name, "Help & updates"),
		UpdatesLabel:    "What's new",
		FeedbackLabel:   "Feedback",
		PollIntervalMs:  widgetPollIntervalMs,
		Appearance:      launcher,
	}
}
