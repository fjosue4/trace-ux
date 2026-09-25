package store

import (
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
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
		SiteID:      site.ID,
		RoutingMode: SlackRoutingSingle,
		Common:      SlackWebhookUpdate{Set: true, Secret: common},
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
		SiteID:      site.ID,
		RoutingMode: SlackRoutingSingle,
		Common:      SlackWebhookUpdate{Clear: true},
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
	if _, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{SiteID: site.ID, RoutingMode: "bogus"}); err == nil {
		t.Fatal("expected an error for an invalid routing mode")
	}
	if _, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{SiteID: site.ID, RoutingMode: SlackRoutingSingle, LogMatches: []SlackLogMatch{{Mode: "bogus", Value: "x"}}}); err == nil {
		t.Fatal("expected an error for an invalid log match mode")
	}
}

func TestSiteSlackIntegrationDeletedWithSite(t *testing.T) {
	s := newSlackTestStore(t)
	site := mustCreateSlackTestSite(t, s)
	if _, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{
		SiteID:      site.ID,
		RoutingMode: SlackRoutingSingle,
		Common:      SlackWebhookUpdate{Set: true, Secret: SlackWebhookSecret{Ciphertext: []byte("x")}},
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

func TestSiteSlackLogMatchesRoundTrip(t *testing.T) {
	s := newSlackTestStore(t)
	site := mustCreateSlackTestSite(t, s)

	updated, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{
		SiteID:      site.ID,
		RoutingMode: SlackRoutingSingle,
		LogMatches: []SlackLogMatch{
			{Mode: SlackLogMatchContains, Value: "TypeError"},
			{Mode: "  ", Value: "   "}, // blank pattern: dropped
			{Mode: SlackLogMatchExact, Value: "Payment failed", Severities: []string{"error", "warn"}},
			{Mode: SlackLogMatchContains, Value: "TypeError"}, // duplicate: dropped
			{Mode: SlackLogMatchContains, Value: "", Severities: []string{"warn"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []SlackLogMatch{
		{Mode: SlackLogMatchContains, Value: "TypeError"},
		// Severities come back in canonical order.
		{Mode: SlackLogMatchExact, Value: "Payment failed", Severities: []string{"warn", "error"}},
		// A blank pattern is kept when it names severities: "every warning".
		{Mode: SlackLogMatchContains, Value: "", Severities: []string{"warn"}},
	}
	if !reflect.DeepEqual(updated.LogMatches, want) {
		t.Fatalf("stored matches = %+v, want %+v", updated.LogMatches, want)
	}
	if _, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{SiteID: site.ID, RoutingMode: SlackRoutingSingle,
		LogMatches: []SlackLogMatch{{Mode: SlackLogMatchContains, Value: "x", Severities: []string{"fatal"}}}}); err == nil {
		t.Fatal("expected an unknown severity to be rejected")
	}
	// The single-pattern columns mirror the first rule for older builds.
	if updated.LogMatchMode != SlackLogMatchContains || updated.LogMatchValue != "TypeError" {
		t.Fatalf("legacy mirror = %q/%q, want contains/TypeError", updated.LogMatchMode, updated.LogMatchValue)
	}

	cleared, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{SiteID: site.ID, RoutingMode: SlackRoutingSingle})
	if err != nil {
		t.Fatal(err)
	}
	if len(cleared.LogMatches) != 0 || cleared.LogMatchValue != "" {
		t.Fatalf("cleared matches = %+v / %q, want none", cleared.LogMatches, cleared.LogMatchValue)
	}

	tooMany := make([]SlackLogMatch, MaxSlackLogMatches+1)
	for i := range tooMany {
		tooMany[i] = SlackLogMatch{Mode: SlackLogMatchContains, Value: fmt.Sprintf("pattern-%d", i)}
	}
	if _, err := s.UpdateSiteSlackIntegration(SiteSlackIntegrationUpdate{SiteID: site.ID, RoutingMode: SlackRoutingSingle, LogMatches: tooMany}); err == nil {
		t.Fatalf("expected more than %d matches to be rejected", MaxSlackLogMatches)
	}
}

// The v25 migration turns an existing single pattern into a one-rule list; a
// blank pattern meant "every log" and stays an empty list.
func TestSlackLogMatchesMigrationFromSinglePattern(t *testing.T) {
	s := newSlackTestStore(t)
	withPattern := mustCreateSlackTestSite(t, s)
	blank, err := s.CreateSite("Blank", "https://blank.example")
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		id    int64
		mode  string
		value string
	}{{withPattern.ID, SlackLogMatchExact, "Checkout failed"}, {blank.ID, SlackLogMatchContains, ""}} {
		if _, err := s.DB.Exec(`INSERT INTO site_slack_integration (site_id, logs_match_mode, logs_match_value, logs_match_rules)
			VALUES (?, ?, ?, '[]')`, row.id, row.mode, row.value); err != nil {
			t.Fatal(err)
		}
	}
	migration := migrations[24] // v25
	if _, err := s.DB.Exec(migration[strings.Index(migration, "UPDATE"):]); err != nil {
		t.Fatal(err)
	}

	got, err := s.GetSiteSlackIntegration(withPattern.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got.LogMatches, []SlackLogMatch{{Mode: SlackLogMatchExact, Value: "Checkout failed"}}) {
		t.Fatalf("migrated matches = %+v, want the single exact rule", got.LogMatches)
	}
	gotBlank, err := s.GetSiteSlackIntegration(blank.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(gotBlank.LogMatches) != 0 {
		t.Fatalf("blank pattern migrated to %+v, want no rules", gotBlank.LogMatches)
	}
}
