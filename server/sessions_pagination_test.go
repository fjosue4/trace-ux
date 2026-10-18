package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"trace-ux/server/store"
)

func TestSessionListPaginatesFortyAtATime(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	site, err := srv.store.CreateSite("Pagination", "https://pages.example")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 85; i++ {
		if _, err := srv.store.DB.Exec(`INSERT INTO sessions
   (id, site_id, started_at, last_seen, duration_ms, browser)
   VALUES (?, ?, 100, 100, 2000, 'Firefox')`, fmt.Sprintf("session-%03d", i), site.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := srv.store.DB.Exec(`INSERT INTO sessions
  (id, site_id, started_at, last_seen, duration_ms, browser)
  VALUES ('other-browser', ?, 100, 100, 2000, 'Chrome')`, site.ID); err != nil {
		t.Fatal(err)
	}
	base := fmt.Sprintf("%s/api/sessions?site_id=%d&browser=Firefox", ts.URL, site.ID)
	var got []store.Session
	cursor := ""
	for _, size := range []int{40, 40, 5} {
		response := doReq(t, http.MethodGet, base+cursor, admin, "")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("list status: %d", response.StatusCode)
		}
		var page []store.Session
		if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if len(page) != size {
			t.Fatalf("page has %d rows, want %d", len(page), size)
		}
		got = append(got, page...)
		last := page[len(page)-1]
		cursor = fmt.Sprintf("&limit=40&before=%d&before_id=%s", last.StartedAt, last.ID)
	}
	for i, row := range got {
		if want := fmt.Sprintf("session-%03d", 84-i); row.ID != want {
			t.Fatalf("row %d = %s, want %s", i, row.ID, want)
		}
	}
	for _, query := range []string{"&before=invalid", "&before=-1", "&before_id=missing"} {
		response := doReq(t, http.MethodGet, base+query, admin, "")
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("query %s status = %d, want 400", query, response.StatusCode)
		}
	}
}
