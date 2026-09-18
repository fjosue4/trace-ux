package store

import (
	"path/filepath"
	"testing"
)

func newSlackTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func mustCreateSlackTestSite(t *testing.T, s *Store) Site {
	t.Helper()
	site, err := s.CreateSite("Acme", "https://acme.example")
	if err != nil {
		t.Fatal(err)
	}
	return site
}

// ---- System health (instance-wide) ----

func TestSlackSystemIntegrationDefaultsToDisabled(t *testing.T) {
	s := newSlackTestStore(t)
	integ, err := s.GetSlackSystemIntegration()
	if err != nil {
		t.Fatal(err)
	}
	if integ.Enabled || integ.Webhook.Configured() {
		t.Fatalf("expected a fresh install to have system health disabled and unconfigured: %+v", integ)
	}
}

func TestSlackSystemIntegrationSetKeepAndClearSemantics(t *testing.T) {
	s := newSlackTestStore(t)

	webhook := SlackWebhookSecret{Ciphertext: []byte("ciphertext-1"), Fingerprint: "fp1", Hint: "https***aaaa"}
	updated, err := s.UpdateSlackSystemIntegration(SlackSystemIntegrationUpdate{
		Enabled: true,
		Webhook: SlackWebhookUpdate{Set: true, Secret: webhook},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Enabled || !updated.Webhook.Configured() || updated.Webhook.Fingerprint != "fp1" {
		t.Fatalf("webhook/enabled flag not saved: %+v", updated)
	}

	// Leaving Webhook as the zero value keeps the existing secret.
	updated, err = s.UpdateSlackSystemIntegration(SlackSystemIntegrationUpdate{Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Webhook.Configured() || updated.Webhook.Fingerprint != "fp1" {
		t.Fatalf("keep semantics lost the secret: %+v", updated.Webhook)
	}

	updated, err = s.UpdateSlackSystemIntegration(SlackSystemIntegrationUpdate{
		Enabled: false,
		Webhook: SlackWebhookUpdate{Clear: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Webhook.Configured() {
		t.Fatal("clear did not remove the secret")
	}
	if fetched, err := s.GetSlackSystemIntegration(); err != nil || fetched.Webhook.Configured() {
		t.Fatalf("clear did not persist across a fresh read: %+v, err=%v", fetched, err)
	}
}

// ---- Per-site tickets/logs/custom-event notifications ----

func TestSiteSlackIntegrationDefaultsToDisabled(t *testing.T) {
	s := newSlackTestStore(t)
	site := mustCreateSlackTestSite(t, s)

	integ, err := s.GetSiteSlackIntegration(site.ID)
	if err != nil {
		t.Fatal(err)
	}
	if integ.SiteID != site.ID {
		t.Fatalf("site id = %d, want %d", integ.SiteID, site.ID)
	}
	if integ.RoutingMode != SlackRoutingSingle || integ.LogMatchMode != SlackLogMatchContains {
		t.Fatalf("unexpected defaults: %+v", integ)
	}
	if integ.TicketsEnabled || integ.LogsEnabled || integ.CustomEnabled {
		t.Fatal("a site with no configured integration must have every notification disabled")
	}
	if integ.Common.Configured() || integ.Tickets.Configured() || integ.Logs.Configured() || integ.Custom.Configured() {
		t.Fatal("a site with no configured integration must have no webhooks configured")
	}
}

func TestSiteSlackIntegrationIsIndependentPerSite(t *testing.T) {
	s := newSlackTestStore(t)
	siteA := mustCreateSlackTestSite(t, s)
	siteB, err := s.CreateSite("Beta", "https://beta.example")
	if err != nil {
		t.Fatal(err)
	}

	webhook := SlackWebhookSecret{Ciphertext: []byte("site-a-webhook"), Fingerprint: "fp-a", Hint: "https***aaaa"}
	if _, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{
		SiteID:         siteA.ID,
		RoutingMode:    SlackRoutingSingle,
		LogMatchMode:   SlackLogMatchContains,
		TicketsEnabled: true,
		Common:         SlackWebhookUpdate{Set: true, Secret: webhook},
	}); err != nil {
		t.Fatal(err)
	}

	integA, err := s.GetSiteSlackIntegration(siteA.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !integA.TicketsEnabled || !integA.Common.Configured() {
		t.Fatalf("site A should have its webhook configured: %+v", integA)
	}

	integB, err := s.GetSiteSlackIntegration(siteB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if integB.TicketsEnabled || integB.Common.Configured() {
		t.Fatalf("site B must be unaffected by site A's configuration: %+v", integB)
	}
}

func TestSiteSlackIntegrationSetKeepAndClearSemantics(t *testing.T) {
	s := newSlackTestStore(t)
	site := mustCreateSlackTestSite(t, s)

	common := SlackWebhookSecret{Ciphertext: []byte("ciphertext-1"), Fingerprint: "fp1", Hint: "https***aaaa"}
	updated, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{
		SiteID:       site.ID,
		RoutingMode:  SlackRoutingSingle,
		LogMatchMode: SlackLogMatchContains,
		Common:       SlackWebhookUpdate{Set: true, Secret: common},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Common.Configured() || updated.Common.Hint != "https***aaaa" {
		t.Fatalf("common webhook not saved: %+v", updated.Common)
	}

	// A blank/absent field (the zero SlackWebhookUpdate) must keep the
	// existing secret rather than wiping it.
	updated, err = s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{
		SiteID:         site.ID,
		RoutingMode:    SlackRoutingSingle,
		LogMatchMode:   SlackLogMatchContains,
		TicketsEnabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Common.Configured() || updated.Common.Fingerprint != "fp1" {
		t.Fatalf("keep semantics lost the secret: %+v", updated.Common)
	}
	if !updated.TicketsEnabled {
		t.Fatal("tickets_enabled did not persist")
	}

	updated, err = s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{
		SiteID:       site.ID,
		RoutingMode:  SlackRoutingSingle,
		LogMatchMode: SlackLogMatchContains,
		Common:       SlackWebhookUpdate{Clear: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Common.Configured() {
		t.Fatal("clear did not remove the secret")
	}
	if fetched, err := s.GetSiteSlackIntegration(site.ID); err != nil || fetched.Common.Configured() {
		t.Fatalf("clear did not persist across a fresh read: %+v, err=%v", fetched, err)
	}
}

func TestSiteSlackIntegrationRoutingResolution(t *testing.T) {
	common := SlackWebhookSecret{Ciphertext: []byte("common")}
	tickets := SlackWebhookSecret{Ciphertext: []byte("tickets")}
	custom := SlackWebhookSecret{Ciphertext: []byte("custom")}

	single := SiteSlackIntegration{RoutingMode: SlackRoutingSingle, Common: common, Tickets: tickets, Custom: custom}
	if got := single.WebhookFor("tickets"); string(got.Ciphertext) != "common" {
		t.Fatalf("single mode should always resolve to the common webhook, got %q", got.Ciphertext)
	}
	if got := single.WebhookFor("custom"); string(got.Ciphertext) != "common" {
		t.Fatalf("single mode should resolve custom events to the common webhook too, got %q", got.Ciphertext)
	}

	per := SiteSlackIntegration{RoutingMode: SlackRoutingPerNotification, Common: common, Tickets: tickets}
	if got := per.WebhookFor("tickets"); string(got.Ciphertext) != "tickets" {
		t.Fatalf("per_notification mode should use the tickets webhook, got %q", got.Ciphertext)
	}
	if got := per.WebhookFor("logs"); got.Configured() {
		t.Fatalf("per_notification mode must not fall back to the common webhook, got %+v", got)
	}
}

func TestSiteSlackIntegrationRejectsInvalidModes(t *testing.T) {
	s := newSlackTestStore(t)
	site := mustCreateSlackTestSite(t, s)
	if _, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{SiteID: site.ID, RoutingMode: "bogus", LogMatchMode: SlackLogMatchContains}); err == nil {
		t.Fatal("expected an error for an invalid routing mode")
	}
	if _, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{SiteID: site.ID, RoutingMode: SlackRoutingSingle, LogMatchMode: "bogus"}); err == nil {
		t.Fatal("expected an error for an invalid log match mode")
	}
}

func TestSiteSlackIntegrationDeletedWithSite(t *testing.T) {
	s := newSlackTestStore(t)
	site := mustCreateSlackTestSite(t, s)
	if _, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{
		SiteID:       site.ID,
		RoutingMode:  SlackRoutingSingle,
		LogMatchMode: SlackLogMatchContains,
		Common:       SlackWebhookUpdate{Set: true, Secret: SlackWebhookSecret{Ciphertext: []byte("x")}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteSite(site.ID); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM site_slack_integration WHERE site_id = ?`, site.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("deleting a site must cascade-delete its Slack integration row")
	}
}
