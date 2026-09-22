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

func serviceLogRequest(t *testing.T, url, key, body string) *http.Response {
	return serviceKeyRequest(t, url, key, "X-TraceUX-Log-Key", body)
}

func serviceKeyRequest(t *testing.T, url, key, header, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(header, key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestServiceLogsInheritOverrideExtraAndRevoke(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin,
		`{"name":"Unified logs","url":"https://unified.example"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create site: got %d", resp.StatusCode)
	}
	var site store.Site
	if err := json.NewDecoder(resp.Body).Decode(&site); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	serviceURL := fmt.Sprintf("%s/api/sites/%d/services", ts.URL, site.ID)
	resp = doReq(t, http.MethodPost, serviceURL, admin, `{"name":"billing-api"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create service: got %d", resp.StatusCode)
	}
	var created struct {
		Service store.Service `json:"service"`
		APIKey  string        `json:"api_key"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if created.APIKey == "" || !created.Service.InheritSeverities {
		t.Fatalf("created service = %+v, key present=%t", created.Service, created.APIKey != "")
	}
	if !strings.HasPrefix(created.APIKey, "tux_svc_") {
		t.Fatalf("service key prefix = %q, want tux_svc_", created.APIKey)
	}

	performanceURL := ts.URL + "/api/performance/ingest"
	resp = serviceKeyRequest(t, performanceURL, created.APIKey, "X-TraceUX-Service-Key", fmt.Sprintf(`{"observations":[
		{"environment":"production","service":"spoofed-name","version":"1.0.0","endpoint":"POST /charges","duration_ms":42,"status_code":200,"timestamp_ms":%d}
	]}`, time.Now().UnixMilli()))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("service performance ingest: got %d", resp.StatusCode)
	}
	resp.Body.Close()
	performance, err := srv.store.GetPerformance(store.PerformanceFilter{SiteID: site.ID})
	if err != nil {
		t.Fatal(err)
	}
	if performance.Summary.Requests != 1 || len(performance.Endpoints) != 1 || performance.Endpoints[0].Service != "billing-api" {
		t.Fatalf("service performance = %+v, want service identity from key", performance)
	}

	ingestURL := ts.URL + "/api/logs/ingest"
	resp = serviceLogRequest(t, ingestURL, created.APIKey, `{"logs":[
		{"severity":"info","message":"inherited skip","environment":"staging"},
		{"severity":"error","message":"charge failed","environment":"production","extra":{"request_id":"req-extra-42","attempt":2}}
	]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("ingest inherited: got %d", resp.StatusCode)
	}
	var counts map[string]int
	if err := json.NewDecoder(resp.Body).Decode(&counts); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if counts["accepted"] != 1 || counts["skipped"] != 1 {
		t.Fatalf("ingest counts = %+v", counts)
	}

	serviceItemURL := fmt.Sprintf("%s/%d", serviceURL, created.Service.ID)
	resp = doReq(t, http.MethodPatch, serviceItemURL, admin,
		`{"name":"billing-api","inherit_severities":false,"severities":["info","error"]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("override service: got %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = serviceKeyRequest(t, ingestURL, created.APIKey, "X-TraceUX-Service-Key",
		`{"logs":[{"severity":"info","message":"charge queued","environment":"staging","extra":{"queue":"payments"}}]}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("ingest override: got %d", resp.StatusCode)
	}
	resp.Body.Close()

	searchURL := fmt.Sprintf("%s/api/logs?site_id=%d&service_id=%d&environment=production&search=req-extra-42&search_in=extra", ts.URL, site.ID, created.Service.ID)
	resp = doReq(t, http.MethodGet, searchURL, admin, "")
	var logs []store.Log
	if err := json.NewDecoder(resp.Body).Decode(&logs); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(logs) != 1 || logs[0].ServiceName != "billing-api" || logs[0].SessionID != "" || !strings.Contains(logs[0].Extra, "req-extra-42") {
		t.Fatalf("service logs = %+v", logs)
	}

	resp = doReq(t, http.MethodDelete, serviceItemURL+"/key", admin, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("revoke key: got %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = serviceLogRequest(t, ingestURL, created.APIKey,
		`{"logs":[{"severity":"error","message":"must be rejected"}]}`)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked ingest: got %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = serviceKeyRequest(t, performanceURL, created.APIKey, "X-TraceUX-Service-Key", `{"observations":[]}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked performance ingest: got %d", resp.StatusCode)
	}
}
