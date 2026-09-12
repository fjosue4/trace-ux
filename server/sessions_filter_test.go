package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// Filter by action (custom event name) and by page visited, end to end
// through ingest + ListSessions.
func TestListSessionsFilterByActionAndURL(t *testing.T) {
	srv, ts := newTestServer(t)

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/sites", strings.NewReader(`{"name":"T","url":"https://t.example"}`))
	resp, _ := http.Post(ts.URL+"/api/auth/login", "application/json", strings.NewReader(`{"password":"pw"}`))
	for _, c := range resp.Cookies() {
		req.AddCookie(c)
	}
	resp.Body.Close()
	siteResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var site Site
	json.NewDecoder(siteResp.Body).Decode(&site)
	siteResp.Body.Close()

	ingestURL := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)
	mk := func(id string, pageURL string) {
		if r := postJSON(t, ingestURL, fmt.Sprintf(`{"type":"hello","session_id":%q,"url":%q}`, id, pageURL), false); r.StatusCode != 200 {
			t.Fatalf("hello %s: %d", id, r.StatusCode)
		}
	}
	mk("sess-with-action", "https://x.test/")
	mk("sess-no-action", "https://x.test/other")

	if r := postJSON(t, ingestURL, `{"type":"custom","session_id":"sess-with-action","events":[{"ts":1,"name":"signup_click","track_id":""}]}`, false); r.StatusCode != 200 {
		t.Fatalf("custom: %d", r.StatusCode)
	}

	// Action filter: only the session that recorded the event matches.
	got, err := srv.store.ListSessions(SessionFilter{Action: "signup_click", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "sess-with-action" {
		t.Fatalf("action filter: got %+v", got)
	}

	// Partial action names match (LIKE), absent actions match nothing.
	got, _ = srv.store.ListSessions(SessionFilter{Action: "signup", Limit: 50})
	if len(got) != 1 {
		t.Fatalf("partial action filter: got %d sessions", len(got))
	}
	got, _ = srv.store.ListSessions(SessionFilter{Action: "purchase", Limit: 50})
	if len(got) != 0 {
		t.Fatalf("missing action should match nothing: got %d sessions", len(got))
	}

	// Page visited filter still works alongside it.
	got, _ = srv.store.ListSessions(SessionFilter{URL: "/other", Limit: 50})
	if len(got) != 1 || got[0].ID != "sess-no-action" {
		t.Fatalf("url filter: got %+v", got)
	}
	got, _ = srv.store.ListSessions(SessionFilter{URL: "/other", Action: "signup_click", Limit: 50})
	if len(got) != 0 {
		t.Fatalf("combined url+action: got %d sessions", len(got))
	}
}
