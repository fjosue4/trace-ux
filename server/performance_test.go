package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"trace-ux/server/store"
)

func postPerformance(t *testing.T, url, key string, payload performanceIngestRequest) *http.Response {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-TraceUX-Performance-Key", key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// seedLegacyPerformanceKey stores a site-level key the way older releases did,
// so compatibility paths stay covered now that sites no longer start with one.
func seedLegacyPerformanceKey(t *testing.T, srv *Server, siteID int64) string {
	t.Helper()
	_, key, err := srv.store.CreatePerformanceKey(siteID)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestPerformanceIngestAndReport(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Performance", "https://performance.example")
	if err != nil {
		t.Fatal(err)
	}
	legacyKey := seedLegacyPerformanceKey(t, srv, site.ID)

	now := time.Now().UnixMilli()
	resp := postPerformance(t, fmt.Sprintf("%s/api/performance/ingest/%s", ts.URL, site.SiteKey), legacyKey, performanceIngestRequest{
		Observations: []store.PerformanceObservation{
			{Environment: "production", Service: "api", Version: "1.4.0", Endpoint: "GET /orders", DurationMs: 15, TimestampMs: now},
			{Environment: "production", Service: "api", Version: "1.4.0", Endpoint: "GET /orders", DurationMs: 45, TimestampMs: now},
			{Environment: "production", Service: "api", Version: "1.4.0", Endpoint: "GET /orders", DurationMs: 120, StatusCode: 500, TimestampMs: now},
			{Environment: "staging", Service: "worker", Version: "1.5.0", Endpoint: "POST /jobs", DurationMs: 600, TimestampMs: now},
		},
	})
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("performance ingest: got %d", resp.StatusCode)
	}
	resp.Body.Close()

	if bad := postPerformance(t, fmt.Sprintf("%s/api/performance/ingest/%s", ts.URL, site.SiteKey), "wrong-key", performanceIngestRequest{}); bad.StatusCode != http.StatusUnauthorized {
		bad.Body.Close()
		t.Fatalf("bad performance key: got %d, want 401", bad.StatusCode)
	} else {
		bad.Body.Close()
	}

	report, err := srv.store.GetPerformance(store.PerformanceFilter{SiteID: site.ID})
	if err != nil {
		t.Fatal(err)
	}
	if report.Summary.Requests != 4 || report.Summary.Errors != 1 {
		t.Fatalf("summary = %+v, want 4 requests and 1 error", report.Summary)
	}
	if report.Summary.P50Ms <= 0 || report.Summary.P95Ms < report.Summary.P50Ms || report.Summary.P99Ms < report.Summary.P95Ms {
		t.Fatalf("percentiles = %+v, want ordered non-zero values", report.Summary)
	}
	if len(report.Endpoints) != 2 {
		t.Fatalf("endpoints = %d, want 2", len(report.Endpoints))
	}
	if len(report.Filters.Environments) != 2 || len(report.Filters.Services) != 2 || len(report.Filters.Versions) != 2 {
		t.Fatalf("filter options = %+v, want two values for each dimension", report.Filters)
	}

	filtered, err := srv.store.GetPerformance(store.PerformanceFilter{SiteID: site.ID, Environment: "production", Service: "api", Version: "1.4.0"})
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Summary.Requests != 3 || len(filtered.Endpoints) != 1 || filtered.Endpoints[0].Endpoint != "GET /orders" {
		t.Fatalf("filtered report = %+v, want only production API orders", filtered)
	}

	admin := login(t, ts.URL, "admin", "pw")
	resp = doReq(t, http.MethodGet, ts.URL+"/api/performance?site_id="+fmt.Sprint(site.ID)+"&service=api", admin, "")
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("performance API: got %d", resp.StatusCode)
	}
	var apiReport store.PerformanceReport
	if err := json.NewDecoder(resp.Body).Decode(&apiReport); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if apiReport.Summary.Requests != 3 || len(apiReport.Endpoints) != 1 {
		t.Fatalf("API report = %+v, want service filter applied", apiReport)
	}
}

func TestPerformanceKeyRotationRevokesPreviousKey(t *testing.T) {
	srv, _ := newTestServer(t)
	site, err := srv.store.CreateSite("Keys", "https://keys.example")
	if err != nil {
		t.Fatal(err)
	}
	oldKey := seedLegacyPerformanceKey(t, srv, site.ID)
	newKeyValue, err := srv.store.RotatePerformanceKey(site.ID)
	if err != nil {
		t.Fatal(err)
	}
	if newKeyValue == oldKey {
		t.Fatal("rotating performance key returned the old key")
	}
	if ok, err := srv.store.ValidatePerformanceKey(site.ID, oldKey); err != nil || ok {
		t.Fatalf("old key validation = %t, %v; want false", ok, err)
	}
	if ok, err := srv.store.ValidatePerformanceKey(site.ID, newKeyValue); err != nil || !ok {
		t.Fatalf("new key validation = %t, %v; want true", ok, err)
	}
}

func TestPerformanceKeyManagement(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Key management", "https://keys.example")
	if err != nil {
		t.Fatal(err)
	}
	if keys, err := srv.store.ListPerformanceKeys(site.ID); err != nil || len(keys) != 0 {
		t.Fatalf("new site keys = %+v, %v; want none", keys, err)
	}
	first := seedLegacyPerformanceKey(t, srv, site.ID)
	second := seedLegacyPerformanceKey(t, srv, site.ID)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodGet, fmt.Sprintf("%s/api/sites/%d/performance-keys", ts.URL, site.ID), admin, "")
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("list performance keys: got %d", resp.StatusCode)
	}
	var keys []store.PerformanceKeyInfo
	if err := json.NewDecoder(resp.Body).Decode(&keys); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(keys) != 2 || keys[0].KeyHint != store.PerformanceKeyHint(second[:4], second[len(second)-4:]) {
		t.Fatalf("listed keys = %+v, want two masked keys, newest first", keys)
	}

	resp = doReq(t, http.MethodPost, fmt.Sprintf("%s/api/sites/%d/performance-keys", ts.URL, site.ID), admin, "")
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Fatal("create performance key: got 200, want legacy key creation removed")
	}
	if keys, err := srv.store.ListPerformanceKeys(site.ID); err != nil || len(keys) != 2 {
		t.Fatalf("keys after create attempt = %d, %v; want 2", len(keys), err)
	}

	resp = doReq(t, http.MethodDelete, fmt.Sprintf("%s/api/sites/%d/performance-keys/%d", ts.URL, site.ID, keys[0].ID), admin, "")
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("delete performance key: got %d", resp.StatusCode)
	}
	resp.Body.Close()
	if ok, err := srv.store.ValidatePerformanceKey(site.ID, second); err != nil || ok {
		t.Fatalf("removed key validation = %t, %v; want false", ok, err)
	}
	if ok, err := srv.store.ValidatePerformanceKey(site.ID, first); err != nil || !ok {
		t.Fatalf("remaining key validation = %t, %v; want true", ok, err)
	}
}
