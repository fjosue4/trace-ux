package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
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

func TestPerformanceIngestAndReport(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Performance", "https://performance.example")
	if err != nil {
		t.Fatal(err)
	}
	if site.PerformanceKey == "" {
		t.Fatal("site creation did not return a performance key")
	}

	now := time.Now().UnixMilli()
	resp := postPerformance(t, fmt.Sprintf("%s/api/performance/ingest/%s", ts.URL, site.SiteKey), site.PerformanceKey, performanceIngestRequest{
		Observations: []PerformanceObservation{
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

	report, err := srv.store.GetPerformance(PerformanceFilter{SiteID: site.ID})
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

	filtered, err := srv.store.GetPerformance(PerformanceFilter{SiteID: site.ID, Environment: "production", Service: "api", Version: "1.4.0"})
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
	var apiReport PerformanceReport
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
	oldKey := site.PerformanceKey
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
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodGet, fmt.Sprintf("%s/api/sites/%d/performance-keys", ts.URL, site.ID), admin, "")
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("list performance keys: got %d", resp.StatusCode)
	}
	var keys []PerformanceKeyInfo
	if err := json.NewDecoder(resp.Body).Decode(&keys); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(keys) != 1 || keys[0].KeyHint != performanceKeyHint(site.PerformanceKey[:4], site.PerformanceKey[len(site.PerformanceKey)-4:]) {
		t.Fatalf("initial keys = %+v, want one masked key", keys)
	}

	resp = doReq(t, http.MethodPost, fmt.Sprintf("%s/api/sites/%d/performance-keys", ts.URL, site.ID), admin, "")
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("create performance key: got %d", resp.StatusCode)
	}
	var created struct {
		ID   int64  `json:"key_id"`
		Hint string `json:"key_hint"`
		Key  string `json:"performance_key"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if created.ID == 0 || created.Key == "" || created.Hint != performanceKeyHint(created.Key[:4], created.Key[len(created.Key)-4:]) {
		t.Fatalf("created key response = %+v, want raw key and masked hint", created)
	}

	keys, err = srv.store.ListPerformanceKeys(site.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 2 {
		t.Fatalf("keys after create = %d, want 2", len(keys))
	}
	if ok, err := srv.store.ValidatePerformanceKey(site.ID, site.PerformanceKey); err != nil || !ok {
		t.Fatalf("original key validation = %t, %v; want true", ok, err)
	}

	resp = doReq(t, http.MethodDelete, fmt.Sprintf("%s/api/sites/%d/performance-keys/%d", ts.URL, site.ID, keys[1].ID), admin, "")
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("delete performance key: got %d", resp.StatusCode)
	}
	resp.Body.Close()
	remaining, err := srv.store.ListPerformanceKeys(site.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 1 {
		t.Fatalf("keys after delete = %d, want 1", len(remaining))
	}
}
