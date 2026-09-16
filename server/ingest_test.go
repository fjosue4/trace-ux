package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"trace-ux/server/store"
)

func TestCountryFromRequestUsesTrustedProxyHeaders(t *testing.T) {
	_, network, err := net.ParseCIDR("127.0.0.0/8")
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{cfg: &Config{TrustedProxyCIDRs: []*net.IPNet{network}}}

	req := httptest.NewRequest("POST", "http://trace-ux.test/api/ingest/site", nil)
	req.RemoteAddr = "127.0.0.1:8090"
	req.Header.Set("CF-IPCountry", "us")
	if got := srv.countryFromRequest(req); got != "US" {
		t.Fatalf("countryFromRequest() = %q, want US", got)
	}

	req.Header.Del("CF-IPCountry")
	req.Header.Set("X-Country-Code", "ca")
	if got := srv.countryFromRequest(req); got != "CA" {
		t.Fatalf("fallback countryFromRequest() = %q, want CA", got)
	}
}

func TestCountryFromRequestIgnoresUntrustedOrUnknownHeaders(t *testing.T) {
	_, network, err := net.ParseCIDR("127.0.0.0/8")
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{cfg: &Config{TrustedProxyCIDRs: []*net.IPNet{network}}}

	req := httptest.NewRequest("POST", "http://trace-ux.test/api/ingest/site", nil)
	req.RemoteAddr = "203.0.113.5:8090"
	req.Header.Set("CF-IPCountry", "US")
	if got := srv.countryFromRequest(req); got != "" {
		t.Fatalf("untrusted country header = %q, want empty", got)
	}

	req.RemoteAddr = "127.0.0.1:8090"
	req.Header.Set("CF-IPCountry", "XX")
	if got := srv.countryFromRequest(req); got != "" {
		t.Fatalf("unknown country header = %q, want empty", got)
	}
}

func TestListSessionsFiltersCountry(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"Country test","url":"https://country.test"}`)
	var site store.Site
	if err := json.NewDecoder(resp.Body).Decode(&site); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	if err := srv.store.SaveHelloWithCountry(site.ID, "country-us", "UA", "hash-us", "US", &store.IngestHello{URL: "https://country.test/"}); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.SaveHelloWithCountry(site.ID, "country-gb", "UA", "hash-gb", "GB", &store.IngestHello{URL: "https://country.test/"}); err != nil {
		t.Fatal(err)
	}

	resp = doReq(t, http.MethodGet, ts.URL+"/api/sessions?site_id="+strconv.FormatInt(site.ID, 10)+"&country=us", admin, "")
	var sessions []store.Session
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(sessions) != 1 || sessions[0].Country != "US" {
		t.Fatalf("country filter returned %+v, want one US session", sessions)
	}

	resp = doReq(t, http.MethodGet, ts.URL+"/api/sessions/countries?site_id="+strconv.FormatInt(site.ID, 10), admin, "")
	var countries []string
	if err := json.NewDecoder(resp.Body).Decode(&countries); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(countries) != 2 || countries[0] != "GB" || countries[1] != "US" {
		t.Fatalf("country options = %v, want [GB US]", countries)
	}
}

// A FullSnapshot is the entire serialized DOM and is the largest event any
// session produces. When the per-event cap was 512 KB it sat below what a real
// single-page app emits, so the snapshot was rejected while the small
// incremental mutations that followed were accepted -- leaving the player a
// stream of diffs with no document to apply them to. The session looked
// recorded and replayed as a blank screen.
func TestEventCapClearsARealisticFullSnapshot(t *testing.T) {
	// A conservative stand-in for a complex app's DOM snapshot. The point is
	// the order of magnitude: megabytes, not kilobytes.
	const realisticSnapshot = 2 << 20 // 2 MB

	if maxEventBytes < realisticSnapshot {
		t.Fatalf("maxEventBytes = %d, too small for a %d-byte FullSnapshot; "+
			"replay will render blank for real apps", maxEventBytes, realisticSnapshot)
	}
	// ...and still bounded by the whole-request limit, so raising it cannot be
	// used to push an unbounded body through.
	if maxEventBytes >= store.IngestBodyLimit {
		t.Fatalf("maxEventBytes = %d must stay below IngestBodyLimit = %d",
			maxEventBytes, store.IngestBodyLimit)
	}
}
