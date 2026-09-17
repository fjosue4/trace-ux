package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"trace-ux/server/store"
)

func TestLogsAreFilteredAndLinkedToSessions(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin,
		`{"name":"Logs","url":"https://logs.example"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create site: got %d", resp.StatusCode)
	}
	var site store.Site
	if err := json.NewDecoder(resp.Body).Decode(&site); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()

	settingsURL := fmt.Sprintf("%s/api/sites/%d/settings", ts.URL, site.ID)
	resp = doReq(t, http.MethodPut, settingsURL, admin,
		`{"logs":{"enabled":true,"minimum_severity":"warn"}}`)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("enable logs: got %d", resp.StatusCode)
	}
	resp.Body.Close()

	ingestURL := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)
	if r := postJSON(t, ingestURL, `{"type":"hello","session_id":"log-session","url":"https://logs.example/"}`, false); r.StatusCode != http.StatusOK {
		t.Fatalf("hello: got %d", r.StatusCode)
	}
	logs := `{"type":"logs","session_id":"log-session","logs":[
		{"client_seq":1,"timestamp_ms":1000,"severity":"debug","message":"debug","url":"https://logs.example/"},
		{"client_seq":2,"timestamp_ms":2000,"severity":"info","message":"info","url":"https://logs.example/"},
		{"client_seq":3,"timestamp_ms":3000,"severity":"warn","message":"warning","url":"https://logs.example/checkout"},
		{"client_seq":4,"timestamp_ms":4000,"severity":"error","message":"failure","url":"https://logs.example/checkout"}
	]}`
	if r := postJSON(t, ingestURL, logs, false); r.StatusCode != http.StatusOK {
		t.Fatalf("logs: got %d", r.StatusCode)
	}
	// A retried batch must not duplicate rows.
	if r := postJSON(t, ingestURL, logs, false); r.StatusCode != http.StatusOK {
		t.Fatalf("duplicate logs: got %d", r.StatusCode)
	}

	rows, err := srv.store.ListLogs(store.LogFilter{SiteID: site.ID, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].Severity != store.LogSeverityError || rows[1].Severity != store.LogSeverityWarn {
		t.Fatalf("stored logs = %+v, want error and warn only", rows)
	}
	if rows[0].SessionID != "log-session" || rows[0].SiteName != "Logs" {
		t.Fatalf("recording relation missing: %+v", rows[0])
	}

	stats, err := srv.store.LogStats(store.LogFilter{SiteID: site.ID})
	if err != nil {
		t.Fatal(err)
	}
	if stats.Total != 2 || stats.Warn != 1 || stats.Error != 1 || stats.Info != 0 || stats.Debug != 0 {
		t.Fatalf("stats = %+v, want 2 total with warn/error", stats)
	}
	rows, err = srv.store.ListLogs(store.LogFilter{SiteID: site.ID, FromMs: 3500, ToMs: 4500, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Severity != store.LogSeverityError {
		t.Fatalf("time-filtered logs = %+v, want only the error", rows)
	}

	resp = doReq(t, http.MethodGet, fmt.Sprintf("%s/api/logs?site_id=%d&severity=error&from_ms=3500&to_ms=4500", ts.URL, site.ID), admin, "")
	var filtered []store.Log
	if err := json.NewDecoder(resp.Body).Decode(&filtered); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || len(filtered) != 1 || filtered[0].Severity != store.LogSeverityError {
		t.Fatalf("filtered API response = %+v, status %d", filtered, resp.StatusCode)
	}

	if err := srv.store.DeleteSession("log-session"); err != nil {
		t.Fatal(err)
	}
	rows, err = srv.store.ListLogs(store.LogFilter{SiteID: site.ID, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("logs survived recording deletion: %+v", rows)
	}
}

func TestLogsCanFilterMultipleSeverities(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin,
		`{"name":"Multi severity","url":"https://multi-severity.example"}`)
	if resp.StatusCode != http.StatusCreated {
		resp.Body.Close()
		t.Fatalf("create site: got %d", resp.StatusCode)
	}
	var site store.Site
	if err := json.NewDecoder(resp.Body).Decode(&site); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()

	settingsURL := fmt.Sprintf("%s/api/sites/%d/settings", ts.URL, site.ID)
	resp = doReq(t, http.MethodPut, settingsURL, admin,
		`{"logs":{"enabled":true,"minimum_severity":"debug"}}`)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("enable logs: got %d", resp.StatusCode)
	}
	resp.Body.Close()

	ingestURL := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)
	if r := postJSON(t, ingestURL, `{"type":"hello","session_id":"multi-severity-session","url":"https://multi-severity.example/"}`, false); r.StatusCode != http.StatusOK {
		t.Fatalf("hello: got %d", r.StatusCode)
	}
	if r := postJSON(t, ingestURL, `{"type":"logs","session_id":"multi-severity-session","logs":[
		{"client_seq":1,"timestamp_ms":1000,"severity":"info","message":"info","url":"https://multi-severity.example/"},
		{"client_seq":2,"timestamp_ms":2000,"severity":"warn","message":"warning","url":"https://multi-severity.example/"},
		{"client_seq":3,"timestamp_ms":3000,"severity":"error","message":"error","url":"https://multi-severity.example/"}
	]}`, false); r.StatusCode != http.StatusOK {
		t.Fatalf("logs: got %d", r.StatusCode)
	}

	resp = doReq(t, http.MethodGet,
		fmt.Sprintf("%s/api/logs?site_id=%d&severity=info,error&limit=10", ts.URL, site.ID), admin, "")
	defer resp.Body.Close()
	var filtered []store.Log
	if err := json.NewDecoder(resp.Body).Decode(&filtered); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK || len(filtered) != 2 {
		t.Fatalf("multi-severity response = %+v, status %d", filtered, resp.StatusCode)
	}
	if filtered[0].Severity != store.LogSeverityError || filtered[1].Severity != store.LogSeverityInfo {
		t.Fatalf("multi-severity response = %+v, want error and info", filtered)
	}
}

func TestLogRetentionAppliesAgeAndRowCaps(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin,
		`{"name":"Retention","url":"https://retention.example"}`)
	var site store.Site
	if err := json.NewDecoder(resp.Body).Decode(&site); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()

	settingsURL := fmt.Sprintf("%s/api/sites/%d/settings", ts.URL, site.ID)
	resp = doReq(t, http.MethodPut, settingsURL, admin,
		`{"logs":{"enabled":true,"minimum_severity":"debug","retention_days":15,"max_rows":2}}`)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("configure retention: got %d", resp.StatusCode)
	}
	resp.Body.Close()

	ingestURL := fmt.Sprintf("%s/api/ingest/%s", ts.URL, site.SiteKey)
	if r := postJSON(t, ingestURL, `{"type":"hello","session_id":"retention-session","url":"https://retention.example/"}`, false); r.StatusCode != http.StatusOK {
		t.Fatalf("hello: got %d", r.StatusCode)
	}
	if r := postJSON(t, ingestURL, `{"type":"logs","session_id":"retention-session","logs":[
		{"client_seq":1,"timestamp_ms":1000,"severity":"info","message":"old","url":"https://retention.example/"},
		{"client_seq":2,"timestamp_ms":2000,"severity":"info","message":"two","url":"https://retention.example/"},
		{"client_seq":3,"timestamp_ms":3000,"severity":"warn","message":"three","url":"https://retention.example/"},
		{"client_seq":4,"timestamp_ms":4000,"severity":"error","message":"four","url":"https://retention.example/"}
	]}`, false); r.StatusCode != http.StatusOK {
		t.Fatalf("logs: got %d", r.StatusCode)
	}

	old := time.Now().Add(-16 * 24 * time.Hour).Unix()
	if _, err := srv.store.DB.Exec(`UPDATE logs SET created_at = ? WHERE session_id = ? AND client_seq = 1`, old, "retention-session"); err != nil {
		t.Fatal(err)
	}
	removed, err := srv.store.RetentionSweep(90)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 {
		t.Fatalf("retention removed %d rows, want old row plus one over-cap row", removed)
	}
	rows, err := srv.store.ListLogs(store.LogFilter{SiteID: site.ID, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("stored logs after retention = %d, want 2", len(rows))
	}
}

func TestLogConfigValidationAndPublicConfig(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin,
		`{"name":"Config","url":"https://config.example"}`)
	var site store.Site
	json.NewDecoder(resp.Body).Decode(&site)
	resp.Body.Close()

	settingsURL := fmt.Sprintf("%s/api/sites/%d/settings", ts.URL, site.ID)
	resp = doReq(t, http.MethodPut, settingsURL, admin,
		`{"logs":{"enabled":true,"minimum_severity":"invalid"}}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid severity: got %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doReq(t, http.MethodPut, settingsURL, admin,
		`{"logs":{"enabled":true,"minimum_severity":"info"}}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid log settings: got %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp, err := http.Get(fmt.Sprintf("%s/api/config/%s", ts.URL, site.SiteKey))
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Logs store.LogSettings `json:"logs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&config); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !config.Logs.Enabled || config.Logs.MinimumSeverity != store.LogSeverityInfo {
		t.Fatalf("public log config = %+v, status %d", config.Logs, resp.StatusCode)
	}

	resp = doReq(t, http.MethodPut, settingsURL, admin,
		`{"logs":{"enabled":true,"minimum_severity":"info","retention_days":3651}}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid log retention: got %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
}
