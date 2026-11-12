package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"trace-ux/server/store"
)

func TestSessionContactFindsTheWidgetVisitor(t *testing.T) {
	srv, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	site, err := srv.store.CreateSite("Shop", "https://shop.example")
	if err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := srv.store.DB.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	session := func(id, userID string) {
		exec(`INSERT INTO sessions (id,site_id,started_at,last_seen,user_id) VALUES (?,?,1,1,?)`, id, site.ID, userID)
	}
	contact := func(id string) (int, store.SessionContact) {
		t.Helper()
		resp := doReq(t, http.MethodGet, fmt.Sprintf("%s/api/sessions/%s/contact", ts.URL, id), admin, "")
		defer resp.Body.Close()
		var c store.SessionContact
		if resp.StatusCode == http.StatusOK {
			if err := json.NewDecoder(resp.Body).Decode(&c); err != nil {
				t.Fatal(err)
			}
		}
		return resp.StatusCode, c
	}

	// An anonymous visitor cannot be ticketed from a recording, even when
	// their widget key is known.
	session("rec-anonymous", "")
	exec(`INSERT INTO feedback (site_id,session_id,visitor_key,rating,created_at) VALUES (?,?,?,5,5)`, site.ID, "rec-anonymous", "widget-key-anonymous")
	if code, _ := contact("rec-anonymous"); code != http.StatusConflict {
		t.Fatalf("anonymous visitor: %d, want 409", code)
	}
	resp := doReq(t, http.MethodPost, ts.URL+"/api/tickets", admin, fmt.Sprintf(
		`{"site_id":%d,"visitor_key":%q,"session_id":"rec-anonymous","email":"anon@example.com","subject":"Hi","body":"Hello"}`,
		site.ID, store.SessionContactKeyPrefix+"rec-anonymous"))
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("stand-in ticket for an anonymous recording: %d, want 409", resp.StatusCode)
	}

	// Feedback given during the recording carries the widget key.
	session("rec-feedback", "account-3")
	exec(`INSERT INTO feedback (site_id,session_id,visitor_key,rating,created_at) VALUES (?,?,?,5,10)`, site.ID, "rec-feedback", "widget-key-feedback")
	if code, c := contact("rec-feedback"); code != http.StatusOK || !c.InWidget || c.VisitorKey != "widget-key-feedback" || c.SiteID != site.ID {
		t.Fatalf("feedback match: %d %+v", code, c)
	}

	// An identified visitor is found through another visit's ticket, and the
	// address they gave there is offered again.
	session("rec-identified", "account-7")
	exec(`INSERT INTO tickets (site_id,visitor_key,user_id,email,subject,created_at,updated_at) VALUES (?,?,?,?,?,20,20)`,
		site.ID, "widget-key-account", "account-7", "seven@example.com", "Earlier")
	if code, c := contact("rec-identified"); code != http.StatusOK || !c.InWidget || c.VisitorKey != "widget-key-account" || c.Email != "seven@example.com" || c.UserID != "account-7" {
		t.Fatalf("identity match: %d %+v", code, c)
	}

	// An identified visitor who never used the widget: a stand-in key,
	// flagged as such.
	session("rec-silent", "account-9")
	if code, c := contact("rec-silent"); code != http.StatusOK || c.InWidget || c.VisitorKey != store.SessionContactKeyPrefix+"rec-silent" {
		t.Fatalf("no widget use: %d %+v", code, c)
	}

	// A staff ticket opened with that stand-in is never mistaken for a real
	// widget key on the next lookup.
	resp = doReq(t, http.MethodPost, ts.URL+"/api/tickets", admin, fmt.Sprintf(
		`{"site_id":%d,"visitor_key":%q,"session_id":"rec-silent","email":"silent@example.com","subject":"We saw an error","body":"Can we help?"}`,
		site.ID, store.SessionContactKeyPrefix+"rec-silent"))
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("staff ticket from a recording: %d", resp.StatusCode)
	}
	if _, c := contact("rec-silent"); c.InWidget || c.Email != "silent@example.com" {
		t.Fatalf("after a stand-in ticket: %+v", c)
	}

	if code, _ := contact("missing"); code != http.StatusNotFound {
		t.Fatalf("missing session: %d, want 404", code)
	}
}
