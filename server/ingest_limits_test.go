package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"trace-ux/server/store"
)

func TestIngestPerMinuteParsing(t *testing.T) {
	for _, tc := range []struct {
		name, ip, site   string
		wantIP, wantSite int
	}{
		{"unset keeps today's limits", "", "", 120, 2_000},
		{"both set", "600", "10000", 600, 10_000},
		{"spaces are trimmed", " 300 ", "", 300, 2_000},
		{"zero keeps the default", "0", "0", 120, 2_000},
		{"negative keeps the default", "-5", "", 120, 2_000},
		{"a unit suffix keeps the default", "600/min", "", 120, 2_000},
		{"over the ceiling keeps the default", "2000000", "", 120, 2_000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TRACE_UX_PASSWORD", "x")
			t.Setenv("TRACE_UX_INGEST_IP_PER_MINUTE", tc.ip)
			t.Setenv("TRACE_UX_INGEST_SITE_PER_MINUTE", tc.site)
			cfg := loadConfig()
			if cfg.IngestIPPerMinute != tc.wantIP || cfg.IngestSitePerMinute != tc.wantSite {
				t.Fatalf("ip=%q site=%q -> %d/%d, want %d/%d",
					tc.ip, tc.site, cfg.IngestIPPerMinute, cfg.IngestSitePerMinute, tc.wantIP, tc.wantSite)
			}
		})
	}
}

func TestIngestLimitersUseTheConfiguredLimits(t *testing.T) {
	srv := &Server{cfg: &Config{IngestIPPerMinute: 600, IngestSitePerMinute: 9_000}}
	srv.initSecurity()
	if srv.ingestIPLimiter.limit != 600 || srv.ingestSiteLimiter.limit != 9_000 {
		t.Fatalf("limiters = %d/%d, want 600/9000", srv.ingestIPLimiter.limit, srv.ingestSiteLimiter.limit)
	}

	for _, cfg := range []*Config{nil, {}} {
		srv := &Server{cfg: cfg}
		srv.initSecurity()
		if srv.ingestIPLimiter.limit != defaultIngestIPPerMinute || srv.ingestSiteLimiter.limit != defaultIngestSitePerMinute {
			t.Fatalf("cfg %+v: limiters = %d/%d, want the defaults", cfg, srv.ingestIPLimiter.limit, srv.ingestSiteLimiter.limit)
		}
	}
}

// The 2026-11-05 case: one backend posting its logs from one address runs out
// of the per-address budget and gets 429; a configured budget is what applies.
func TestServiceLogIngestStopsAtTheConfiguredPerAddressLimit(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.cfg.IngestIPPerMinute = 3
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"ai","url":"https://ai.example"}`)
	var site store.Site
	if err := json.NewDecoder(resp.Body).Decode(&site); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	resp = doReq(t, http.MethodPost, fmt.Sprintf("%s/api/sites/%d/services", ts.URL, site.ID), admin, `{"name":"ai-service"}`)
	var created struct {
		APIKey string `json:"api_key"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	body := `{"logs":[{"severity":"info","message":"chartickets call","environment":"production"}]}`
	for attempt := 1; attempt <= 4; attempt++ {
		resp := serviceKeyRequest(t, ts.URL+"/api/logs/ingest", created.APIKey, "X-TraceUX-Service-Key", body)
		resp.Body.Close()
		want := http.StatusOK
		if attempt == 4 {
			want = http.StatusTooManyRequests
		}
		if resp.StatusCode != want {
			t.Fatalf("request %d: got %d, want %d", attempt, resp.StatusCode, want)
		}
	}
}
