package main

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func createViewer(t *testing.T, ts string, admin *http.Cookie) *http.Cookie {
	t.Helper()
	resp := doReq(t, http.MethodPost, ts+"/api/users", admin, `{"username":"viewer1","password":"password123","role":"viewer"}`)
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("create viewer: got %d (%s)", resp.StatusCode, b)
	}
	resp.Body.Close()
	return login(t, ts, "viewer1", "password123")
}

func decodeSlackView(t *testing.T, resp *http.Response) slackIntegrationView {
	t.Helper()
	defer resp.Body.Close()
	var v slackIntegrationView
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestSlackIntegrationAdminOnly(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	viewer := createViewer(t, ts.URL, admin)

	if resp := doReq(t, http.MethodGet, ts.URL+"/api/integrations/slack", viewer, ""); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer GET: got %d, want 403", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodPut, ts.URL+"/api/integrations/slack", viewer, `{"routing_mode":"single","log_match_mode":"contains"}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer PUT: got %d, want 403", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodPost, ts.URL+"/api/integrations/slack/test", viewer, `{}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer test: got %d, want 403", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodGet, ts.URL+"/api/integrations/slack", nil, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous GET: got %d, want 401", resp.StatusCode)
	}
}

func TestSlackIntegrationGetDefaults(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodGet, ts.URL+"/api/integrations/slack", admin, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get: got %d", resp.StatusCode)
	}
	v := decodeSlackView(t, resp)
	if v.RoutingMode != "single" || v.LogMatchMode != "contains" {
		t.Fatalf("unexpected defaults: %+v", v)
	}
	if v.TicketsEnabled || v.LogsEnabled || v.SystemEnabled {
		t.Fatalf("expected every notification disabled by default: %+v", v)
	}
	if v.CommonWebhook.Configured || v.CommonWebhook.Hint != "" {
		t.Fatalf("expected no webhook configured by default: %+v", v.CommonWebhook)
	}
}

func TestSlackIntegrationPutValidation(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	put := func(body string) *http.Response {
		return doReq(t, http.MethodPut, ts.URL+"/api/integrations/slack", admin, body)
	}

	cases := map[string]string{
		"bad routing mode":        `{"routing_mode":"bogus","log_match_mode":"contains"}`,
		"bad log match mode":      `{"routing_mode":"single","log_match_mode":"bogus"}`,
		"non-https webhook":       `{"routing_mode":"single","log_match_mode":"contains","common_webhook":"http://hooks.slack.com/services/T/B/x"}`,
		"wrong webhook host":      `{"routing_mode":"single","log_match_mode":"contains","common_webhook":"https://evil.example/services/T/B/x"}`,
		"enabled without webhook": `{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":true}`,
	}
	for name, body := range cases {
		if resp := put(body); resp.StatusCode != http.StatusBadRequest {
			b, _ := io.ReadAll(resp.Body)
			t.Errorf("%s: got %d, want 400 (%s)", name, resp.StatusCode, b)
		}
	}

	overlong := make([]byte, 600)
	for i := range overlong {
		overlong[i] = 'a'
	}
	body := `{"routing_mode":"single","log_match_mode":"contains","log_match_value":"` + string(overlong) + `"}`
	if resp := put(body); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("overlong match value: got %d, want 400", resp.StatusCode)
	}
}

func TestSlackIntegrationPutMaskKeepAndClear(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	put := func(body string) *http.Response {
		return doReq(t, http.MethodPut, ts.URL+"/api/integrations/slack", admin, body)
	}

	webhook := "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop"
	resp := put(`{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":true,"common_webhook":"` + webhook + `"}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("initial save: got %d (%s)", resp.StatusCode, b)
	}
	v := decodeSlackView(t, resp)
	if !v.CommonWebhook.Configured || v.CommonWebhook.Hint != "http***mnop" {
		t.Fatalf("unexpected masked view after save: %+v", v.CommonWebhook)
	}
	if v.CommonWebhook.Hint == webhook {
		t.Fatal("the response must never contain the raw webhook")
	}

	// A blank webhook field on an unrelated update must keep the secret.
	resp = put(`{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":true}`)
	v = decodeSlackView(t, resp)
	if !v.CommonWebhook.Configured {
		t.Fatal("blank field on update must keep the existing secret")
	}

	// GET independently confirms it persisted, not just the PUT response.
	v = decodeSlackView(t, doReq(t, http.MethodGet, ts.URL+"/api/integrations/slack", admin, ""))
	if !v.CommonWebhook.Configured {
		t.Fatal("secret did not persist across a fresh GET")
	}

	// Explicit clear removes it, which also means tickets can no longer stay enabled.
	resp = put(`{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":true,"clear_common_webhook":true}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("clearing the only webhook while still enabled: got %d, want 400", resp.StatusCode)
	}
	resp = put(`{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":false,"clear_common_webhook":true}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("clear: got %d (%s)", resp.StatusCode, b)
	}
	v = decodeSlackView(t, resp)
	if v.CommonWebhook.Configured {
		t.Fatal("expected the webhook to be cleared")
	}
}

func TestSlackIntegrationPerNotificationRouting(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	put := func(body string) *http.Response {
		return doReq(t, http.MethodPut, ts.URL+"/api/integrations/slack", admin, body)
	}

	ticketsHook := "https://hooks.slack.com/services/T000/B000/tickets0000000"
	logsHook := "https://hooks.slack.com/services/T000/B000/logs00000000000"

	// Enabling system health with no system webhook must fail even though
	// tickets/logs webhooks exist, because per_notification does not fall
	// back to a shared webhook.
	resp := put(`{"routing_mode":"per_notification","log_match_mode":"contains",` +
		`"tickets_enabled":true,"tickets_webhook":"` + ticketsHook + `",` +
		`"logs_enabled":true,"logs_webhook":"` + logsHook + `",` +
		`"system_enabled":true}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("system enabled without its own webhook: got %d, want 400", resp.StatusCode)
	}

	systemHook := "https://hooks.slack.com/services/T000/B000/system000000000"
	resp = put(`{"routing_mode":"per_notification","log_match_mode":"contains",` +
		`"tickets_enabled":true,"tickets_webhook":"` + ticketsHook + `",` +
		`"logs_enabled":true,"logs_webhook":"` + logsHook + `",` +
		`"system_enabled":true,"system_webhook":"` + systemHook + `"}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("full per-notification save: got %d (%s)", resp.StatusCode, b)
	}
	v := decodeSlackView(t, resp)
	if !v.TicketsWebhook.Configured || !v.LogsWebhook.Configured || !v.SystemWebhook.Configured {
		t.Fatalf("expected all three webhooks configured: %+v", v)
	}
	if v.CommonWebhook.Configured {
		t.Fatal("per_notification mode must not populate the shared common webhook")
	}
}

func TestSlackIntegrationTestEndpointRequiresConfiguredWebhook(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/integrations/slack/test", admin, `{}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("test with nothing configured: got %d, want 400", resp.StatusCode)
	}
}
