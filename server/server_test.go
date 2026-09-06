package main

import (
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		store:  store,
		cfg:    &Config{Password: "pw", RetentionDays: 90},
		secret: secret,
		static: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}),
	}
	ts := httptest.NewServer(srv.routes())
	t.Cleanup(ts.Close)
	return srv, ts
}

func postJSON(t *testing.T, url, body string, gz bool) *http.Response {
	t.Helper()
	var req *http.Request
	if gz {
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		zw.Write([]byte(body))
		zw.Close()
		req, _ = http.NewRequest(http.MethodPost, url, &buf)
		req.Header.Set("Content-Encoding", "gzip")
	} else {
		req, _ = http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

func TestAuthAndSites(t *testing.T) {
	_, ts := newTestServer(t)

	resp, _ := http.Post(ts.URL+"/api/auth/login", "application/json", strings.NewReader(`{"password":"wrong"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong password: got %d, want 401", resp.StatusCode)
	}

	resp, _ = http.Post(ts.URL+"/api/auth/login", "application/json", strings.NewReader(`{"password":"pw"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login failed: %d", resp.StatusCode)
	}
	var cookies []*http.Cookie = resp.Cookies()
	if len(cookies) == 0 {
		t.Fatal("no session cookie set")
	}

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/sites", strings.NewReader(`{"name":"Test"}`))
	req.AddCookie(cookies[0])
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	var site Site
	json.NewDecoder(resp2.Body).Decode(&site)
	if site.SiteKey == "" {
		t.Fatal("site key not returned")
	}
}

func TestIngestFlow(t *testing.T) {
	srv, ts := newTestServer(t)

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/sites", strings.NewReader(`{"name":"T"}`))
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

	if r := postJSON(t, ingestURL, `{"type":"hello","session_id":"s1","url":"https://x.test/","referrer":"https://g.test","viewport_w":1440,"viewport_h":900}`, false); r.StatusCode != 200 {
		t.Fatalf("hello: %d", r.StatusCode)
	}
	events := `{"type":"events","session_id":"s1","seq":0,"events":[{"type":4,"timestamp":1},{"type":2,"timestamp":2}]}`
	if r := postJSON(t, ingestURL, events, true); r.StatusCode != 200 {
		t.Fatalf("events gzip: %d", r.StatusCode)
	}
	if r := postJSON(t, ingestURL, `{"type":"page","session_id":"s1","idx":0,"url":"https://x.test/pricing","title":"Pricing"}`, false); r.StatusCode != 200 {
		t.Fatalf("page: %d", r.StatusCode)
	}
	if r := postJSON(t, ingestURL, `{"type":"ping","session_id":"s1","duration_ms":60000,"page_count":1}`, false); r.StatusCode != 200 {
		t.Fatalf("ping: %d", r.StatusCode)
	}
	// Unknown key must not leak existence.
	if r := postJSON(t, ts.URL+"/api/ingest/nope", `{"type":"ping","session_id":"s1"}`, false); r.StatusCode != http.StatusNoContent {
		t.Fatalf("unknown key: got %d, want 204", r.StatusCode)
	}

	sess, err := srv.store.GetSession("s1")
	if err != nil {
		t.Fatal(err)
	}
	if sess == nil || sess.InitialURL != "https://x.test/" || sess.EventCount != 2 ||
		sess.PageCount != 1 || sess.DurationMs != 60000 || sess.Browser != "Safari" || sess.OS != "macOS" {
		t.Fatalf("session row wrong: %+v", sess)
	}
}

func TestMultiPageSession(t *testing.T) {
	srv, ts := newTestServer(t)

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/sites", strings.NewReader(`{"name":"T"}`))
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

	u := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)
	// Page 1: external referrer + UTM; page 2 arrives with an internal referrer.
	postJSON(t, u, `{"type":"hello","session_id":"mp","url":"https://x.test/?utm_source=ads","referrer":"https://google.com/","utm_source":"ads"}`, false)
	postJSON(t, u, `{"type":"page","session_id":"mp","idx":0,"url":"https://x.test/","title":"Home","entered_at":1000}`, false)
	postJSON(t, u, `{"type":"ping","session_id":"mp","duration_ms":30000,"page_count":1}`, false)
	postJSON(t, u, `{"type":"hello","session_id":"mp","url":"https://x.test/pricing","referrer":"https://x.test/"}`, false)
	postJSON(t, u, `{"type":"page","session_id":"mp","idx":1,"url":"https://x.test/pricing","title":"Pricing","entered_at":1045}`, false)
	postJSON(t, u, `{"type":"ping","session_id":"mp","duration_ms":90000,"page_count":2}`, false)

	sess, err := srv.store.GetSession("mp")
	if err != nil {
		t.Fatal(err)
	}
	if sess.Referrer != "https://google.com/" || sess.UTMSource != "ads" || sess.PageCount != 2 || sess.DurationMs != 90000 {
		t.Fatalf("session attribution wrong: %+v", sess)
	}
	pages, err := srv.store.GetSessionPages("mp")
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 2 {
		t.Fatalf("want 2 pages, got %d", len(pages))
	}
	if pages[0].LeftAt != 1045 {
		t.Fatalf("page 0 should close when page 1 opens (left_at=1045), got %d", pages[0].LeftAt)
	}
	if pages[0].Dwell() != 45 {
		t.Fatalf("page 0 dwell should be 45s, got %d", pages[0].Dwell())
	}
}

func TestParseUA(t *testing.T) {
	cases := []struct{ ua, b, o, d string }{
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome", "Windows", "desktop"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", "Safari", "iOS", "mobile"},
		{"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", "Chrome", "Android", "mobile"},
		{"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Bot", "Unknown", "desktop"},
	}
	for _, c := range cases {
		b, o, d := parseUA(c.ua)
		if b != c.b || o != c.o || d != c.d {
			t.Errorf("parseUA(%q) = %q/%q/%q, want %q/%q/%q", c.ua, b, o, d, c.b, c.o, c.d)
		}
	}
}
