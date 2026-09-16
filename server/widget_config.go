package main

import (
	"strings"

	"trace-ux/server/store"
)

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

// The tracker uses this only while its widget socket is unavailable.
const widgetTicketPollIntervalMs = 15_000

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
// mounts one widget when Enabled is true and shows the tab strip when more
// than one available section is enabled.
type WidgetConfig struct {
	Enabled         bool   `json:"enabled"`
	UpdatesEnabled  bool   `json:"updates_enabled"`
	FeedbackEnabled bool   `json:"feedback_enabled"`
	TicketsEnabled  bool   `json:"tickets_enabled"`
	Position        string `json:"position"` // right | left
	// Anchor is deliberately a SECOND field rather than extra values in
	// Position. A tracker built before side anchors existed does
	// `cfg.position === 'left' ? 'left' : 'right'`, so a value of
	// "middle-left" would collapse to "right" and the widget would appear on
	// the wrong edge for every visitor still running that bundle. Split this
	// way, an old tracker reads the side correctly and ignores what it does not
	// know, degrading to the bottom-corner launcher it already draws.
	Anchor               string           `json:"anchor"` // bottom | middle
	Title                string           `json:"title"`
	UpdatesLabel         string           `json:"updates_label"`
	FeedbackLabel        string           `json:"feedback_label"`
	TicketsLabel         string           `json:"tickets_label"`
	PollIntervalMs       int              `json:"poll_interval_ms"`
	TicketPollIntervalMs int              `json:"ticket_poll_interval_ms"`
	Appearance           WidgetAppearance `json:"appearance"`
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
// The announcements object wins because it is what the dashboard's Widget tab
// edits; the feedback object supplies anything the Widget tab does not cover
// and keeps sites that only ever configured the old feedback widget looking
// the way their operator left them.
func resolveWidgetAppearance(s store.SiteSettings, iconURL string) WidgetAppearance {
	updates := s.UpdatesAppearance
	feedback := s.Appearance
	if updates == nil {
		updates = &store.AnnouncementAppearance{}
	}
	if feedback == nil {
		feedback = &store.SiteAppearance{}
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
// splitWidgetPosition turns the stored setting into the side the launcher sits
// on and the point it is anchored to. The whitelist is exhaustive on purpose: a
// typo or a value from a newer dashboard must land on the old behaviour rather
// than on an edge the tracker cannot draw.
func splitWidgetPosition(stored string) (position, anchor string) {
	switch strings.TrimSpace(strings.ToLower(stored)) {
	case "left":
		return "left", "bottom"
	case "middle-left":
		return "left", "middle"
	case "middle-right":
		return "right", "middle"
	default:
		return "right", "bottom"
	}
}

// maxVerticalLabel is how many characters fit in a mid-edge tab before the
// stacked text runs past a short viewport. "SUPPORT" is exactly at the limit;
// "Feedback" is the one auto-derived label that needs the eighth character.
const maxVerticalLabel = 8

// verticalFallbackLabel picks the shortest honest word for a tab whose
// configured label will not fit stacked. It names the section the panel opens
// into where there is only one, and otherwise says Help -- which is true of
// every combination and is four characters.
func verticalFallbackLabel(s store.SiteSettings) string {
	switch {
	case s.TicketsEnabled && !s.UpdatesEnabled && !s.FeedbackEnabled:
		return "Support"
	case s.FeedbackEnabled && !s.UpdatesEnabled && !s.TicketsEnabled:
		return "Feedback"
	case s.UpdatesEnabled && !s.FeedbackEnabled && !s.TicketsEnabled:
		// Not "What's new", which is the bottom-corner wording: ten letters
		// stacked is taller than the tab, and an apostrophe reads badly rotated.
		return "Updates"
	default:
		return "Help"
	}
}

func buildWidgetConfig(site store.Site, iconURL string) WidgetConfig {
	s := site.Settings
	// Position is a property of the launcher, so it comes from the widget's own
	// setting (Widget tab) rather than from either section.
	// Stored as one string so the dashboard has a single control; split here
	// into the two fields the tracker consumes. Anything unrecognised falls
	// back to the bottom-right launcher, which is what every site had before
	// anchors existed.
	position, anchor := splitWidgetPosition(
		firstNonEmpty(s.WidgetPosition, s.UpdatesPosition, s.FeedbackPosition, "right"))
	launcher := resolveWidgetAppearance(s, iconURL)

	// With only one section enabled the launcher should say what it opens
	// rather than carry a generic label the operator never chose.
	if strings.TrimSpace(launcher.LauncherTxt) == "" || launcher.LauncherTxt == "Help & updates" {
		switch {
		case s.UpdatesEnabled && !s.FeedbackEnabled && !s.TicketsEnabled:
			launcher.LauncherTxt = "What's new"
		case s.FeedbackEnabled && !s.UpdatesEnabled && !s.TicketsEnabled:
			launcher.LauncherTxt = "Feedback"
		case s.TicketsEnabled && !s.UpdatesEnabled && !s.FeedbackEnabled:
			launcher.LauncherTxt = "Support"
		}
	}

	// A mid-edge tab stacks its label one letter per line, so length is a
	// vertical measurement: "Help & updates" is fourteen rows and runs off a
	// short viewport. Substitute rather than truncate -- a clipped word reads
	// as a rendering fault, where a shorter correct word reads as a choice.
	if anchor == "middle" && len([]rune(launcher.LauncherTxt)) > maxVerticalLabel {
		launcher.LauncherTxt = verticalFallbackLabel(s)
	}

	// The master switch can hide the widget outright, but a site with every
	// section switched off has nothing to show either way.
	hasSection := s.UpdatesEnabled || s.FeedbackEnabled || s.TicketsEnabled

	return WidgetConfig{
		Enabled:              s.WidgetOn() && hasSection,
		UpdatesEnabled:       s.UpdatesEnabled,
		FeedbackEnabled:      s.FeedbackEnabled,
		TicketsEnabled:       s.TicketsEnabled,
		Position:             position,
		Anchor:               anchor,
		Title:                firstNonEmpty(site.Name, "Help & updates"),
		UpdatesLabel:         "What's new",
		FeedbackLabel:        "Feedback",
		TicketsLabel:         "Support",
		PollIntervalMs:       widgetPollIntervalMs,
		TicketPollIntervalMs: widgetTicketPollIntervalMs,
		Appearance:           launcher,
	}
}
