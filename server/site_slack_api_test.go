package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"trace-ux/server/store"
)

func decodeSiteSlackView(t *testing.T, resp *http.Response) siteSlackIntegrationView {
	t.Helper()
	defer resp.Body.Close()
	var v siteSlackIntegrationView
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func siteSlackURL(ts string, siteID int64) string {
	return fmt.Sprintf("%s/api/sites/%d/integrations/slack", ts, siteID)
}

func TestSiteSlackIntegrationAdminOnly(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	admin := login(t, ts.URL, "admin", "pw")
	viewer := createViewer(t, ts.URL, admin)

	if resp := doReq(t, http.MethodGet, siteSlackURL(ts.URL, site.ID), viewer, ""); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer GET: got %d, want 403", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodPut, siteSlackURL(ts.URL, site.ID), viewer, `{"routing_mode":"single","log_match_mode":"contains"}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer PUT: got %d, want 403", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodPost, siteSlackURL(ts.URL, site.ID)+"/test", viewer, `{}`); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer test: got %d, want 403", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodGet, siteSlackURL(ts.URL, site.ID), nil, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous GET: got %d, want 401", resp.StatusCode)
	}
}

func TestSiteSlackIntegrationUnknownSiteNotFound(t *testing.T) {
	_, ts := newTestServer(t)
	admin := login(t, ts.URL, "admin", "pw")

	if resp := doReq(t, http.MethodGet, siteSlackURL(ts.URL, 999999), admin, ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("GET unknown site: got %d, want 404", resp.StatusCode)
	}
	if resp := doReq(t, http.MethodPut, siteSlackURL(ts.URL, 999999), admin, `{"routing_mode":"single","log_match_mode":"contains"}`); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("PUT unknown site: got %d, want 404", resp.StatusCode)
	}
}

func TestSiteSlackIntegrationGetDefaults(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodGet, siteSlackURL(ts.URL, site.ID), admin, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get: got %d", resp.StatusCode)
	}
	v := decodeSiteSlackView(t, resp)
	if v.RoutingMode != "single" || v.LogMatchMode != "contains" {
		t.Fatalf("unexpected defaults: %+v", v)
	}
	if v.TicketsEnabled || v.LogsEnabled || v.CustomEnabled {
		t.Fatalf("expected every notification disabled by default: %+v", v)
	}
	if v.CommonWebhook.Configured {
		t.Fatalf("expected no webhook configured by default: %+v", v.CommonWebhook)
	}
}

func TestSiteSlackIntegrationPutValidation(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	admin := login(t, ts.URL, "admin", "pw")
	put := func(body string) *http.Response {
		return doReq(t, http.MethodPut, siteSlackURL(ts.URL, site.ID), admin, body)
	}

	cases := map[string]string{
		"bad routing mode":               `{"routing_mode":"bogus","log_match_mode":"contains"}`,
		"bad log match mode":             `{"routing_mode":"single","log_match_mode":"bogus"}`,
		"non-https webhook":              `{"routing_mode":"single","log_match_mode":"contains","common_webhook":"http://hooks.slack.com/services/T/B/x"}`,
		"wrong webhook host":             `{"routing_mode":"single","log_match_mode":"contains","common_webhook":"https://evil.example/services/T/B/x"}`,
		"enabled without webhook":        `{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":true}`,
		"custom enabled without webhook": `{"routing_mode":"single","log_match_mode":"contains","custom_enabled":true}`,
	}
	for name, body := range cases {
		if resp := put(body); resp.StatusCode != http.StatusBadRequest {
			b, _ := io.ReadAll(resp.Body)
			t.Errorf("%s: got %d, want 400 (%s)", name, resp.StatusCode, b)
		}
	}
}

func TestSiteSlackIntegrationPutMaskKeepAndClear(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	admin := login(t, ts.URL, "admin", "pw")
	put := func(body string) *http.Response {
		return doReq(t, http.MethodPut, siteSlackURL(ts.URL, site.ID), admin, body)
	}

	webhook := "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop"
	resp := put(`{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":true,"common_webhook":"` + webhook + `"}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("initial save: got %d (%s)", resp.StatusCode, b)
	}
	v := decodeSiteSlackView(t, resp)
	if !v.CommonWebhook.Configured || v.CommonWebhook.Hint != "***mnop" {
		t.Fatalf("unexpected masked view after save: %+v", v.CommonWebhook)
	}

	// A blank webhook field on an unrelated update must keep the secret.
	resp = put(`{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":true}`)
	v = decodeSiteSlackView(t, resp)
	if !v.CommonWebhook.Configured {
		t.Fatal("blank field on update must keep the existing secret")
	}

	v = decodeSiteSlackView(t, doReq(t, http.MethodGet, siteSlackURL(ts.URL, site.ID), admin, ""))
	if !v.CommonWebhook.Configured {
		t.Fatal("secret did not persist across a fresh GET")
	}

	resp = put(`{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":true,"clear_common_webhook":true}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("clearing the only webhook while still enabled: got %d, want 400", resp.StatusCode)
	}
	resp = put(`{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":false,"clear_common_webhook":true}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("clear: got %d (%s)", resp.StatusCode, b)
	}
	v = decodeSiteSlackView(t, resp)
	if v.CommonWebhook.Configured {
		t.Fatal("expected the webhook to be cleared")
	}
}

func TestSiteSlackIntegrationPerNotificationRouting(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	admin := login(t, ts.URL, "admin", "pw")
	put := func(body string) *http.Response {
		return doReq(t, http.MethodPut, siteSlackURL(ts.URL, site.ID), admin, body)
	}

	ticketsHook := "https://hooks.slack.com/services/T000/B000/tickets0000000"

	// Enabling logs with no logs webhook must fail even though tickets has
	// one, because per_notification does not fall back to a shared webhook.
	resp := put(`{"routing_mode":"per_notification","log_match_mode":"contains",` +
		`"tickets_enabled":true,"tickets_webhook":"` + ticketsHook + `",` +
		`"logs_enabled":true}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("logs enabled without its own webhook: got %d, want 400", resp.StatusCode)
	}

	logsHook := "https://hooks.slack.com/services/T000/B000/logs00000000000"
	customHook := "https://hooks.slack.com/services/T000/B000/custom000000000"
	resp = put(`{"routing_mode":"per_notification","log_match_mode":"contains",` +
		`"tickets_enabled":true,"tickets_webhook":"` + ticketsHook + `",` +
		`"logs_enabled":true,"logs_webhook":"` + logsHook + `",` +
		`"custom_enabled":true,"custom_webhook":"` + customHook + `"}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("full per-notification save: got %d (%s)", resp.StatusCode, b)
	}
	v := decodeSiteSlackView(t, resp)
	if !v.TicketsWebhook.Configured || !v.LogsWebhook.Configured || !v.CustomWebhook.Configured {
		t.Fatalf("expected all three webhooks configured: %+v", v)
	}
	if v.CommonWebhook.Configured {
		t.Fatal("per_notification mode must not populate the shared common webhook")
	}
}

func TestSiteSlackIntegrationIsIndependentPerSiteViaAPI(t *testing.T) {
	srv, ts := newTestServer(t)
	siteA, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	siteB, err := srv.store.CreateSite("Beta", "https://beta.example")
	if err != nil {
		t.Fatal(err)
	}
	admin := login(t, ts.URL, "admin", "pw")

	webhook := "https://hooks.slack.com/services/T000/B000/siteaonlywebhook"
	resp := doReq(t, http.MethodPut, siteSlackURL(ts.URL, siteA.ID), admin,
		`{"routing_mode":"single","log_match_mode":"contains","tickets_enabled":true,"common_webhook":"`+webhook+`"}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("configure site A: got %d (%s)", resp.StatusCode, b)
	}

	vB := decodeSiteSlackView(t, doReq(t, http.MethodGet, siteSlackURL(ts.URL, siteB.ID), admin, ""))
	if vB.TicketsEnabled || vB.CommonWebhook.Configured {
		t.Fatalf("site B must be unaffected by site A's configuration: %+v", vB)
	}
}

func TestSiteSlackIntegrationTestEndpointRequiresConfiguredWebhook(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	admin := login(t, ts.URL, "admin", "pw")

	resp := doReq(t, http.MethodPost, siteSlackURL(ts.URL, site.ID)+"/test", admin, `{}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("test with nothing configured: got %d, want 400", resp.StatusCode)
	}
}

func TestSiteSlackLogMatchesAPI(t *testing.T) {
	srv, ts := newTestServer(t)
	site, err := srv.store.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	admin := login(t, ts.URL, "admin", "pw")
	put := func(body string) *http.Response {
		return doReq(t, http.MethodPut, siteSlackURL(ts.URL, site.ID), admin, body)
	}
	decode := func(resp *http.Response) siteSlackIntegrationView {
		t.Helper()
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("PUT: got %d", resp.StatusCode)
		}
		var v siteSlackIntegrationView
		if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}

	v := decode(put(`{"routing_mode":"single","log_matches":[{"mode":"contains","value":"TypeError"},{"mode":"exact","value":"Payment failed","severities":["error"]},{"mode":"contains","value":""},{"mode":"contains","value":"","severities":["warn"]}]}`))
	if len(v.LogMatches) != 3 || v.LogMatches[1].Value != "Payment failed" || v.LogMatchValue != "TypeError" {
		t.Fatalf("saved matches = %+v (first %q), want three rules with TypeError first", v.LogMatches, v.LogMatchValue)
	}
	if got := v.LogMatches[1].Severities; len(got) != 1 || got[0] != "error" {
		t.Fatalf("rule severities = %v, want [error]", got)
	}
	if got := v.LogMatches[2]; got.Value != "" || len(got.Severities) != 1 || got.Severities[0] != "warn" {
		t.Fatalf("severity-only rule = %+v, want every warning", got)
	}

	// Clients that predate rule lists still send the single pair.
	v = decode(put(`{"routing_mode":"single","log_match_mode":"exact","log_match_value":"Checkout failed"}`))
	if len(v.LogMatches) != 1 || v.LogMatches[0].Mode != "exact" || v.LogMatches[0].Value != "Checkout failed" {
		t.Fatalf("legacy single pair saved as %+v, want one exact rule", v.LogMatches)
	}

	v = decode(put(`{"routing_mode":"single","log_matches":[]}`))
	if len(v.LogMatches) != 0 {
		t.Fatalf("empty list saved as %+v, want none", v.LogMatches)
	}

	var many strings.Builder
	many.WriteString(`{"routing_mode":"single","log_matches":[`)
	for i := 0; i <= store.MaxSlackLogMatches; i++ {
		if i > 0 {
			many.WriteString(",")
		}
		fmt.Fprintf(&many, `{"mode":"contains","value":"p%d"}`, i)
	}
	many.WriteString(`]}`)
	for name, body := range map[string]string{
		"bad mode": `{"routing_mode":"single","log_matches":[{"mode":"regex","value":"x"}]}`,
		"too long": `{"routing_mode":"single","log_matches":[{"mode":"contains","value":"` + strings.Repeat("x", store.MaxSlackMatchValueLen+1) + `"}]}`,
		"too many": many.String(),
	} {
		resp := put(body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: got %d, want 400", name, resp.StatusCode)
		}
	}
}
