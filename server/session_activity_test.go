package main

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"trace-ux/server/store"
)

// TestSessionDetailIncludesTicketsAndFeedback covers the replay page's
// activity feed: tickets and feedback linked to a recording must come back
// alongside custom_events/logs/pages so the dashboard can show "Ticket
// created" and "Feedback given" rows without a second round trip.
func TestSessionDetailIncludesTicketsAndFeedback(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	const sessionID = "sess-activity-1"
	if err := srv.store.EnsureSessionForSite(site.ID, sessionID, time.Now().Unix()); err != nil {
		t.Fatal(err)
	}

	ticket, err := srv.store.CreateTicket(store.NewTicket{
		SiteID:     site.ID,
		VisitorKey: "visitor-key-a",
		Email:      "visitor@example.com",
		Subject:    "Checkout is broken",
		Body:       "It just spins forever",
		SessionID:  sessionID,
	})
	if err != nil {
		t.Fatal(err)
	}

	feedbackID, err := srv.store.SaveFeedback(store.NewFeedback{
		SiteID:    site.ID,
		SessionID: sessionID,
		SurveyID:  "default",
		Rating:    5,
		Comment:   "Loved it",
	})
	if err != nil {
		t.Fatal(err)
	}

	// A ticket/feedback on a different session must never leak into this one.
	otherSessionID := "sess-activity-2"
	if err := srv.store.EnsureSessionForSite(site.ID, otherSessionID, time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.store.CreateTicket(store.NewTicket{
		SiteID:     site.ID,
		VisitorKey: "visitor-key-b",
		Email:      "other@example.com",
		Subject:    "Unrelated",
		Body:       "Unrelated",
		SessionID:  otherSessionID,
	}); err != nil {
		t.Fatal(err)
	}

	resp := authed(t, ts.URL, http.MethodGet, "/api/sessions/"+sessionID, "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get session: got %d", resp.StatusCode)
	}
	var body struct {
		Tickets  []store.Ticket   `json:"tickets"`
		Feedback []store.Feedback `json:"feedback"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	if len(body.Tickets) != 1 || body.Tickets[0].ID != ticket.ID || body.Tickets[0].Subject != "Checkout is broken" {
		t.Fatalf("unexpected tickets: %+v", body.Tickets)
	}
	if len(body.Feedback) != 1 || body.Feedback[0].ID != feedbackID || body.Feedback[0].Rating != 5 {
		t.Fatalf("unexpected feedback: %+v", body.Feedback)
	}
}
