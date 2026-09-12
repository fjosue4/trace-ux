package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// A link_url that net/url parses happily can still contain a double quote,
// which would close the href attribute the tracker widget renders.
func TestAnnouncementLinkRejectsAttributeInjection(t *testing.T) {
	bad := []string{
		`https://example.com/?a=" autofocus onfocus="alert(1)`,
		`https://example.com/x"onmouseover="alert(1)`,
		`https://example.com/<img src=x>`,
		`https://example.com/a'b`,
		"https://example.com/a b",
		"javascript:alert(1)",
		"//example.com/protocol-relative",
	}
	for _, raw := range bad {
		if validAnnouncementLink(raw) {
			t.Errorf("validAnnouncementLink(%q) = true, want false", raw)
		}
		if validateAnnouncement(Announcement{Title: "t", LinkURL: raw}) == nil {
			t.Errorf("validateAnnouncement accepted link_url %q", raw)
		}
	}
	for _, raw := range []string{
		"https://example.com",
		"https://example.com/changelog?v=2#top",
		"http://localhost:8080/notes",
	} {
		if !validAnnouncementLink(raw) {
			t.Errorf("validAnnouncementLink(%q) = false, want true", raw)
		}
	}
}

// Widget colors land inside the <style> block the tracker injects into visitor
// pages, so only real hex triplets may be stored or served.
func TestAnnouncementAppearanceRequiresHexColors(t *testing.T) {
	for _, c := range []string{"#}a{b:", "#red;}", "red", "#12345", "#gggggg", "rgb(0,0,0)"} {
		s := DefaultSiteSettings()
		s.UpdatesAppearance = &AnnouncementAppearance{Accent: c}
		if err := ValidateSiteSettings(s); err == nil {
			t.Errorf("ValidateSiteSettings accepted announcement color %q", c)
		}
	}
	s := DefaultSiteSettings()
	s.UpdatesAppearance = &AnnouncementAppearance{Accent: "#2f7d4a", PanelBg: "#fff"}
	if err := ValidateSiteSettings(s); err != nil {
		t.Fatalf("ValidateSiteSettings rejected valid colors: %v", err)
	}
}

// Rows written by an older build could hold a non-hex color; reading settings
// must scrub them rather than hand them to the tracker.
func TestParseSiteSettingsDropsUnsafeStoredColors(t *testing.T) {
	stored := `{"updates_appearance":{"accent":"#}a{b:"},"appearance":{"button_bg":"#</sty","panel_bg":"#ffffff"}}`
	s := ParseSiteSettings(stored)
	if s.UpdatesAppearance.Accent != "" {
		t.Errorf("updates accent = %q, want empty", s.UpdatesAppearance.Accent)
	}
	if s.Appearance.ButtonBg != "" {
		t.Errorf("appearance button_bg = %q, want empty", s.Appearance.ButtonBg)
	}
	if s.Appearance.PanelBg != "#ffffff" {
		t.Errorf("appearance panel_bg = %q, want it kept", s.Appearance.PanelBg)
	}
}

// The /api/updates/* endpoints are unauthenticated and addressed by a site key
// that ships in every tracker snippet, so they must be rate limited.
func TestPublicUpdatesAreRateLimited(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	if _, err := srv.store.db.Exec(
		`INSERT INTO announcements(site_id,title,summary,body,release_label,link_url,status,published_at,created_at,updated_at)
		 VALUES(?,'t','','','','','published',?,?,?)`, site.ID, now, now, now); err != nil {
		t.Fatal(err)
	}

	url := fmt.Sprintf("%s/api/updates/%s/1/comments", ts.URL, site.SiteKey)
	var limited bool
	for i := 0; i < 40 && !limited; i++ {
		body := fmt.Sprintf(`{"visitor_key":"visitor-%08d","body":"hi"}`, i)
		resp, err := http.Post(url, "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			limited = true
		}
	}
	if !limited {
		t.Fatal("public comment endpoint never returned 429")
	}
}

// A single visitor key cannot flood one announcement even while under the
// per-minute request limit.
func TestCommentsCappedPerVisitor(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.initSecurity()
	// Take the request limiter out of the picture; this test covers the row cap.
	srv.updatesWriteLimiter = newRequestLimiter(1_000, time.Minute)
	srv.updatesSiteLimiter = newRequestLimiter(1_000, time.Minute)

	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	if _, err := srv.store.db.Exec(
		`INSERT INTO announcements(site_id,title,summary,body,release_label,link_url,status,published_at,created_at,updated_at)
		 VALUES(?,'t','','','','','published',?,?,?)`, site.ID, now, now, now); err != nil {
		t.Fatal(err)
	}

	url := fmt.Sprintf("%s/api/updates/%s/1/comments", ts.URL, site.SiteKey)
	accepted := 0
	for i := 0; i < maxCommentsPerVisitor+5; i++ {
		resp, err := http.Post(url, "application/json", strings.NewReader(`{"visitor_key":"one-visitor-key","body":"hi"}`))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusCreated {
			accepted++
		}
	}
	if accepted != maxCommentsPerVisitor {
		t.Fatalf("accepted %d comments, want %d", accepted, maxCommentsPerVisitor)
	}
}

// "liked": false used to be routed through a request header, where a caller's
// own X-Announcement-Liked header could reach the handler.
func TestReactionIgnoresClientSuppliedHeader(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	if _, err := srv.store.db.Exec(
		`INSERT INTO announcements(site_id,title,summary,body,release_label,link_url,status,published_at,created_at,updated_at)
		 VALUES(?,'t','','','','','published',?,?,?)`, site.ID, now, now, now); err != nil {
		t.Fatal(err)
	}

	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/api/updates/%s/1/reaction", ts.URL, site.SiteKey),
		strings.NewReader(`{"visitor_key":"one-visitor-key"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Announcement-Liked", "false")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	var n int
	if err := srv.store.db.QueryRow(`SELECT COUNT(*) FROM announcement_reactions`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("reactions = %d, want 1 (header must not suppress the like)", n)
	}
}

// Errors from the unauthenticated surface must not echo SQL or schema details.
func TestPublicUpdatesDoNotLeakInternalErrors(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(fmt.Sprintf("%s/api/updates/%s", ts.URL, site.SiteKey))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var rows []Announcement
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows = %d, want 0", len(rows))
	}
}
