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

// SlackWebhookUpdate expresses one of three things for a single saved
// webhook on PUT: leave it alone (the zero value), replace it with a new
// encrypted secret (Set), or remove it entirely (Clear).
type SlackWebhookUpdate struct {
	Set    bool
	Clear  bool
	Secret SlackWebhookSecret
}

func applySlackWebhookUpdate(set *[]string, args *[]any, prefix string, wu SlackWebhookUpdate) error {
	switch {
	case wu.Clear:
		*set = append(*set, prefix+"_ciphertext=?", prefix+"_fingerprint=?", prefix+"_hint=?")
		*args = append(*args, []byte{}, "", "")
	case wu.Set:
		if len(wu.Secret.Ciphertext) > MaxSlackWebhookCiphertextLen {
			return errBadJSON
		}
		*set = append(*set, prefix+"_ciphertext=?", prefix+"_fingerprint=?", prefix+"_hint=?")
		*args = append(*args, wu.Secret.Ciphertext, wu.Secret.Fingerprint, wu.Secret.Hint)
	}
	return nil
}

// ---- Instance-wide system health notification ----
//
// CPU/RAM/disk describe the TraceUX server itself, not any one site, so this
// stays a single global toggle+webhook rather than living per site.

type SlackSystemIntegration struct {
	Enabled       bool
	Webhook       SlackWebhookSecret
	SigningSecret SlackWebhookSecret
	UpdatedAt     int64
}

type SlackSystemIntegrationUpdate struct {
	Enabled       bool
	Webhook       SlackWebhookUpdate
	SigningSecret SlackWebhookUpdate
}

func (s *Store) GetSlackSystemIntegration() (SlackSystemIntegration, error) {
	var si SlackSystemIntegration
	var webhook, signing []byte
	row := s.DB.QueryRow(`SELECT system_enabled, system_ciphertext, system_fingerprint, system_hint,
		signing_ciphertext, signing_fingerprint, signing_hint, updated_at
		FROM slack_integration WHERE id = 1`)
	if err := row.Scan(&si.Enabled, &webhook, &si.Webhook.Fingerprint, &si.Webhook.Hint,
		&signing, &si.SigningSecret.Fingerprint, &si.SigningSecret.Hint, &si.UpdatedAt); err != nil {
		// The migration always inserts the id=1 row, but a fresh in-memory
		// store used only for schema checks might not have run it -- fall
		// back to disabled defaults rather than erroring.
		if err == sql.ErrNoRows {
			return SlackSystemIntegration{}, nil
		}
		return SlackSystemIntegration{}, err
	}
	si.Webhook.Ciphertext = webhook
	si.SigningSecret.Ciphertext = signing
	return si, nil
}

func (s *Store) UpdateSlackSystemIntegration(u SlackSystemIntegrationUpdate) (SlackSystemIntegration, error) {
	now := time.Now().Unix()
	set := []string{"system_enabled=?", "updated_at=?"}
	args := []any{u.Enabled, now}
	if err := applySlackWebhookUpdate(&set, &args, "system", u.Webhook); err != nil {
		return SlackSystemIntegration{}, err
	}
	if err := applySlackWebhookUpdate(&set, &args, "signing", u.SigningSecret); err != nil {
		return SlackSystemIntegration{}, err
	}
	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO slack_integration (id) VALUES (1)`); err != nil {
		return SlackSystemIntegration{}, err
	}
	q := `UPDATE slack_integration SET ` + strings.Join(set, ",") + ` WHERE id = 1`
	if _, err := s.DB.Exec(q, args...); err != nil {
		return SlackSystemIntegration{}, err
	}
	return s.GetSlackSystemIntegration()
}

// ---- Per-site notifications: tickets, browser logs, custom events ----
//
// Each of these events already belongs to one site, so the webhook that
// notifies about it is configured on that site rather than shared across the
// whole instance.

type SiteSlackIntegration struct {
	SiteID      int64
	RoutingMode string

	Common  SlackWebhookSecret
	Tickets SlackWebhookSecret
	Logs    SlackWebhookSecret
	Custom  SlackWebhookSecret

	TicketsEnabled bool
	LogsEnabled    bool
	CustomEnabled  bool

	LogMatchMode  string
	LogMatchValue string

	UpdatedAt int64
}

// WebhookFor resolves the webhook that should be used for one notification
// kind ("tickets", "logs" or "custom") under this site's routing mode.
func (si SiteSlackIntegration) WebhookFor(kind string) SlackWebhookSecret {
	if si.RoutingMode == SlackRoutingPerNotification {
		switch kind {
		case "tickets":
			return si.Tickets
		case "logs":
			return si.Logs
		case "custom":
			return si.Custom
		default:
			return SlackWebhookSecret{}
		}
	}
	return si.Common
}

type SiteSlackIntegrationUpdate struct {
	SiteID         int64
	RoutingMode    string
	TicketsEnabled bool
	LogsEnabled    bool
	CustomEnabled  bool
	LogMatchMode   string
	LogMatchValue  string

	Common  SlackWebhookUpdate
	Tickets SlackWebhookUpdate
	Logs    SlackWebhookUpdate
	Custom  SlackWebhookUpdate
}

func (s *Store) GetSiteSlackIntegration(siteID int64) (SiteSlackIntegration, error) {
	si := SiteSlackIntegration{SiteID: siteID, RoutingMode: SlackRoutingSingle, LogMatchMode: SlackLogMatchContains}
	var common, tickets, logs, custom []byte
	row := s.DB.QueryRow(`SELECT routing_mode,
		common_ciphertext, common_fingerprint, common_hint,
		tickets_enabled, tickets_ciphertext, tickets_fingerprint, tickets_hint,
		logs_enabled, logs_ciphertext, logs_fingerprint, logs_hint,
		logs_match_mode, logs_match_value,
		custom_enabled, custom_ciphertext, custom_fingerprint, custom_hint,
		updated_at
		FROM site_slack_integration WHERE site_id = ?`, siteID)
	err := row.Scan(&si.RoutingMode,
		&common, &si.Common.Fingerprint, &si.Common.Hint,
		&si.TicketsEnabled, &tickets, &si.Tickets.Fingerprint, &si.Tickets.Hint,
		&si.LogsEnabled, &logs, &si.Logs.Fingerprint, &si.Logs.Hint,
		&si.LogMatchMode, &si.LogMatchValue,
		&si.CustomEnabled, &custom, &si.Custom.Fingerprint, &si.Custom.Hint,
		&si.UpdatedAt,
	)
	if err != nil {
		// No row yet just means this site never configured Slack -- the
		// disabled/unconfigured zero value above is the correct answer, not
		// an error.
		if err == sql.ErrNoRows {
			return si, nil
		}
		return SiteSlackIntegration{}, err
	}
	si.Common.Ciphertext = common
	si.Tickets.Ciphertext = tickets
	si.Logs.Ciphertext = logs
	si.Custom.Ciphertext = custom
	return si, nil
}

func (s *Store) UpdateSiteSlackIntegration(u SiteSlackIntegrationUpdate) (SiteSlackIntegration, error) {
	if !ValidSlackRoutingMode(u.RoutingMode) || !ValidSlackLogMatchMode(u.LogMatchMode) {
		return SiteSlackIntegration{}, errBadJSON
	}
	if len(u.LogMatchValue) > MaxSlackMatchValueLen {
		return SiteSlackIntegration{}, errBadJSON
	}
	now := time.Now().Unix()

	set := []string{"routing_mode=?", "tickets_enabled=?", "logs_enabled=?", "custom_enabled=?",
		"logs_match_mode=?", "logs_match_value=?", "updated_at=?"}
	args := []any{u.RoutingMode, u.TicketsEnabled, u.LogsEnabled, u.CustomEnabled,
		u.LogMatchMode, u.LogMatchValue, now}

	if err := applySlackWebhookUpdate(&set, &args, "common", u.Common); err != nil {
		return SiteSlackIntegration{}, err
	}
	if err := applySlackWebhookUpdate(&set, &args, "tickets", u.Tickets); err != nil {
		return SiteSlackIntegration{}, err
	}
	if err := applySlackWebhookUpdate(&set, &args, "logs", u.Logs); err != nil {
		return SiteSlackIntegration{}, err
	}
	if err := applySlackWebhookUpdate(&set, &args, "custom", u.Custom); err != nil {
		return SiteSlackIntegration{}, err
	}

	if _, err := s.DB.Exec(`INSERT OR IGNORE INTO site_slack_integration (site_id) VALUES (?)`, u.SiteID); err != nil {
		return SiteSlackIntegration{}, err
	}
	args = append(args, u.SiteID)
	q := `UPDATE site_slack_integration SET ` + strings.Join(set, ",") + ` WHERE site_id = ?`
	if _, err := s.DB.Exec(q, args...); err != nil {
		return SiteSlackIntegration{}, err
	}
	return s.GetSiteSlackIntegration(u.SiteID)
}
