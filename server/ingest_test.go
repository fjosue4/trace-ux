package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
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
	var site Site
	if err := json.NewDecoder(resp.Body).Decode(&site); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	if err := srv.store.SaveHelloWithCountry(site.ID, "country-us", "UA", "hash-us", "US", &ingestHello{URL: "https://country.test/"}); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.SaveHelloWithCountry(site.ID, "country-gb", "UA", "hash-gb", "GB", &ingestHello{URL: "https://country.test/"}); err != nil {
		t.Fatal(err)
	}

	resp = doReq(t, http.MethodGet, ts.URL+"/api/sessions?site_id="+strconv.FormatInt(site.ID, 10)+"&country=us", admin, "")
	var sessions []Session
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
