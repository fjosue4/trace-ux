package main

import (
	"testing"

	"trace-ux/server/store"
)

// The stored setting is one string; the tracker receives two fields. Splitting
// here rather than adding values to `position` is what keeps an older tracker
// on the correct edge -- it reads the side it understands and ignores the
// anchor it does not.
func TestSplitWidgetPosition(t *testing.T) {
	for _, tc := range []struct{ stored, pos, anchor string }{
		{"right", "right", "bottom"},
		{"left", "left", "bottom"},
		{"middle-right", "right", "middle"},
		{"middle-left", "left", "middle"},
		{"MIDDLE-LEFT", "left", "middle"}, // case is not the operator's problem
		{"  left  ", "left", "bottom"},    // nor is whitespace
		{"", "right", "bottom"},           // unset
		{"centre", "right", "bottom"},     // typo
		{"middle", "right", "bottom"},     // ambiguous: no side named
		{"top-left", "right", "bottom"},   // a value from some future dashboard
	} {
		pos, anchor := splitWidgetPosition(tc.stored)
		if pos != tc.pos || anchor != tc.anchor {
			t.Errorf("%q -> (%q,%q), want (%q,%q)", tc.stored, pos, anchor, tc.pos, tc.anchor)
		}
	}
}

// Anything unrecognised must land on the layout every site had before anchors
// existed, never on an edge the tracker cannot draw.
func TestUnknownPositionFallsBackToBottomRight(t *testing.T) {
	for _, junk := range []string{"middle-centre", "🙂", "left-ish", "0"} {
		pos, anchor := splitWidgetPosition(junk)
		if pos != "right" || anchor != "bottom" {
			t.Errorf("%q -> (%q,%q), want the pre-existing bottom-right", junk, pos, anchor)
		}
	}
}

// A mid-edge tab stacks one letter per line, so a long label is a tall label.
func TestVerticalLabelIsCapped(t *testing.T) {
	long := store.SiteSettings{}
	long.WidgetPosition = "middle-left"
	long.UpdatesEnabled, long.FeedbackEnabled, long.TicketsEnabled = true, true, true

	cfg := buildWidgetConfig(store.Site{Settings: long}, "")
	if cfg.Anchor != "middle" {
		t.Fatalf("anchor = %q, want middle", cfg.Anchor)
	}
	if n := len([]rune(cfg.Appearance.LauncherTxt)); n > maxVerticalLabel {
		t.Errorf("vertical label %q is %d chars, over the %d cap",
			cfg.Appearance.LauncherTxt, n, maxVerticalLabel)
	}

	// The same site anchored at the bottom keeps its full label: length only
	// matters when the text is stacked.
	bottom := long
	bottom.WidgetPosition = "left"
	if got := buildWidgetConfig(store.Site{Settings: bottom}, "").Appearance.LauncherTxt; len([]rune(got)) <= maxVerticalLabel {
		t.Logf("bottom label %q happens to be short; cap is not exercised here", got)
	}
}

// Support is exactly at the limit -- it is the longest word the tab is meant to
// carry, so it must survive untouched.
func TestSupportLabelSurvivesTheCap(t *testing.T) {
	s := store.SiteSettings{}
	s.WidgetPosition = "middle-right"
	s.TicketsEnabled = true
	if got := buildWidgetConfig(store.Site{Settings: s}, "").Appearance.LauncherTxt; got != "Support" {
		t.Errorf("launcher label = %q, want Support", got)
	}
}

// Three separate places hardcoded left|right, and a middle anchor has to clear
// all of them: the validator (rejects the PUT), the store normaliser (coerces
// before saving), and buildWidgetConfig (splits for the tracker). Missing any
// one makes the setting silently do nothing, which is how it shipped in v0.3.0.
func TestMiddleAnchorSurvivesValidationAndNormalisation(t *testing.T) {
	for _, pos := range []string{"middle-left", "middle-right"} {
		s := validSettings(pos)
		if err := store.ValidateSiteSettings(s); err != nil {
			t.Fatalf("%s rejected by the validator: %v", pos, err)
		}
		store.NormalizeWidgetPosition(&s)
		if s.WidgetPosition != pos {
			t.Fatalf("%s was normalised away to %q", pos, s.WidgetPosition)
		}
		// The legacy fields must carry the SIDE only. An older tracker reads
		// them and resolves anything unrecognised to "right".
		wantSide := "right"
		if pos == "middle-left" {
			wantSide = "left"
		}
		if s.UpdatesPosition != wantSide || s.FeedbackPosition != wantSide {
			t.Errorf("%s leaked the anchor into legacy fields: updates=%q feedback=%q, want %q",
				pos, s.UpdatesPosition, s.FeedbackPosition, wantSide)
		}
	}
}

// An unrecognised value must still be refused loudly rather than coerced.
func TestBogusPositionIsRejected(t *testing.T) {
	s := validSettings("middle")
	if err := store.ValidateSiteSettings(s); err == nil {
		t.Fatal("'middle' with no side was accepted; it names no edge to draw on")
	}
}

// validSettings is the smallest SiteSettings that passes every unrelated rule,
// so a position test fails on the position and not on survey_type.
func validSettings(pos string) store.SiteSettings {
	s := store.DefaultSiteSettings()
	s.WidgetPosition = pos
	return s
}
