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

func decodeSlackSystemView(t *testing.T, resp *http.Response) slackSystemIntegrationView {
	t.Helper()
	defer resp.Body.Close()
	var v slackSystemIntegrationView
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestSlackSystemIntegrationAdminOnly(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	viewer := createViewer(t, ts.URL, admin)

	if resp := doReq(t, http.MethodGet, ts.URL+"/api/integrations/slack", viewer, ""); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer GET: got %d, want 403", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodPut, ts.URL+"/api/integrations/slack", viewer, `{"enabled":false}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer PUT: got %d, want 403", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodPost, ts.URL+"/api/integrations/slack/test", viewer, `{}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer test: got %d, want 403", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodGet, ts.URL+"/api/integrations/slack", nil, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous GET: got %d, want 401", resp.StatusCode)
	}
}

func TestSlackSystemIntegrationGetDefaults(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodGet, ts.URL+"/api/integrations/slack", admin, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get: got %d", resp.StatusCode)
	}
	v := decodeSlackSystemView(t, resp)
	if v.Enabled {
		t.Fatalf("expected system health notifications disabled by default: %+v", v)
	}
	if v.Webhook.Configured || v.Webhook.Hint != "" {
		t.Fatalf("expected no webhook configured by default: %+v", v.Webhook)
	}
}

func TestSlackSystemIntegrationPutValidation(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	put := func(body string) *http.Response {
		return doReq(t, http.MethodPut, ts.URL+"/api/integrations/slack", admin, body)
	}

	cases := map[string]string{
		"non-https webhook":       `{"enabled":false,"webhook":"http://hooks.slack.com/services/T/B/x"}`,
		"wrong webhook host":      `{"enabled":false,"webhook":"https://evil.example/services/T/B/x"}`,
		"enabled without webhook": `{"enabled":true}`,
	}
	for name, body := range cases {
		if resp := put(body); resp.StatusCode != http.StatusBadRequest {
			b, _ := io.ReadAll(resp.Body)
			t.Errorf("%s: got %d, want 400 (%s)", name, resp.StatusCode, b)
		}
	}
}

func TestSlackSystemIntegrationPutMaskKeepAndClear(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")
	put := func(body string) *http.Response {
		return doReq(t, http.MethodPut, ts.URL+"/api/integrations/slack", admin, body)
	}

	webhook := "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop"
	resp := put(`{"enabled":true,"webhook":"` + webhook + `"}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("initial save: got %d (%s)", resp.StatusCode, b)
	}
	v := decodeSlackSystemView(t, resp)
	if !v.Webhook.Configured || v.Webhook.Hint != "***mnop" {
		t.Fatalf("unexpected masked view after save: %+v", v.Webhook)
	}
	if v.Webhook.Hint == webhook {
		t.Fatal("the response must never contain the raw webhook")
	}

	// A blank webhook field on an unrelated update must keep the secret.
	resp = put(`{"enabled":true}`)
	v = decodeSlackSystemView(t, resp)
	if !v.Webhook.Configured {
		t.Fatal("blank field on update must keep the existing secret")
	}

	// GET independently confirms it persisted, not just the PUT response.
	v = decodeSlackSystemView(t, doReq(t, http.MethodGet, ts.URL+"/api/integrations/slack", admin, ""))
	if !v.Webhook.Configured {
		t.Fatal("secret did not persist across a fresh GET")
	}

	// Explicit clear removes it, which also means it can no longer stay enabled.
	resp = put(`{"enabled":true,"clear_webhook":true}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("clearing the only webhook while still enabled: got %d, want 400", resp.StatusCode)
	}
	resp = put(`{"enabled":false,"clear_webhook":true}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("clear: got %d (%s)", resp.StatusCode, b)
	}
	v = decodeSlackSystemView(t, resp)
	if v.Webhook.Configured {
		t.Fatal("expected the webhook to be cleared")
	}
}

func TestSlackSystemIntegrationTestEndpointRequiresConfiguredWebhook(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, ts.URL+"/api/integrations/slack/test", admin, `{}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("test with nothing configured: got %d, want 400", resp.StatusCode)
	}
}
