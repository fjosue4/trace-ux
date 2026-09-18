package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"trace-ux/server/store"
)

func TestSlackLogMatches(t *testing.T) {
	cases := []struct {
		name    string
		mode    string
		pattern string
		message string
		want    bool
	}{
		{"blank pattern matches anything", store.SlackLogMatchContains, "", "anything at all", true},
		{"contains substring", store.SlackLogMatchContains, "TypeError", "Uncaught TypeError: x is not a function", true},
		{"contains is case sensitive", store.SlackLogMatchContains, "typeerror", "Uncaught TypeError: x is not a function", false},
		{"contains no match", store.SlackLogMatchContains, "NetworkError", "Uncaught TypeError", false},
		{"exact full match", store.SlackLogMatchExact, "Payment failed", "Payment failed", true},
		{"exact partial is not enough", store.SlackLogMatchExact, "Payment failed", "Payment failed: card declined", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := slackLogMatches(c.mode, c.pattern, c.message); got != c.want {
				t.Errorf("slackLogMatches(%q, %q, %q) = %v, want %v", c.mode, c.pattern, c.message, got, c.want)
			}
		})
	}
}

func TestEvaluateSlackHealthCrossing(t *testing.T) {
	state := map[string]bool{}

	// First poll: RAM crosses above 90, CPU and Disk stay low.
	above := evaluateSlackHealthCrossing(state, []systemHealthAlert{
		{Metric: "RAM", Pct: 95}, {Metric: "CPU", Pct: 10}, {Metric: "Disk", Pct: 50},
	})
	if len(above) != 1 || above[0].Metric != "RAM" {
		t.Fatalf("expected only RAM to alert, got %+v", above)
	}

	// Still above on the next poll: no repeat alert while the incident persists.
	above = evaluateSlackHealthCrossing(state, []systemHealthAlert{
		{Metric: "RAM", Pct: 96}, {Metric: "CPU", Pct: 10}, {Metric: "Disk", Pct: 50},
	})
	if above != nil {
		t.Fatalf("expected no repeat alert while RAM stays above threshold, got %+v", above)
	}

	// Recovers to at-or-below 90: no alert, and it resets eligibility.
	above = evaluateSlackHealthCrossing(state, []systemHealthAlert{
		{Metric: "RAM", Pct: 90}, {Metric: "CPU", Pct: 10}, {Metric: "Disk", Pct: 50},
	})
	if above != nil {
		t.Fatalf("expected no alert on recovery, got %+v", above)
	}

	// Crosses again, and now Disk is also above: the message must include both.
	above = evaluateSlackHealthCrossing(state, []systemHealthAlert{
		{Metric: "RAM", Pct: 92}, {Metric: "CPU", Pct: 10}, {Metric: "Disk", Pct: 91},
	})
	if len(above) != 2 {
		t.Fatalf("expected both RAM and Disk in the alert, got %+v", above)
	}
}

func TestTruncateForSlack(t *testing.T) {
	if got := truncateForSlack("short", 100); got != "short" {
		t.Fatalf("short text must be unchanged, got %q", got)
	}
	got := truncateForSlack("this is a long message", 10)
	// "…" is a multi-byte rune, so the truncated string's byte length is a
	// little over max -- what matters is that it's meaningfully shorter than
	// the original and clearly marked as truncated.
	if len(got) >= len("this is a long message") || !strings.HasSuffix(got, "…") {
		t.Fatalf("truncateForSlack = %q, want a shortened string ending in an ellipsis", got)
	}
}

func TestBuildTicketSlackText(t *testing.T) {
	ticket := store.Ticket{ID: 42, SiteName: "Acme", Subject: "Checkout is broken", Name: "Jamie"}
	text := buildTicketSlackText(ticket, "It just spins forever", "https://dash.example.com")
	for _, want := range []string{"Acme", "#42", "Checkout is broken", "Jamie", "It just spins forever", "https://dash.example.com/tickets?ticket=42"} {
		if !strings.Contains(text, want) {
			t.Errorf("ticket message missing %q:\n%s", want, text)
		}
	}
}

func TestBuildLogsSlackText(t *testing.T) {
	logs := []store.Log{
		{Severity: "error", Message: "Payment failed", URL: "https://x.test/checkout", SessionID: "sess-1"},
	}
	text := buildLogsSlackText("Acme", logs, "https://dash.example.com")
	for _, want := range []string{"Acme", "ERROR", "Payment failed", "https://x.test/checkout", "https://dash.example.com/replay/sess-1"} {
		if !strings.Contains(text, want) {
			t.Errorf("logs message missing %q:\n%s", want, text)
		}
	}
}

func TestSystemHealthSlackMessageMatchesDashboardFields(t *testing.T) {
	const gib = uint64(1024 * 1024 * 1024)
	snapshot := systemHealthSnapshot{
		Ram: ramHealth{
			TotalBytes:     16 * gib,
			UsedBytes:      15 * gib,
			AvailableBytes: 1 * gib,
			TraceUXBytes:   256 * 1024 * 1024,
			MemLimitBytes:  int64(2 * gib),
		},
		Cpu: cpuHealth{
			Cores:         4,
			Load1:         1.23,
			Load5:         0.87,
			Load15:        0.45,
			TraceUXPct:    91.2,
			UptimeSeconds: 3723,
		},
		Disk: diskHealth{
			TotalBytes:   100 * gib,
			FreeBytes:    5 * gib,
			TraceUXBytes: 2 * gib,
			DataDir:      "/var/lib/trace-ux/data",
		},
		Store: storeCounts{Sites: 3, Sessions: 42, Feedback: 7},
	}
	message := buildSystemHealthSlackMessage(snapshot, []systemHealthAlert{{Metric: "CPU", Pct: 91.2}})
	if message.Header != "System health" {
		t.Fatalf("header = %q, want the dashboard title", message.Header)
	}
	for _, want := range []string{
		"*Above 90%:* CPU 91%",
		"*Memory* · 94%",
		"• Total: 16.0 GB",
		"• In use: 15.0 GB",
		"• Available: 1.0 GB",
		"• TraceUX (RSS): 256 MB",
		"• Soft memory cap: 2.0 GB",
		"*CPU* · 91%",
		"• Cores: 4",
		"• Load (1m): 1.23",
		"• TraceUX uptime: 1h 2m",
		"*Disk* · 95%",
		"• Volume: 100 GB",
		"• Free: 5.0 GB",
		"• TraceUX data: 2.0 GB",
		"• Data dir: /var/lib/trace-ux/data",
		"*What TraceUX stores*",
		"• 3 sites",
		"• 42 recordings",
		"• 7 feedback",
	} {
		if !strings.Contains(message.Message, want) {
			t.Errorf("system message missing %q:\n%s", want, message.Message)
		}
	}
}

// slackReceiver captures posted webhook bodies and can be told to fail the
// first N requests, so retry behavior can be tested without a real Slack.
type slackReceiver struct {
	*httptest.Server
	failFirst int32
	requests  int32
	bodies    chan string
}

func newSlackReceiver(t *testing.T, failFirst int32) *slackReceiver {
	t.Helper()
	r := &slackReceiver{failFirst: failFirst, bodies: make(chan string, 10)}
	r.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		n := atomic.AddInt32(&r.requests, 1)
		buf, _ := io.ReadAll(req.Body)
		r.bodies <- string(buf)
		if n <= r.failFirst {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(r.Close)
	return r
}

func TestPostSlackMessageRetriesTransientFailures(t *testing.T) {
	srv := &Server{}
	receiver := newSlackReceiver(t, 2) // fail twice, succeed on the 3rd attempt
	if err := srv.postSlackMessage(receiver.URL, slackMessage{Text: "hi"}, 3); err != nil {
		t.Fatalf("expected eventual success, got %v", err)
	}
	if got := atomic.LoadInt32(&receiver.requests); got != 3 {
		t.Fatalf("expected 3 attempts, got %d", got)
	}
}

func TestSlackProviderSendsBlockKitPayload(t *testing.T) {
	receiver := newSlackReceiver(t, 0)
	provider, err := newSlackProvider(receiver.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := provider.Send(context.Background(), NotificationMessage{
		Header:  "New support ticket",
		Message: "*#42 — Checkout is broken*",
		Button:  &NotificationButton{Text: "Open ticket", URL: "https://dash.example/tickets?ticket=42"},
		Footer:  "TraceUX · Acme",
	}); err != nil {
		t.Fatal(err)
	}

	var payload struct {
		Text   string       `json:"text"`
		Blocks []SlackBlock `json:"blocks"`
	}
	body := waitForSlackDelivery(t, receiver)
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatalf("decode Slack payload: %v (%s)", err, body)
	}
	if payload.Text != "" {
		t.Fatalf("legacy top-level text must be absent: %s", body)
	}
	if len(payload.Blocks) != 3 {
		t.Fatalf("blocks = %d, want header, section, context: %s", len(payload.Blocks), body)
	}
	if payload.Blocks[0].Type != "header" || payload.Blocks[1].Type != "section" || payload.Blocks[2].Type != "context" {
		t.Fatalf("unexpected Block Kit block order: %+v", payload.Blocks)
	}
	if payload.Blocks[1].Accessory == nil || payload.Blocks[1].Accessory.URL == "" {
		t.Fatalf("ticket link must be a section button accessory: %+v", payload.Blocks[1])
	}
}

func TestPostSlackMessageDoesNotRetryClientErrors(t *testing.T) {
	srv := &Server{}
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer receiver.Close()
	var attempts int32
	receiverURL := receiver.URL
	origHandler := receiver.Config.Handler
	receiver.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&attempts, 1)
		origHandler.ServeHTTP(w, r)
	})
	if err := srv.postSlackMessage(receiverURL, slackMessage{Text: "hi"}, 3); err == nil {
		t.Fatal("expected a 400 to be reported as an error")
	}
	if got := atomic.LoadInt32(&attempts); got != 1 {
		t.Fatalf("a non-retryable 4xx must not be retried, got %d attempts", got)
	}
}

func TestPostSlackMessageErrorIsRedacted(t *testing.T) {
	srv := &Server{}
	const bogusURL = "https://127.0.0.1:1/services/T000/B000/should-not-leak"
	err := srv.postSlackMessage(bogusURL, slackMessage{Text: "hi"}, 1)
	if err == nil {
		t.Fatal("expected a connection error against a closed port")
	}
	if strings.Contains(err.Error(), bogusURL) {
		t.Fatalf("delivery error must not contain the webhook URL: %v", err)
	}
}

// waitForSlackDelivery blocks until the receiver sees a request or the test
// times out, since notifySlack* enqueues asynchronously.
func waitForSlackDelivery(t *testing.T, receiver *slackReceiver) string {
	t.Helper()
	select {
	case body := <-receiver.bodies:
		return body
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the Slack notification to be delivered")
		return ""
	}
}

// setSiteSlackIntegrationForTest saves a common webhook for one site,
// pointing at a local test receiver and bypassing the hooks.slack.com-only
// validation the PUT API enforces -- appropriate here since these tests
// exercise delivery, not input validation (that's covered in
// site_slack_api_test.go).
func setSiteSlackIntegrationForTest(t *testing.T, srv *Server, siteID int64, webhookURL string, update store.SiteSlackIntegrationUpdate) {
	t.Helper()
	ciphertext, err := encryptSlackWebhook(srv.secret, webhookURL)
	if err != nil {
		t.Fatal(err)
	}
	update.SiteID = siteID
	update.Common = store.SlackWebhookUpdate{Set: true, Secret: store.SlackWebhookSecret{
		Ciphertext:  ciphertext,
		Fingerprint: slackWebhookFingerprint(webhookURL),
		Hint:        slackWebhookHint(webhookURL),
	}}
	if _, err := srv.store.UpdateSiteSlackIntegration(update); err != nil {
		t.Fatal(err)
	}
}

func mustCreateNotifyTestSite(t *testing.T, srv *Server) store.Site {
	t.Helper()
	site, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	return site
}

func TestNotifySlackTicketDeliversWhenEnabled(t *testing.T) {
	srv, _ := newTestServer(t)
	site := mustCreateNotifyTestSite(t, srv)
	receiver := newSlackReceiver(t, 0)
	setSiteSlackIntegrationForTest(t, srv, site.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:    store.SlackRoutingSingle,
		LogMatchMode:   store.SlackLogMatchContains,
		TicketsEnabled: true,
	})
	req := httptest.NewRequest(http.MethodPost, "https://dash.example.com/api/tickets", nil)
	ticket := store.Ticket{ID: 7, SiteID: site.ID, SiteName: site.Name, Subject: "Help", Name: "Jamie"}
	srv.notifySlackTicket(ticket, "Body text", req)

	body := waitForSlackDelivery(t, receiver)
	if !strings.Contains(body, site.Name) || !strings.Contains(body, "Help") {
		t.Fatalf("unexpected payload: %s", body)
	}
}

func TestNotifySlackTicketSkippedWhenDisabled(t *testing.T) {
	srv, _ := newTestServer(t)
	site := mustCreateNotifyTestSite(t, srv)
	receiver := newSlackReceiver(t, 0)
	setSiteSlackIntegrationForTest(t, srv, site.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:    store.SlackRoutingSingle,
		LogMatchMode:   store.SlackLogMatchContains,
		TicketsEnabled: false, // disabled despite having a webhook configured
	})
	req := httptest.NewRequest(http.MethodPost, "https://dash.example.com/api/tickets", nil)
	srv.notifySlackTicket(store.Ticket{ID: 1, SiteID: site.ID, SiteName: site.Name, Subject: "Help"}, "body", req)

	select {
	case body := <-receiver.bodies:
		t.Fatalf("expected no delivery while disabled, got %s", body)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestNotifySlackTicketUsesTheTicketsSiteNotAnotherSite(t *testing.T) {
	srv, _ := newTestServer(t)
	notifyingSite := mustCreateNotifyTestSite(t, srv)
	otherSite, err := srv.store.CreateSite("Beta", "https://beta.example")
	if err != nil {
		t.Fatal(err)
	}
	receiver := newSlackReceiver(t, 0)
	// Only the "other" site has a webhook configured; the ticket belongs to
	// notifyingSite, which has nothing configured, so nothing should send.
	setSiteSlackIntegrationForTest(t, srv, otherSite.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:    store.SlackRoutingSingle,
		LogMatchMode:   store.SlackLogMatchContains,
		TicketsEnabled: true,
	})
	req := httptest.NewRequest(http.MethodPost, "https://dash.example.com/api/tickets", nil)
	srv.notifySlackTicket(store.Ticket{ID: 1, SiteID: notifyingSite.ID, SiteName: notifyingSite.Name, Subject: "Help"}, "body", req)

	select {
	case body := <-receiver.bodies:
		t.Fatalf("expected no delivery through another site's webhook, got %s", body)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestNotifySlackLogsAppliesMatcher(t *testing.T) {
	srv, _ := newTestServer(t)
	site := mustCreateNotifyTestSite(t, srv)
	receiver := newSlackReceiver(t, 0)
	setSiteSlackIntegrationForTest(t, srv, site.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:   store.SlackRoutingSingle,
		LogMatchMode:  store.SlackLogMatchContains,
		LogMatchValue: "Payment",
		LogsEnabled:   true,
	})
	req := httptest.NewRequest(http.MethodGet, "https://dash.example.com/api/ingest/x", nil)
	logs := []store.Log{
		{Message: "Payment failed", Severity: "error", SessionID: "s1"},
		{Message: "Unrelated info", Severity: "error", SessionID: "s1"},
	}
	srv.notifySlackLogs(site, logs, req)

	body := waitForSlackDelivery(t, receiver)
	if !strings.Contains(body, "Payment failed") {
		t.Fatalf("expected the matching log in the payload: %s", body)
	}
	if strings.Contains(body, "Unrelated info") {
		t.Fatalf("expected the non-matching log to be filtered out: %s", body)
	}
}

func TestNotifySlackLogsNoMatchSendsNothing(t *testing.T) {
	srv, _ := newTestServer(t)
	site := mustCreateNotifyTestSite(t, srv)
	receiver := newSlackReceiver(t, 0)
	setSiteSlackIntegrationForTest(t, srv, site.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:   store.SlackRoutingSingle,
		LogMatchMode:  store.SlackLogMatchExact,
		LogMatchValue: "Specific message",
		LogsEnabled:   true,
	})
	req := httptest.NewRequest(http.MethodGet, "https://dash.example.com/api/ingest/x", nil)
	srv.notifySlackLogs(site, []store.Log{{Message: "Something else", Severity: "error"}}, req)

	select {
	case body := <-receiver.bodies:
		t.Fatalf("expected no delivery for a non-matching log, got %s", body)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestBuildCustomEventSlackMessage(t *testing.T) {
	events := []store.CustomEvent{
		{
			Name:      "user_automatic_error_report",
			TrackID:   "franklin.mendez@replypro.io",
			Details:   json.RawMessage(`{"errorInfo":"TypeError: Cannot read properties of undefined (reading 'id')","pathname":"/inbox/interaction/abc123"}`),
			SessionID: "sess-1",
		},
	}
	message := buildCustomEventSlackMessage("Acme", events, "https://dash.example.com")
	for _, want := range []string{"user_automatic_error_report", "franklin.mendez@replypro.io", "TypeError: Cannot read properties of undefined (reading 'id')", "/inbox/interaction/abc123", "Acme"} {
		if !strings.Contains(message.Message, want) && !strings.Contains(message.Footer, want) {
			t.Errorf("custom event message missing %q:\nmessage=%s\nfooter=%s", want, message.Message, message.Footer)
		}
	}
	if message.Button == nil || message.Button.Text != "Open session" || message.Button.URL != "https://dash.example.com/replay/sess-1" {
		t.Fatalf("custom event message missing session button: %+v", message.Button)
	}
}

func TestNotifySlackCustomEventsOnlyNotifiesFlaggedEvents(t *testing.T) {
	srv, _ := newTestServer(t)
	site := mustCreateNotifyTestSite(t, srv)
	receiver := newSlackReceiver(t, 0)
	setSiteSlackIntegrationForTest(t, srv, site.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:   store.SlackRoutingSingle,
		LogMatchMode:  store.SlackLogMatchContains,
		CustomEnabled: true,
	})
	req := httptest.NewRequest(http.MethodGet, "https://dash.example.com/api/ingest/x", nil)
	events := []store.CustomEvent{
		{Name: "checkout_error", TrackID: "checkout-button", Notify: true, SessionID: "s1"},
		{Name: "page_scroll", Notify: false, SessionID: "s1"},
	}
	srv.notifySlackCustomEvents(site, events, req)

	body := waitForSlackDelivery(t, receiver)
	if !strings.Contains(body, "checkout_error") {
		t.Fatalf("expected the notify-flagged event in the payload: %s", body)
	}
	if strings.Contains(body, "page_scroll") {
		t.Fatalf("expected the non-flagged event to be filtered out: %s", body)
	}
}

func TestNotifySlackCustomEventsSkippedWhenDisabled(t *testing.T) {
	srv, _ := newTestServer(t)
	site := mustCreateNotifyTestSite(t, srv)
	receiver := newSlackReceiver(t, 0)
	setSiteSlackIntegrationForTest(t, srv, site.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:   store.SlackRoutingSingle,
		LogMatchMode:  store.SlackLogMatchContains,
		CustomEnabled: false, // disabled despite having a webhook configured
	})
	req := httptest.NewRequest(http.MethodGet, "https://dash.example.com/api/ingest/x", nil)
	srv.notifySlackCustomEvents(site, []store.CustomEvent{{Name: "checkout_error", Notify: true}}, req)

	select {
	case body := <-receiver.bodies:
		t.Fatalf("expected no delivery while disabled, got %s", body)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestNotifySlackCustomEventsNoFlaggedEventsSendsNothing(t *testing.T) {
	srv, _ := newTestServer(t)
	site := mustCreateNotifyTestSite(t, srv)
	receiver := newSlackReceiver(t, 0)
	setSiteSlackIntegrationForTest(t, srv, site.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:   store.SlackRoutingSingle,
		LogMatchMode:  store.SlackLogMatchContains,
		CustomEnabled: true,
	})
	req := httptest.NewRequest(http.MethodGet, "https://dash.example.com/api/ingest/x", nil)
	srv.notifySlackCustomEvents(site, []store.CustomEvent{{Name: "page_scroll", Notify: false}}, req)

	select {
	case body := <-receiver.bodies:
		t.Fatalf("expected no delivery when nothing is notify-flagged, got %s", body)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestNotifySlackCustomEventsCooldownIsPerUserAndError(t *testing.T) {
	srv, _ := newTestServer(t)
	site := mustCreateNotifyTestSite(t, srv)
	receiver := newSlackReceiver(t, 0)
	setSiteSlackIntegrationForTest(t, srv, site.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:   store.SlackRoutingSingle,
		LogMatchMode:  store.SlackLogMatchContains,
		CustomEnabled: true,
	})
	req := httptest.NewRequest(http.MethodGet, "https://dash.example.com/api/ingest/x", nil)
	errorDetails := json.RawMessage(`{"errorInfo":"TypeError: Cannot read properties of undefined (reading 'id')","pathname":"/inbox/interaction/abc123"}`)
	event := store.CustomEvent{
		Name:      "user_automatic_error_report",
		TrackID:   "franklin.mendez@replypro.io",
		Details:   errorDetails,
		Notify:    true,
		SessionID: "session-1",
	}

	srv.notifySlackCustomEvents(site, []store.CustomEvent{event}, req)
	_ = waitForSlackDelivery(t, receiver)

	// The same user/error within ten seconds is suppressed.
	srv.notifySlackCustomEvents(site, []store.CustomEvent{event}, req)
	select {
	case body := <-receiver.bodies:
		t.Fatalf("expected the duplicate user/error to be suppressed, got %s", body)
	case <-time.After(300 * time.Millisecond):
	}

	// A different error for the same user is still delivered.
	differentError := event
	differentError.Details = json.RawMessage(`{"errorInfo":"ReferenceError: missingData is not defined","pathname":"/inbox/interaction/abc123"}`)
	srv.notifySlackCustomEvents(site, []store.CustomEvent{differentError}, req)
	if body := waitForSlackDelivery(t, receiver); !strings.Contains(body, "ReferenceError: missingData is not defined") {
		t.Fatalf("expected the different error in the Slack payload: %s", body)
	}

	// The original error for a different user is independent.
	differentUser := event
	differentUser.TrackID = "another.user@replypro.io"
	srv.notifySlackCustomEvents(site, []store.CustomEvent{differentUser}, req)
	if body := waitForSlackDelivery(t, receiver); !strings.Contains(body, "another.user@replypro.io") {
		t.Fatalf("expected the different user's event in the Slack payload: %s", body)
	}
}

func TestIngestCustomNotifySendsSessionLinkToSlack(t *testing.T) {
	srv, ts := newTestServer(t)
	receiver := newSlackReceiver(t, 0)
	admin := login(t, ts.URL, "admin", "pw")
	resp := doReq(t, http.MethodPost, ts.URL+"/api/sites", admin, `{"name":"Acme","url":"https://acme.example"}`)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create site: got %d (%s)", resp.StatusCode, body)
	}
	var site store.Site
	if err := json.NewDecoder(resp.Body).Decode(&site); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()

	setSiteSlackIntegrationForTest(t, srv, site.ID, receiver.URL, store.SiteSlackIntegrationUpdate{
		RoutingMode:   store.SlackRoutingSingle,
		LogMatchMode:  store.SlackLogMatchContains,
		CustomEnabled: true,
	})
	if resp := postJSON(t, ts.URL+"/api/ingest/"+site.SiteKey,
		`{"type":"custom","session_id":"session-notify-1","events":[{"ts":1730000000000,"name":"user_automatic_error_report","track_id":"franklin.mendez@replypro.io","details":{"errorInfo":"TypeError: Cannot read properties of undefined (reading 'id')","pathname":"/inbox/interaction/abc123"},"notify":true}]}`,
		false); resp.StatusCode != http.StatusOK {
		t.Fatalf("custom ingest: got %d", resp.StatusCode)
	}

	body := waitForSlackDelivery(t, receiver)
	if !strings.Contains(body, "user_automatic_error_report") ||
		!strings.Contains(body, "TypeError: Cannot read properties of undefined (reading 'id')") ||
		!strings.Contains(body, "/inbox/interaction/abc123") ||
		!strings.Contains(body, ts.URL+"/replay/session-notify-1") {
		t.Fatalf("Slack payload missing custom event session link: %s", body)
	}
}

func TestOriginForPrefersPublicURL(t *testing.T) {
	srv := &Server{cfg: &Config{PublicURL: "https://dash.example.com"}}
	req := httptest.NewRequest(http.MethodGet, "http://internal:8080/x", nil)
	if got := srv.originFor(req); got != "https://dash.example.com" {
		t.Fatalf("originFor = %q, want the configured public URL", got)
	}
}

func TestOriginForDerivesFromRequestWithoutPublicURL(t *testing.T) {
	srv := &Server{cfg: &Config{}}
	req := httptest.NewRequest(http.MethodGet, "http://dash.example.com/x", nil)
	req.Host = "dash.example.com"
	if got := srv.originFor(req); got != "http://dash.example.com" {
		t.Fatalf("originFor = %q, want derived from the request", got)
	}
}
