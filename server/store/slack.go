package store

import (
	"database/sql"
	"strings"
	"time"
)

const (
	SlackRoutingSingle          = "single"
	SlackRoutingPerNotification = "per_notification"

	SlackLogMatchContains = "contains"
	SlackLogMatchExact    = "exact"

	// MaxSlackWebhookCiphertextLen bounds the encrypted blob (nonce + Slack URL
	// + AES-GCM tag): comfortably larger than any real incoming-webhook URL.
	MaxSlackWebhookCiphertextLen = 700
	MaxSlackMatchValueLen        = 500
)

func ValidSlackRoutingMode(v string) bool {
	return v == SlackRoutingSingle || v == SlackRoutingPerNotification
}

func ValidSlackLogMatchMode(v string) bool {
	return v == SlackLogMatchContains || v == SlackLogMatchExact
}

// SlackWebhookSecret is the encrypted-at-rest representation of one Slack
// incoming webhook. The store only ever holds ciphertext -- it cannot decrypt
// it, and it is never serialized directly to a dashboard response (see
// server/slack_api.go for the masked view built from this).
type SlackWebhookSecret struct {
	Ciphertext  []byte
	Fingerprint string
	Hint        string
}

// Configured reports whether a webhook has been saved, without needing the
// decryption key.
func (w SlackWebhookSecret) Configured() bool { return len(w.Ciphertext) > 0 }

// SlackIntegration is the full server-side record for the singleton Slack
// integration, ciphertext and all. It is an internal record for the server's
// notifier, not a JSON response type.
type SlackIntegration struct {
	RoutingMode string

	Common  SlackWebhookSecret
	Tickets SlackWebhookSecret
	Logs    SlackWebhookSecret
	System  SlackWebhookSecret

	TicketsEnabled bool
	LogsEnabled    bool
	SystemEnabled  bool

	LogMatchMode  string
	LogMatchValue string

	UpdatedAt int64
}

// WebhookFor resolves the webhook that should be used for one notification
// kind ("tickets", "logs" or "system") under the integration's current
// routing mode.
func (si SlackIntegration) WebhookFor(kind string) SlackWebhookSecret {
	if si.RoutingMode == SlackRoutingPerNotification {
		switch kind {
		case "tickets":
			return si.Tickets
		case "logs":
			return si.Logs
		case "system":
			return si.System
		default:
			return SlackWebhookSecret{}
		}
	}
	return si.Common
}

// SlackWebhookUpdate expresses one of three things for a single saved
// webhook on PUT: leave it alone (the zero value), replace it with a new
// encrypted secret (Set), or remove it entirely (Clear).
type SlackWebhookUpdate struct {
	Set    bool
	Clear  bool
	Secret SlackWebhookSecret
}

type SlackIntegrationUpdate struct {
	RoutingMode    string
	TicketsEnabled bool
	LogsEnabled    bool
	SystemEnabled  bool
	LogMatchMode   string
	LogMatchValue  string

	Common  SlackWebhookUpdate
	Tickets SlackWebhookUpdate
	Logs    SlackWebhookUpdate
	System  SlackWebhookUpdate
}

func (s *Store) GetSlackIntegration() (SlackIntegration, error) {
	var si SlackIntegration
	var common, tickets, logs, system []byte
	row := s.DB.QueryRow(`SELECT routing_mode,
		common_ciphertext, common_fingerprint, common_hint,
		tickets_enabled, tickets_ciphertext, tickets_fingerprint, tickets_hint,
		logs_enabled, logs_ciphertext, logs_fingerprint, logs_hint,
		logs_match_mode, logs_match_value,
		system_enabled, system_ciphertext, system_fingerprint, system_hint,
		updated_at
		FROM slack_integration WHERE id = 1`)
	if err := row.Scan(&si.RoutingMode,
		&common, &si.Common.Fingerprint, &si.Common.Hint,
		&si.TicketsEnabled, &tickets, &si.Tickets.Fingerprint, &si.Tickets.Hint,
		&si.LogsEnabled, &logs, &si.Logs.Fingerprint, &si.Logs.Hint,
		&si.LogMatchMode, &si.LogMatchValue,
		&si.SystemEnabled, &system, &si.System.Fingerprint, &si.System.Hint,
		&si.UpdatedAt,
	); err != nil {
		// The migration normally inserts the id=1 row. Preserve the disabled
		// defaults only for a genuinely missing row; surface schema/connection
		// errors to callers instead of silently hiding a broken store.
		if err == sql.ErrNoRows {
			return SlackIntegration{RoutingMode: SlackRoutingSingle, LogMatchMode: SlackLogMatchContains}, nil
		}
		return SlackIntegration{}, err
	}
	si.Common.Ciphertext = common
	si.Tickets.Ciphertext = tickets
	si.Logs.Ciphertext = logs
	si.System.Ciphertext = system
	return si, nil
}

func (s *Store) UpdateSlackIntegration(u SlackIntegrationUpdate) (SlackIntegration, error) {
	if !ValidSlackRoutingMode(u.RoutingMode) || !ValidSlackLogMatchMode(u.LogMatchMode) {
		return SlackIntegration{}, errBadJSON
	}
	if len(u.LogMatchValue) > MaxSlackMatchValueLen {
		return SlackIntegration{}, errBadJSON
	}
	now := time.Now().Unix()

	set := []string{"routing_mode=?", "tickets_enabled=?", "logs_enabled=?", "system_enabled=?",
		"logs_match_mode=?", "logs_match_value=?", "updated_at=?"}
	args := []any{u.RoutingMode, u.TicketsEnabled, u.LogsEnabled, u.SystemEnabled,
		u.LogMatchMode, u.LogMatchValue, now}

	apply := func(prefix string, wu SlackWebhookUpdate) error {
		switch {
		case wu.Clear:
			set = append(set, prefix+"_ciphertext=?", prefix+"_fingerprint=?", prefix+"_hint=?")
			args = append(args, []byte{}, "", "")
		case wu.Set:
			if len(wu.Secret.Ciphertext) > MaxSlackWebhookCiphertextLen {
				return errBadJSON
			}
			set = append(set, prefix+"_ciphertext=?", prefix+"_fingerprint=?", prefix+"_hint=?")
			args = append(args, wu.Secret.Ciphertext, wu.Secret.Fingerprint, wu.Secret.Hint)
		}
		return nil
	}
	if err := apply("common", u.Common); err != nil {
		return SlackIntegration{}, err
	}
	if err := apply("tickets", u.Tickets); err != nil {
		return SlackIntegration{}, err
	}
	if err := apply("logs", u.Logs); err != nil {
		return SlackIntegration{}, err
	}
	if err := apply("system", u.System); err != nil {
		return SlackIntegration{}, err
	}

	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO slack_integration (id) VALUES (1)`); err != nil {
		return SlackIntegration{}, err
	}
	q := `UPDATE slack_integration SET ` + strings.Join(set, ",") + ` WHERE id = 1`
	if _, err := s.DB.Exec(q, args...); err != nil {
		return SlackIntegration{}, err
	}
	return s.GetSlackIntegration()
}
