package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// authed issues a request carrying a fresh admin session cookie.
func authed(t *testing.T, tsURL, method, path, body string) *http.Response {
	t.Helper()
	login, err := http.Post(tsURL+"/api/auth/login", "application/json", strings.NewReader(`{"password":"pw"}`))
	if err != nil {
		t.Fatal(err)
	}
	login.Body.Close()
	req, _ := http.NewRequest(method, tsURL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for _, c := range login.Cookies() {
		req.AddCookie(c)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func siteName(t *testing.T, srv *Server, id int64) string {
	t.Helper()
	site, _, _, _, err := srv.store.GetSiteDetail(id)
	if err != nil {
		t.Fatal(err)
	}
	if site == nil {
		t.Fatal("site vanished")
	}
	return site.Name
}

func TestRenameSite(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("replypro-web", "https://my.replypro.io")
	if err != nil {
		t.Fatal(err)
	}

	resp := authed(t, ts.URL, http.MethodPatch, "/api/sites/1", `{"name":"  Reply Pro  "}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rename: got %d, want 200", resp.StatusCode)
	}
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	if out["name"] != "Reply Pro" {
		t.Errorf("response echoed %q, want the trimmed stored value %q", out["name"], "Reply Pro")
	}
	if got := siteName(t, srv, site.ID); got != "Reply Pro" {
		t.Errorf("stored name is %q, want %q", got, "Reply Pro")
	}
}

// A rename must not change the site key: the tracker snippet already deployed
// on the customer's pages is keyed by it, so a rename that rotated it would
// silently stop recording.
func TestRenameKeepsSiteKeyAndURL(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("old", "https://my.replypro.io")
	if err != nil {
		t.Fatal(err)
	}
	resp := authed(t, ts.URL, http.MethodPatch, "/api/sites/1", `{"name":"new"}`)
	resp.Body.Close()

	after, _, _, _, err := srv.store.GetSiteDetail(site.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.SiteKey != site.SiteKey {
		t.Errorf("site key changed on rename: %q -> %q", site.SiteKey, after.SiteKey)
	}
	if after.URL != site.URL {
		t.Errorf("url changed on a name-only patch: %q -> %q", site.URL, after.URL)
	}
}

func TestRenameRejectsEmptyAndOverlongNames(t *testing.T) {
	srv, ts := newTestServer(t)
	if _, err := srv.store.CreateSite("keep me", "https://my.replypro.io"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ label, body string }{
		{"empty", `{"name":""}`},
		{"whitespace only", `{"name":"   "}`},
		{"101 characters", `{"name":"` + strings.Repeat("a", 101) + `"}`},
	} {
		resp := authed(t, ts.URL, http.MethodPatch, "/api/sites/1", tc.body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", tc.label, resp.StatusCode)
		}
		if got := siteName(t, srv, 1); got != "keep me" {
			t.Fatalf("%s: a rejected rename changed the name to %q", tc.label, got)
		}
	}
}

// Name and URL are separate UPDATEs. Validating as we went would let a good
// name land before a bad URL returned 400 -- a failed request that changed
// something.
func TestRejectedURLDoesNotApplyTheName(t *testing.T) {
	srv, ts := newTestServer(t)
	if _, err := srv.store.CreateSite("original", "https://my.replypro.io"); err != nil {
		t.Fatal(err)
	}
	resp := authed(t, ts.URL, http.MethodPatch, "/api/sites/1",
		`{"name":"Reply Pro","url":"not a url at all"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("got %d, want 400 for an invalid URL", resp.StatusCode)
	}
	if got := siteName(t, srv, 1); got != "original" {
		t.Fatalf("the name was applied despite the request failing: %q", got)
	}
}

// The response echoes what was STORED rather than the raw input. Today
// normalizeSiteURL only trims, so the two coincide -- this pins that they stay
// coincident if it ever starts rewriting the URL.
func TestPatchEchoesStoredURL(t *testing.T) {
	srv, ts := newTestServer(t)
	if _, err := srv.store.CreateSite("s", "https://my.replypro.io"); err != nil {
		t.Fatal(err)
	}
	resp := authed(t, ts.URL, http.MethodPatch, "/api/sites/1", `{"url":"  https://example.com  "}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d, want 200", resp.StatusCode)
	}
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)

	site, _, _, _, err := srv.store.GetSiteDetail(1)
	if err != nil {
		t.Fatal(err)
	}
	if out["url"] != site.URL {
		t.Errorf("response said %q but %q was stored", out["url"], site.URL)
	}
	if site.URL != "https://example.com" {
		t.Errorf("stored %q, want the trimmed URL", site.URL)
	}
}

func TestNothingToUpdateIsRejected(t *testing.T) {
	_, ts := newTestServer(t)
	resp := authed(t, ts.URL, http.MethodPatch, "/api/sites/1", `{}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty patch: got %d, want 400", resp.StatusCode)
	}
}
