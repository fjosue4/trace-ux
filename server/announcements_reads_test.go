package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Reads name the visitor like likes and comments do, and a later anonymous
// read must not erase an identity the visitor already gave.
func TestAnnouncementReadsAreAttributed(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	if _, err := srv.store.DB.Exec(
		`INSERT INTO announcements(site_id,title,summary,body,release_label,link_url,status,published_at,created_at,updated_at)
		 VALUES(?,'t','','','','','published',?,?,?)`, site.ID, now, now, now); err != nil {
		t.Fatal(err)
	}

	url := fmt.Sprintf("%s/api/updates/%s/1/read", ts.URL, site.SiteKey)
	for _, body := range []string{
		`{"visitor_key":"known-visitor-key","user_id":"ada@example.com"}`,
		`{"visitor_key":"known-visitor-key","user_id":""}`,
		`{"visitor_key":"anonymous-visitor"}`,
	} {
		resp, err := http.Post(url, "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("read %s: status %d", body, resp.StatusCode)
		}
	}

	engagement, err := srv.store.AnnouncementEngagement(1)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, entry := range engagement.Reads {
		got[entry.VisitorKey] = entry.UserID
	}
	if len(got) != 2 || got["known-visitor-key"] != "ada@example.com" || got["anonymous-visitor"] != "" {
		t.Fatalf("reads = %+v, want the known visitor named and the anonymous one blank", engagement.Reads)
	}
}
