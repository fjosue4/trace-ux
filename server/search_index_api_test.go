package main

import (
	"encoding/json"
	"net/http"
	"testing"

	"trace-ux/server/store"
)

func TestSearchIndexAdminAPI(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	url := ts.URL + "/api/system/search-index"

	resp := doReq(t, http.MethodGet, url, nil, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous GET = %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doReq(t, http.MethodGet, url, admin, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin GET = %d, want 200", resp.StatusCode)
	}
	var status store.SearchIndexStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if !status.Enabled {
		t.Fatal("search index should be enabled by default")
	}

	resp = doReq(t, http.MethodPut, url, admin, `{"enabled":false}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("disable = %d, want 200", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if status.Enabled {
		t.Fatal("disable response still reports enabled")
	}

	resp = doReq(t, http.MethodPut, url, admin, `{}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid PUT = %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
}
