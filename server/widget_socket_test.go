package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func dialWidgetSocket(t *testing.T, baseURL, siteKey, visitor string) *websocket.Conn {
	t.Helper()
	query := url.Values{}
	query.Set("visitor", visitor)
	query.Set("channels", "updates,tickets")
	wsURL := strings.Replace(baseURL, "http://", "ws://", 1) + "/api/widget/" + url.PathEscape(siteKey) + "/socket?" + query.Encode()
	header := http.Header{}
	header.Set("Origin", "https://example.com")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		if resp != nil {
			resp.Body.Close()
		}
		t.Fatalf("dial widget socket: %v", err)
	}
	return conn
}

func dialDashboardTicketSocket(t *testing.T, baseURL string, cookie *http.Cookie) *websocket.Conn {
	t.Helper()
	wsURL := strings.Replace(baseURL, "http://", "ws://", 1) + "/api/tickets/socket"
	header := http.Header{}
	header.Set("Origin", baseURL)
	header.Set("Cookie", cookie.String())
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		if resp != nil {
			resp.Body.Close()
		}
		t.Fatalf("dial dashboard ticket socket: %v", err)
	}
	return conn
}

func readWidgetSocketEvent(t *testing.T, conn *websocket.Conn, timeout time.Duration) widgetSocketEvent {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		t.Fatal(err)
	}
	var event widgetSocketEvent
	if err := conn.ReadJSON(&event); err != nil {
		t.Fatalf("read widget socket event: %v", err)
	}
	return event
}

func assertNoWidgetSocketEvent(t *testing.T, conn *websocket.Conn, timeout time.Duration) {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		t.Fatal(err)
	}
	_, _, err := conn.ReadMessage()
	if err == nil {
		t.Fatal("received an event for another visitor")
	}
	var netErr net.Error
	if !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("reading isolated socket: %v", err)
	}
}

func TestWidgetSocketBroadcastsAndScopesEvents(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.initSecurity()
	srv.widgetSocketLimiter = newRequestLimiter(1_000, time.Minute)
	srv.widgetSocketSiteLimiter = newRequestLimiter(1_000, time.Minute)

	site, err := srv.store.CreateSite("Socket site", "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	settings := site.Settings
	settings.TicketsEnabled = true
	if err := srv.store.UpdateSiteSettings(site.ID, settings); err != nil {
		t.Fatal(err)
	}

	now := time.Now().Unix()
	result, err := srv.store.db.Exec(`INSERT INTO announcements(site_id,title,summary,body,release_label,link_url,status,published_at,created_at,updated_at)
		VALUES(?,?,?,?,?,?,'draft',0,?,?)`, site.ID, "Socket update", "", "Published over the socket", "", "", now, now)
	if err != nil {
		t.Fatal(err)
	}
	announcementID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}

	visitorA := "visitor-key-a"
	visitorB := "visitor-key-b"
	connA := dialWidgetSocket(t, ts.URL, site.SiteKey, visitorA)
	defer connA.Close()
	connB := dialWidgetSocket(t, ts.URL, site.SiteKey, visitorB)
	defer connB.Close()

	admin := login(t, ts.URL, "admin", "pw")
	dashboardConn := dialDashboardTicketSocket(t, ts.URL, admin)
	defer dashboardConn.Close()
	resp := doReq(t, http.MethodPost, fmt.Sprintf("%s/api/announcements/%d/publish", ts.URL, announcementID), admin, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("publish announcement: got %d", resp.StatusCode)
	}
	for _, conn := range []*websocket.Conn{connA, connB} {
		event := readWidgetSocketEvent(t, conn, time.Second)
		if event.Type != "announcement.published" || event.Announcement == nil || event.Announcement.ID != announcementID {
			t.Fatalf("announcement event = %+v", event)
		}
	}

	createURL := fmt.Sprintf("%s/api/support/%s/tickets", ts.URL, site.SiteKey)
	resp, _ = ticketJSONRequest(t, http.MethodPost, createURL,
		`{"visitor_key":"visitor-key-a","email":"person@example.com","subject":"Socket ticket","body":"Initial question"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create ticket: got %d", resp.StatusCode)
	}
	createdEvent := readWidgetSocketEvent(t, connA, time.Second)
	if createdEvent.Type != "ticket.created" || createdEvent.Ticket == nil {
		t.Fatalf("ticket created event = %+v", createdEvent)
	}
	dashboardCreatedEvent := readWidgetSocketEvent(t, dashboardConn, time.Second)
	if dashboardCreatedEvent.Type != "ticket.created" || dashboardCreatedEvent.Ticket == nil || dashboardCreatedEvent.Ticket.ID != createdEvent.Ticket.ID {
		t.Fatalf("dashboard ticket created event = %+v", dashboardCreatedEvent)
	}
	assertNoWidgetSocketEvent(t, connB, 150*time.Millisecond)

	resp = doReq(t, http.MethodPost, fmt.Sprintf("%s/api/tickets/%d/messages", ts.URL, createdEvent.Ticket.ID), admin, `{"body":"Support reply over the socket"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("staff reply: got %d", resp.StatusCode)
	}
	replyEvent := readWidgetSocketEvent(t, connA, time.Second)
	if replyEvent.Type != "ticket.message" || replyEvent.Message == nil || replyEvent.Message.Body != "Support reply over the socket" {
		t.Fatalf("ticket reply event = %+v", replyEvent)
	}
	dashboardReplyEvent := readWidgetSocketEvent(t, dashboardConn, time.Second)
	if dashboardReplyEvent.Type != "ticket.message" || dashboardReplyEvent.Message == nil || dashboardReplyEvent.Message.Body != "Support reply over the socket" {
		t.Fatalf("dashboard ticket reply event = %+v", dashboardReplyEvent)
	}
	assertNoWidgetSocketEvent(t, connB, 150*time.Millisecond)
}
