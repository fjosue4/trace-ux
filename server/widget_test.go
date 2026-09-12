package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"strings"
	"testing"
)

func testPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{R: 0xf2, G: 0x6b, B: 0x1f, A: 0xff})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// The launcher icon is served to every visitor of the customer's site, so the
// accepted set is raster-only: an SVG would be an XML document that can carry
// script into the visitor's origin.
func TestWidgetIconRejectsNonRasterUploads(t *testing.T) {
	rejects := map[string][]byte{
		"svg with script": []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>`),
		"html":            []byte(`<html><script>alert(1)</script></html>`),
		"empty":           {},
		"png magic only":  []byte("\x89PNG\r\n\x1a\n"),
	}
	for name, raw := range rejects {
		if _, _, _, err := decodeWidgetIcon(raw); err == nil {
			t.Errorf("decodeWidgetIcon accepted %s", name)
		}
	}

	// The real formats decode, and the MIME comes from the bytes.
	mime, w, h, err := decodeWidgetIcon(testPNG(t, 64, 64))
	if err != nil || mime != "image/png" || w != 64 || h != 64 {
		t.Fatalf("png: mime=%q %dx%d err=%v", mime, w, h, err)
	}

	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, image.NewRGBA(image.Rect(0, 0, 48, 48)), nil); err != nil {
		t.Fatal(err)
	}
	if mime, _, _, err := decodeWidgetIcon(jpg.Bytes()); err != nil || mime != "image/jpeg" {
		t.Fatalf("jpeg: mime=%q err=%v", mime, err)
	}

	var g bytes.Buffer
	if err := gif.Encode(&g, image.NewPaletted(image.Rect(0, 0, 32, 32), color.Palette{color.Black, color.White}), nil); err != nil {
		t.Fatal(err)
	}
	if mime, _, _, err := decodeWidgetIcon(g.Bytes()); err != nil || mime != "image/gif" {
		t.Fatalf("gif: mime=%q err=%v", mime, err)
	}
}

func TestWidgetIconBoundsDimensions(t *testing.T) {
	if _, _, _, err := decodeWidgetIcon(testPNG(t, 8, 8)); err == nil {
		t.Error("accepted an 8x8 icon, want a minimum-size rejection")
	}
	if _, _, _, err := decodeWidgetIcon(testPNG(t, 2048, 2048)); err == nil {
		t.Error("accepted a 2048x2048 icon, want a maximum-size rejection")
	}
}

// A stored icon must come back with the decoded MIME (never a caller-supplied
// one) and be cacheable by ETag.
func TestWidgetIconServedWithDecodedTypeAndETag(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	icon, err := srv.store.SaveWidgetIcon(site.ID, testPNG(t, 64, 64))
	if err != nil {
		t.Fatal(err)
	}

	resp, err := http.Get(ts.URL + "/api/widget-icon/" + site.SiteKey)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if got := resp.Header.Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", got)
	}
	if got := resp.Header.Get("Cache-Control"); !strings.Contains(got, "max-age") {
		t.Errorf("Cache-Control = %q, want a cacheable response", got)
	}

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/widget-icon/"+site.SiteKey, nil)
	req.Header.Set("If-None-Match", `"`+icon.ETag+`"`)
	cached, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer cached.Body.Close()
	if cached.StatusCode != http.StatusNotModified {
		t.Fatalf("revalidation status = %d, want 304", cached.StatusCode)
	}
}

func TestWidgetIconUnknownSiteIsNotFound(t *testing.T) {
	_, ts := newTestServer(t)
	resp, err := http.Get(ts.URL + "/api/widget-icon/nope")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

// One section enabled still yields a widget; the launcher then names that
// section instead of carrying the generic label.
func TestWidgetConfigWithSingleSection(t *testing.T) {
	cases := []struct {
		name             string
		updates, feeback bool
		wantEnabled      bool
		wantLauncher     string
	}{
		{"both", true, true, true, "Help & updates"},
		{"updates only", true, false, true, "What's new"},
		{"feedback only", false, true, true, "Feedback"},
		{"neither", false, false, false, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			settings := DefaultSiteSettings()
			settings.UpdatesEnabled = tc.updates
			settings.FeedbackEnabled = tc.feeback
			cfg := buildWidgetConfig(Site{Name: "Acme", Settings: settings}, "")
			if cfg.Enabled != tc.wantEnabled {
				t.Fatalf("Enabled = %v, want %v", cfg.Enabled, tc.wantEnabled)
			}
			if tc.wantEnabled && cfg.Appearance.LauncherTxt != tc.wantLauncher {
				t.Errorf("launcher = %q, want %q", cfg.Appearance.LauncherTxt, tc.wantLauncher)
			}
			if cfg.UpdatesEnabled != tc.updates || cfg.FeedbackEnabled != tc.feeback {
				t.Errorf("sections = %v/%v, want %v/%v", cfg.UpdatesEnabled, cfg.FeedbackEnabled, tc.updates, tc.feeback)
			}
		})
	}
}

// The two legacy appearance objects fold into one: the Styles tab's
// announcement object wins, the older feedback object fills the gaps.
func TestWidgetAppearanceMergesLegacyObjects(t *testing.T) {
	settings := DefaultSiteSettings()
	settings.UpdatesAppearance = &AnnouncementAppearance{Theme: "dark", Accent: "#123456", Radius: 24}
	settings.Appearance = &SiteAppearance{ButtonBg: "#abcdef", Spacing: 22, ButtonLabel: "Talk to us"}

	got := resolveWidgetAppearance(settings, "/api/widget-icon/k?v=1")
	if got.Theme != "dark" {
		t.Errorf("theme = %q, want dark", got.Theme)
	}
	if got.Accent != "#123456" {
		t.Errorf("accent = %q, want the announcements value", got.Accent)
	}
	if got.ButtonBg != "#abcdef" {
		t.Errorf("button_bg = %q, want the feedback fallback", got.ButtonBg)
	}
	if got.Radius != 24 {
		t.Errorf("radius = %d, want 24", got.Radius)
	}
	if got.Spacing != 22 {
		t.Errorf("spacing = %d, want the feedback fallback 22", got.Spacing)
	}
	if got.PanelBg != defaultWidgetDarkBg {
		t.Errorf("panel_bg = %q, want the dark default", got.PanelBg)
	}
	if got.IconURL != "/api/widget-icon/k?v=1" {
		t.Errorf("icon_url = %q", got.IconURL)
	}
}

// The tracker reads the whole widget block from the public config endpoint,
// and the icon must arrive as a URL rather than inline bytes: /api/config is
// uncached and fetched on every page load.
func TestConfigServesWidgetBlockWithIconURL(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Acme", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := srv.store.SaveWidgetIcon(site.ID, testPNG(t, 64, 64)); err != nil {
		t.Fatal(err)
	}

	resp, err := http.Get(ts.URL + "/api/config/" + site.SiteKey)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Widget WidgetConfig `json:"widget"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	w := payload.Widget
	if !w.Enabled || !w.UpdatesEnabled || !w.FeedbackEnabled {
		t.Fatalf("widget = %+v, want all sections on by default", w)
	}
	if w.Title != "Acme" {
		t.Errorf("title = %q, want the site name", w.Title)
	}
	if w.PollIntervalMs <= 0 {
		t.Errorf("poll_interval_ms = %d, want a positive interval", w.PollIntervalMs)
	}
	prefix := fmt.Sprintf("/api/widget-icon/%s?v=", site.SiteKey)
	if !strings.HasPrefix(w.Appearance.IconURL, prefix) {
		t.Errorf("icon_url = %q, want prefix %q", w.Appearance.IconURL, prefix)
	}
	if strings.Contains(w.Appearance.IconURL, "base64") || strings.Contains(w.Appearance.IconURL, "data:") {
		t.Errorf("icon_url = %q, want a URL rather than inline bytes", w.Appearance.IconURL)
	}
}
