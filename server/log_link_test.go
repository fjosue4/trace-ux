package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"trace-ux/server/store"
)

// A direct link (/logs/log/<id>) resolves one log by id, with the same fields
// the list returns, regardless of the list's filters or time window.
func TestGetLogByID(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	site, err := srv.store.CreateSite("Link", "https://link.example")
	if err != nil {
		t.Fatal(err)
	}
	service, _, err := srv.store.CreateService(site.ID, "billing-api")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := srv.store.SaveServiceLogs(service, []string{"error"}, []store.ServiceLogEntry{{
		Severity:    "error",
		Message:     "Payment request failed",
		Environment: "production",
		Extra:       json.RawMessage(`{"request_id":"req_123"}`),
	}}); err != nil {
		t.Fatal(err)
	}
	listed, err := srv.store.ListLogs(store.LogFilter{SiteID: site.ID})
	if err != nil || len(listed) != 1 {
		t.Fatalf("listed logs = %v, %v; want one", listed, err)
	}
	want := listed[0]

	resp := doReq(t, http.MethodGet, fmt.Sprintf("%s/api/logs/%d", ts.URL, want.ID), admin, "")
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("get log: got %d", resp.StatusCode)
	}
	var got store.Log
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if got.ID != want.ID || got.Message != want.Message || got.ServiceName != "billing-api" ||
		got.SiteName != "Link" || got.Environment != "production" || got.Extra != want.Extra {
		t.Fatalf("got %+v, want the listed log %+v", got, want)
	}

	for path, status := range map[string]int{
		fmt.Sprintf("/api/logs/%d", want.ID+1000): http.StatusNotFound,
		"/api/logs/not-a-number":                   http.StatusBadRequest,
	} {
		resp := doReq(t, http.MethodGet, ts.URL+path, admin, "")
		resp.Body.Close()
		if resp.StatusCode != status {
			t.Fatalf("GET %s: got %d, want %d", path, resp.StatusCode, status)
		}
	}

	// The fixed sibling routes still win over the id pattern.
	resp = doReq(t, http.MethodGet, ts.URL+"/api/logs/stats", admin, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/logs/stats: got %d, want 200", resp.StatusCode)
	}

	resp = doReq(t, http.MethodGet, fmt.Sprintf("%s/api/logs/%d", ts.URL, want.ID), nil, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated get log: got %d, want 401", resp.StatusCode)
	}
}
