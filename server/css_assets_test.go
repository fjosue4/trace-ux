package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// A stylesheet big enough to clear the dedupe threshold (16 KB).
func bigCSS(marker string) string {
	var b strings.Builder
	b.WriteString("/* " + marker + " */")
	for i := 0; b.Len() < 20<<10; i++ {
		fmt.Fprintf(&b, ".c%d{color:#%06x;margin:%dpx}", i, i*7919%0xffffff, i%50)
	}
	return b.String()
}

// seedCSSSession stores one session whose snapshot inlines a large stylesheet,
// which the ingest path replaces with a reference.
func seedCSSSession(t *testing.T, srv *Server, sid, css string) {
	t.Helper()
	if _, err := srv.store.CreateSite("S", "https://example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.store.DB.Exec(
		`INSERT INTO sessions (id,site_id,started_at,last_seen) VALUES (?,1,1,1)`, sid); err != nil {
		t.Fatal(err)
	}
	snap, _ := json.Marshal([]any{map[string]any{
		"type": 2, "timestamp": 1,
		"data": map[string]any{"node": map[string]any{"_cssText": css}},
	}})
	var raw []json.RawMessage
	if err := json.Unmarshal(snap, &raw); err != nil {
		t.Fatal(err)
	}
	deduped, err := srv.store.DedupeCSS(sid, raw)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(deduped)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write(body)
	zw.Close()
	if _, err := srv.store.DB.Exec(
		`INSERT INTO chunks (session_id,seq,events,data,created_at) VALUES (?,0,1,?,1)`,
		sid, buf.Bytes()); err != nil {
		t.Fatal(err)
	}
}

// writeChunk stores a raw (already-JSON) chunk under the given sequence.
func writeChunk(t *testing.T, srv *Server, sid string, seq int, body []byte) {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write(body)
	zw.Close()
	if _, err := srv.store.DB.Exec(
		`INSERT INTO chunks (session_id,seq,events,data,created_at) VALUES (?,?,1,?,1)`,
		sid, seq, buf.Bytes()); err != nil {
		t.Fatal(err)
	}
}

func getEvents(t *testing.T, tsURL, sid, query string) (string, *http.Response) {
	t.Helper()
	resp := authed(t, tsURL, http.MethodGet, "/api/sessions/"+sid+"/events?after_seq=-1"+query, "")
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return string(b), resp
}

// The whole point of the split: css=ref must NOT expand the stylesheet, and the
// default must still expand it so an older dashboard keeps working.
func TestEventsCSSRefVersusExpanded(t *testing.T) {
	srv, ts := newTestServer(t)
	css := bigCSS("ref-vs-expanded")
	sid := "sess-css"
	seedCSSSession(t, srv, sid, css)

	refBody, _ := getEvents(t, ts.URL, sid, "&css=ref")
	if !strings.Contains(refBody, "@traceux-css-ref:") {
		t.Error("css=ref should return an unexpanded reference")
	}
	if strings.Contains(refBody, "ref-vs-expanded") {
		t.Error("css=ref expanded the stylesheet anyway")
	}

	fullBody, _ := getEvents(t, ts.URL, sid, "")
	if !strings.Contains(fullBody, "ref-vs-expanded") {
		t.Error("the default must still expand, or older clients break")
	}

	if len(refBody) >= len(fullBody) {
		t.Errorf("css=ref (%d B) should be smaller than expanded (%d B)", len(refBody), len(fullBody))
	}
	t.Logf("expanded %d B -> css=ref %d B (%.0f%% smaller)",
		len(fullBody), len(refBody), 100*(1-float64(len(refBody))/float64(len(fullBody))))
}

// The asset endpoint must return the exact bytes that were stored, so a
// round-trip through reference + fetch reproduces the original stylesheet.
func TestCSSAssetRoundTrip(t *testing.T) {
	srv, ts := newTestServer(t)
	css := bigCSS("round-trip")
	sid := "sess-rt"
	seedCSSSession(t, srv, sid, css)

	refBody, _ := getEvents(t, ts.URL, sid, "&css=ref")
	i := strings.Index(refBody, "@traceux-css-ref:")
	if i < 0 {
		t.Fatal("no reference in response")
	}
	hash := refBody[i+len("@traceux-css-ref:") : i+len("@traceux-css-ref:")+64]

	resp := authed(t, ts.URL, http.MethodGet, "/api/css-assets/"+hash, "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d, want 200", resp.StatusCode)
	}
	if got := resp.Header.Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("Cache-Control = %q; a content-addressed asset must be immutable or the caching win is lost", got)
	}
	// Go's client transparently decompresses only when it set Accept-Encoding
	// itself; here the body arrives gzipped because we declare the encoding.
	var reader io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		zr, err := gzip.NewReader(resp.Body)
		if err != nil {
			t.Fatalf("gzip: %v", err)
		}
		reader = zr
	}
	got, _ := io.ReadAll(reader)
	if string(got) != css {
		t.Errorf("round-trip mismatch: got %d bytes, want %d", len(got), len(css))
	}
}

func TestCSSAssetETagAndErrors(t *testing.T) {
	srv, ts := newTestServer(t)
	css := bigCSS("etag")
	sid := "sess-etag"
	seedCSSSession(t, srv, sid, css)
	refBody, _ := getEvents(t, ts.URL, sid, "&css=ref")
	i := strings.Index(refBody, "@traceux-css-ref:")
	hash := refBody[i+17 : i+17+64]

	// Conditional request: the second fetch of a stylesheet costs nothing.
	login, _ := http.Post(ts.URL+"/api/auth/login", "application/json", strings.NewReader(`{"password":"pw"}`))
	login.Body.Close()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/css-assets/"+hash, nil)
	for _, c := range login.Cookies() {
		req.AddCookie(c)
	}
	req.Header.Set("If-None-Match", `"`+hash+`"`)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotModified {
		t.Errorf("If-None-Match: got %d, want 304", resp.StatusCode)
	}

	for _, tc := range []struct {
		label, hash string
		want        int
	}{
		{"unknown hash", strings.Repeat("a", 64), http.StatusNotFound},
		{"too short", "abc123", http.StatusBadRequest},
		{"non-hex", strings.Repeat("z", 64), http.StatusBadRequest},
	} {
		r := authed(t, ts.URL, http.MethodGet, "/api/css-assets/"+tc.hash, "")
		r.Body.Close()
		if r.StatusCode != tc.want {
			t.Errorf("%s: got %d, want %d", tc.label, r.StatusCode, tc.want)
		}
	}
}
