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

// Both knobs default to exactly what was hardcoded before, so an existing
// install that sets neither behaves identically after upgrading.
func TestTunableDefaultsAreUnchanged(t *testing.T) {
	t.Setenv("TRACE_UX_PASSWORD", "x")
	cfg := loadConfig()
	if cfg.MaxEventBytes != 4<<20 {
		t.Fatalf("MaxEventBytes = %d, want 4 MB", cfg.MaxEventBytes)
	}
	if cfg.CheckoutIntervalMS != 30_000 {
		t.Fatalf("CheckoutIntervalMS = %d, want 30000", cfg.CheckoutIntervalMS)
	}
}

func TestMaxEventMBParsing(t *testing.T) {
	for _, tc := range []struct {
		val  string
		want int
	}{
		{"8", 8 << 20},
		{"16", 16 << 20},
		{"999", maxMaxEventMB << 20}, // clamped, not accepted blindly
		{"0", 4 << 20},               // invalid -> default
		{"-2", 4 << 20},
		{"4MB", 4 << 20}, // a unit suffix must not silently disable the cap
		{"", 4 << 20},
	} {
		t.Run(tc.val, func(t *testing.T) {
			t.Setenv("TRACE_UX_PASSWORD", "x")
			t.Setenv("TRACE_UX_MAX_EVENT_MB", tc.val)
			if got := loadConfig().MaxEventBytes; got != tc.want {
				t.Fatalf("TRACE_UX_MAX_EVENT_MB=%q -> %d, want %d", tc.val, got, tc.want)
			}
		})
	}
}

func TestCheckoutIntervalParsing(t *testing.T) {
	for _, tc := range []struct {
		val  string
		want int
	}{
		{"300000", 300_000},
		{"120000", 120_000},
		{"1000", 30_000},     // below the floor -> default
		{"99999999", 30_000}, // above the ceiling -> default
		{"soon", 30_000},
	} {
		t.Run(tc.val, func(t *testing.T) {
			t.Setenv("TRACE_UX_PASSWORD", "x")
			t.Setenv("TRACE_UX_CHECKOUT_INTERVAL_MS", tc.val)
			if got := loadConfig().CheckoutIntervalMS; got != tc.want {
				t.Fatalf("TRACE_UX_CHECKOUT_INTERVAL_MS=%q -> %d, want %d", tc.val, got, tc.want)
			}
		})
	}
}

// A batch is a FullSnapshot plus whatever incrementals were buffered with it,
// so the request ceiling must clear the per-event cap. If it did not, raising
// TRACE_UX_MAX_EVENT_MB would still reject batches whose events were each
// individually legal -- the original blank-replay bug, one layer down.
func TestBodyLimitStaysAboveTheEventCap(t *testing.T) {
	for _, mb := range []int{4, 8, 16, 64} {
		store.SetIngestBodyLimit(mb<<20 + (8 << 20))
		if store.IngestBodyLimit <= mb<<20 {
			t.Fatalf("event cap %d MB but body limit %d", mb, store.IngestBodyLimit)
		}
	}
}

// A Config built without loadConfig leaves these at zero. Unguarded, a zero
// event cap rejects every event and a zero checkout interval is handed to rrweb
// as "never re-snapshot" -- both of which surface as a replay that scrubs and
// renders nothing, which is the failure this whole area already produced once.
func TestZeroValuedConfigFallsBackToDefaults(t *testing.T) {
	for name, srv := range map[string]*Server{
		"empty cfg": {cfg: &Config{}},
		"nil cfg":   {},
	} {
		t.Run(name, func(t *testing.T) {
			if got := srv.maxEventBytes(); got != defaultMaxEventMB<<20 {
				t.Errorf("maxEventBytes() = %d, want the %d MB default", got, defaultMaxEventMB)
			}
			if got := srv.checkoutIntervalMS(); got != defaultCheckoutIntervalMS {
				t.Errorf("checkoutIntervalMS() = %d, want %d", got, defaultCheckoutIntervalMS)
			}
		})
	}
}
