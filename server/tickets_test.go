package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"trace-ux/server/store"
)

func ticketJSONRequest(t *testing.T, method, url, body string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp, data
}

func TestPublicTicketsAuthorizeOnlyBySiteAndVisitorKey(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.initSecurity()
	srv.ticketsReadLimiter = newRequestLimiter(1_000, time.Minute)
	srv.ticketsWriteLimiter = newRequestLimiter(1_000, time.Minute)
	srv.ticketsSiteLimiter = newRequestLimiter(1_000, time.Minute)

	firstSite, err := srv.store.CreateSite("First", "https://first.example")
	if err != nil {
		t.Fatal(err)
	}
	secondSite, err := srv.store.CreateSite("Second", "https://second.example")
	if err != nil {
		t.Fatal(err)
	}
	visitor := "visitor-key-a"
	createURL := fmt.Sprintf("%s/api/support/%s/tickets", ts.URL, firstSite.SiteKey)
	resp, data := ticketJSONRequest(t, http.MethodPost, createURL, `{"visitor_key":"visitor-key-a","user_id":"account-42","subject":"Cannot export","body":"The export button does not respond.","session_id":"fresh-session","page_url":"https://first.example/export"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create ticket: got %d (%s)", resp.StatusCode, data)
	}
	var created store.Ticket
	if err := json.Unmarshal(data, &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.VisitorKey != "" {
		t.Fatalf("ticket identity response = %+v; visitor key must not be exposed", created)
	}
	if created.SessionID != "fresh-session" {
		t.Fatalf("session_id = %q, want fresh-session", created.SessionID)
	}

	// A ticket id alone is not enough: neither another site nor another
	// visitor can probe or append to the conversation. user_id is metadata, not
	// an authorization credential.
	for _, url := range []string{
		fmt.Sprintf("%s/api/support/%s/tickets/%d?visitor=%s", ts.URL, secondSite.SiteKey, created.ID, visitor),
		fmt.Sprintf("%s/api/support/%s/tickets/%d?visitor=visitor-key-b", ts.URL, firstSite.SiteKey, created.ID),
	} {
		resp, data := ticketJSONRequest(t, http.MethodGet, url, "")
		if resp.StatusCode != http.StatusNotFound || !strings.Contains(string(data), "ticket not found") {
			t.Fatalf("cross-visitor/site probe: got %d (%s), want flat 404", resp.StatusCode, data)
		}
	}
	resp, data = ticketJSONRequest(t, http.MethodPost,
		fmt.Sprintf("%s/api/support/%s/tickets/%d/messages", ts.URL, firstSite.SiteKey, created.ID),
		`{"visitor_key":"visitor-key-b","body":"I am account-42"}`)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("user_id-based reply: got %d (%s), want 404", resp.StatusCode, data)
	}

	// A session that belongs to another site is discarded rather than allowing
	// the ticket to attach to the wrong recording.
	if err := srv.store.EnsureSessionForSite(secondSite.ID, "owned-by-second", time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	resp, data = ticketJSONRequest(t, http.MethodPost, createURL,
		`{"visitor_key":"visitor-key-c","email":"person@example.com","subject":"Wrong session","body":"Please help.","session_id":"owned-by-second"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("mismatched session create: got %d (%s)", resp.StatusCode, data)
	}
	var mismatched store.Ticket
	if err := json.Unmarshal(data, &mismatched); err != nil {
		t.Fatal(err)
	}
	if mismatched.SessionID != "" {
		t.Fatalf("mismatched session_id = %q, want blank", mismatched.SessionID)
	}
}

func TestPublicTicketValidationClosedReplyAndCors(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.initSecurity()
	srv.ticketsReadLimiter = newRequestLimiter(1_000, time.Minute)
	srv.ticketsWriteLimiter = newRequestLimiter(1_000, time.Minute)
	srv.ticketsSiteLimiter = newRequestLimiter(1_000, time.Minute)
	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	url := fmt.Sprintf("%s/api/support/%s/tickets", ts.URL, site.SiteKey)
	resp, _ := ticketJSONRequest(t, http.MethodPost, url, `{"visitor_key":"visitor-key-a","subject":"Missing email","body":"Hello"}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing email: got %d, want 400", resp.StatusCode)
	}

	input := store.NewTicket{SiteID: site.ID, VisitorKey: "closed-key", Email: "person@example.com", Subject: "Closed", Body: "Initial message"}
	closed, err := srv.store.CreateTicket(input)
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.store.SetTicketStatus(closed.ID, "closed"); err != nil {
		t.Fatal(err)
	}
	resp, data := ticketJSONRequest(t, http.MethodPost,
		fmt.Sprintf("%s/%d/messages", url, closed.ID),
		`{"visitor_key":"closed-key","body":"A follow-up"}`)
	if resp.StatusCode != http.StatusConflict || !strings.Contains(string(data), "closed") {
		t.Fatalf("closed reply: got %d (%s), want 409", resp.StatusCode, data)
	}

	// The support path uses the same per-site origin allowlist as the other
	// public tracker endpoints.
	options, err := http.NewRequest(http.MethodOptions, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	options.Header.Set("Origin", "https://example.com")
	options.Header.Set("Access-Control-Request-Method", "POST")
	resp, err = http.DefaultClient.Do(options)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent || resp.Header.Get("Access-Control-Allow-Origin") != "https://example.com" {
		t.Fatalf("allowed support CORS: status=%d allow-origin=%q", resp.StatusCode, resp.Header.Get("Access-Control-Allow-Origin"))
	}

	options, _ = http.NewRequest(http.MethodOptions, url, nil)
	options.Header.Set("Origin", "https://other.example")
	options.Header.Set("Access-Control-Request-Method", "POST")
	resp, err = http.DefaultClient.Do(options)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong support CORS origin: got %d, want 403", resp.StatusCode)
	}
}

func TestPublicTicketCaps(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.initSecurity()
	srv.ticketsReadLimiter = newRequestLimiter(1_000, time.Minute)
	srv.ticketsWriteLimiter = newRequestLimiter(1_000, time.Minute)
	srv.ticketsSiteLimiter = newRequestLimiter(1_000, time.Minute)
	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < store.MaxOpenTicketsPerVisitor; i++ {
		_, err := srv.store.CreateTicket(store.NewTicket{
			SiteID: site.ID, VisitorKey: "cap-key-open", Email: "person@example.com",
			Subject: fmt.Sprintf("Open %d", i), Body: "Initial message",
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	createURL := fmt.Sprintf("%s/api/support/%s/tickets", ts.URL, site.SiteKey)
	resp, data := ticketJSONRequest(t, http.MethodPost, createURL, `{"visitor_key":"cap-key-open","email":"person@example.com","subject":"One more","body":"Please help"}`)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("open ticket cap: got %d (%s), want 429", resp.StatusCode, data)
	}

	messageTicket, err := srv.store.CreateTicket(store.NewTicket{
		SiteID: site.ID, VisitorKey: "cap-key-messages", Email: "person@example.com",
		Subject: "Many messages", Body: "Initial message",
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < store.MaxMessagesPerTicket; i++ {
		if _, err := srv.store.AddTicketMessage(messageTicket.ID, "staff", 1, "agent", "reply"); err != nil {
			t.Fatal(err)
		}
	}
	resp, data = ticketJSONRequest(t, http.MethodPost,
		fmt.Sprintf("%s/%d/messages", createURL, messageTicket.ID),
		`{"visitor_key":"cap-key-messages","body":"One too many"}`)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("message cap: got %d (%s), want 429", resp.StatusCode, data)
	}
}

func TestDashboardTicketRoutesRequireAuthAndReply(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := srv.store.CreateTicket(store.NewTicket{SiteID: site.ID, VisitorKey: "dashboard-key", Email: "person@example.com", Subject: "Dashboard", Body: "Hello"})
	if err != nil {
		t.Fatal(err)
	}
	resp, _ := ticketJSONRequest(t, http.MethodGet, ts.URL+"/api/tickets", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated dashboard list: got %d, want 401", resp.StatusCode)
	}
	admin := login(t, ts.URL, "admin", "pw")
	resp = doReq(t, http.MethodPost, fmt.Sprintf("%s/api/tickets/%d/messages", ts.URL, ticket.ID), admin, `{"body":"We are looking into this."}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("staff reply: got %d", resp.StatusCode)
	}
	updated, err := srv.store.GetTicket(ticket.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "in_progress" || updated.MessageCount != 2 || updated.LastMessageAuthor != "staff" {
		t.Fatalf("staff reply did not update ticket: %+v", updated)
	}
}

func TestTicketsCanBeArchivedButNotDeleted(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := srv.store.CreateTicket(store.NewTicket{
		SiteID: site.ID, VisitorKey: "archive-key", Email: "person@example.com",
		Subject: "Keep this record", Body: "Please retain this conversation.",
	})
	if err != nil {
		t.Fatal(err)
	}
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodDelete, fmt.Sprintf("%s/api/tickets/%d", ts.URL, ticket.ID), admin, "")
	data, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusMethodNotAllowed || resp.Header.Get("Allow") != "GET, PATCH" || !strings.Contains(string(data), "cannot be deleted") {
		t.Fatalf("ticket delete: got %d (%s), want 405 rejection", resp.StatusCode, data)
	}
	if _, err := srv.store.GetTicket(ticket.ID); err != nil {
		t.Fatalf("ticket was removed after rejected delete: %v", err)
	}

	resp = doReq(t, http.MethodPost, fmt.Sprintf("%s/api/tickets/%d/archive", ts.URL, ticket.ID), admin, "")
	var archived store.Ticket
	if err := json.NewDecoder(resp.Body).Decode(&archived); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || archived.Status != "archived" || archived.ArchivedAt == 0 {
		t.Fatalf("archive response: status=%d ticket=%+v", resp.StatusCode, archived)
	}

	messages, err := srv.store.ListTicketMessages(ticket.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].Body != "Please retain this conversation." {
		t.Fatalf("archived conversation was not retained: %+v", messages)
	}
	archivedRows, err := srv.store.ListTickets(store.TicketFilter{SiteID: site.ID, Status: "archived", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(archivedRows) != 1 || archivedRows[0].ID != ticket.ID {
		t.Fatalf("archived ticket list = %+v", archivedRows)
	}
	activeRows, err := srv.store.ListTickets(store.TicketFilter{SiteID: site.ID, Status: "open", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(activeRows) != 0 {
		t.Fatalf("archived ticket appeared in active list: %+v", activeRows)
	}

	resp = doReq(t, http.MethodPost, fmt.Sprintf("%s/api/tickets/%d/messages", ts.URL, ticket.ID), admin, `{"body":"This must be read-only."}`)
	data, err = io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusConflict || !strings.Contains(string(data), "archived") {
		t.Fatalf("reply to archived ticket: got %d (%s), want 409", resp.StatusCode, data)
	}

	resp = doReq(t, http.MethodPatch, fmt.Sprintf("%s/api/tickets/%d", ts.URL, ticket.ID), admin, `{"status":"open"}`)
	var reopened store.Ticket
	if err := json.NewDecoder(resp.Body).Decode(&reopened); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || reopened.Status != "open" || reopened.ArchivedAt != 0 {
		t.Fatalf("unarchive response: status=%d ticket=%+v", resp.StatusCode, reopened)
	}
}
