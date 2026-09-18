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

func TestSlackIntegrationDefaultsToDisabled(t *testing.T) {
	s := newSlackTestStore(t)
	integ, err := s.GetSlackIntegration()
	if err != nil {
		t.Fatal(err)
	}
	if integ.RoutingMode != SlackRoutingSingle {
		t.Fatalf("routing_mode = %q, want %q", integ.RoutingMode, SlackRoutingSingle)
	}
	if integ.LogMatchMode != SlackLogMatchContains {
		t.Fatalf("logs_match_mode = %q, want %q", integ.LogMatchMode, SlackLogMatchContains)
	}
	if integ.TicketsEnabled || integ.LogsEnabled || integ.SystemEnabled {
		t.Fatal("a fresh install must have every notification disabled")
	}
	if integ.Common.Configured() || integ.Tickets.Configured() || integ.Logs.Configured() || integ.System.Configured() {
		t.Fatal("a fresh install must have no webhooks configured")
	}
}

func TestSlackIntegrationSetKeepAndClearSemantics(t *testing.T) {
	s := newSlackTestStore(t)

	common := SlackWebhookSecret{Ciphertext: []byte("ciphertext-1"), Fingerprint: "fp1", Hint: "https***aaaa"}
	updated, err := s.UpdateSlackIntegration(SlackIntegrationUpdate{
		RoutingMode:   SlackRoutingSingle,
		LogMatchMode:  SlackLogMatchContains,
		LogMatchValue: "",
		Common:        SlackWebhookUpdate{Set: true, Secret: common},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Common.Configured() || updated.Common.Hint != "https***aaaa" {
		t.Fatalf("common webhook not saved: %+v", updated.Common)
	}

	// A blank/absent field (the zero SlackWebhookUpdate) must keep the
	// existing secret rather than wiping it -- this is what lets re-saving
	// the form to flip an unrelated switch not blow away the webhook.
	updated, err = s.UpdateSlackIntegration(SlackIntegrationUpdate{
		RoutingMode:    SlackRoutingSingle,
		LogMatchMode:   SlackLogMatchContains,
		TicketsEnabled: true,
		// Common left as the zero value: "keep".
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

	// An explicit clear removes it.
	updated, err = s.UpdateSlackIntegration(SlackIntegrationUpdate{
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

	if fetched, err := s.GetSlackIntegration(); err != nil || fetched.Common.Configured() {
		t.Fatalf("clear did not persist across a fresh read: %+v, err=%v", fetched, err)
	}
}

func TestSlackIntegrationRoutingResolution(t *testing.T) {
	common := SlackWebhookSecret{Ciphertext: []byte("common")}
	tickets := SlackWebhookSecret{Ciphertext: []byte("tickets")}

	single := SlackIntegration{RoutingMode: SlackRoutingSingle, Common: common, Tickets: tickets}
	if got := single.WebhookFor("tickets"); string(got.Ciphertext) != "common" {
		t.Fatalf("single mode should always resolve to the common webhook, got %q", got.Ciphertext)
	}
	if got := single.WebhookFor("logs"); string(got.Ciphertext) != "common" {
		t.Fatalf("single mode should always resolve to the common webhook, got %q", got.Ciphertext)
	}

	per := SlackIntegration{RoutingMode: SlackRoutingPerNotification, Common: common, Tickets: tickets}
	if got := per.WebhookFor("tickets"); string(got.Ciphertext) != "tickets" {
		t.Fatalf("per_notification mode should use the tickets webhook, got %q", got.Ciphertext)
	}
	if got := per.WebhookFor("logs"); got.Configured() {
		t.Fatalf("per_notification mode must not fall back to the common webhook, got %+v", got)
	}
}

func TestSlackIntegrationRejectsInvalidModes(t *testing.T) {
	s := newSlackTestStore(t)
	if _, err := s.UpdateSlackIntegration(SlackIntegrationUpdate{RoutingMode: "bogus", LogMatchMode: SlackLogMatchContains}); err == nil {
		t.Fatal("expected an error for an invalid routing mode")
	}
	if _, err := s.UpdateSlackIntegration(SlackIntegrationUpdate{RoutingMode: SlackRoutingSingle, LogMatchMode: "bogus"}); err == nil {
		t.Fatal("expected an error for an invalid log match mode")
	}
}
