package store

import (
	"database/sql"
	"encoding/json"
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
	// MaxSlackLogMatches bounds the rule list a site can store; every
	// captured log is checked against it on ingest.
	MaxSlackLogMatches = 50
)

// SlackLogMatch is one rule for which captured logs are posted to Slack. A log
// is posted when it matches any rule; an empty list posts every log that
// passes the site's severity settings. Within a rule, Severities (empty = any)
// and the pattern (blank = any message) must both match.
type SlackLogMatch struct {
	Mode       string   `json:"mode"`
	Value      string   `json:"value"`
	Severities []string `json:"severities,omitempty"`
}

// NormalizeSlackLogMatches trims each rule, puts its severities in canonical
// order, drops rules that would match every log (no pattern and no
// severities: they would make the other rules meaningless), and removes
// duplicate rules. It rejects unknown modes or severities, over-long patterns
// and oversized lists.
func NormalizeSlackLogMatches(rules []SlackLogMatch) ([]SlackLogMatch, error) {
	out := make([]SlackLogMatch, 0, len(rules))
	seen := make(map[string]bool, len(rules))
	for _, rule := range rules {
		rule.Mode = strings.TrimSpace(rule.Mode)
		if rule.Mode == "" {
			rule.Mode = SlackLogMatchContains
		}
		if !ValidSlackLogMatchMode(rule.Mode) {
			return nil, errBadJSON
		}
		if len(rule.Value) > MaxSlackMatchValueLen {
			return nil, errBadJSON
		}
		severities, err := normalizeLogSeverities(rule.Severities)
		if err != nil {
			return nil, errBadJSON
		}
		rule.Severities = nil
		if len(severities) > 0 {
			rule.Severities = severities
		}
		if strings.TrimSpace(rule.Value) == "" {
			rule.Value = ""
			if len(rule.Severities) == 0 {
				continue
			}
		}
		key := rule.Mode + "\x00" + rule.Value + "\x00" + strings.Join(rule.Severities, ",")
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, rule)
	}
	if len(out) > MaxSlackLogMatches {
		return nil, errBadJSON
	}
	return out, nil
}

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

	// LogMatches is the rule list; LogMatchMode/LogMatchValue mirror its first
	// rule for API clients and builds that predate multiple rules.
	LogMatches    []SlackLogMatch
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
	LogMatches     []SlackLogMatch

	Common  SlackWebhookUpdate
	Tickets SlackWebhookUpdate
	Logs    SlackWebhookUpdate
	Custom  SlackWebhookUpdate
}

func (s *Store) GetSiteSlackIntegration(siteID int64) (SiteSlackIntegration, error) {
	si := SiteSlackIntegration{SiteID: siteID, RoutingMode: SlackRoutingSingle, LogMatchMode: SlackLogMatchContains, LogMatches: []SlackLogMatch{}}
	var common, tickets, logs, custom []byte
	var rules string
	row := s.DB.QueryRow(`SELECT routing_mode,
		common_ciphertext, common_fingerprint, common_hint,
		tickets_enabled, tickets_ciphertext, tickets_fingerprint, tickets_hint,
		logs_enabled, logs_ciphertext, logs_fingerprint, logs_hint,
		logs_match_mode, logs_match_value, logs_match_rules,
		custom_enabled, custom_ciphertext, custom_fingerprint, custom_hint,
		updated_at
		FROM site_slack_integration WHERE site_id = ?`, siteID)
	err := row.Scan(&si.RoutingMode,
		&common, &si.Common.Fingerprint, &si.Common.Hint,
		&si.TicketsEnabled, &tickets, &si.Tickets.Fingerprint, &si.Tickets.Hint,
		&si.LogsEnabled, &logs, &si.Logs.Fingerprint, &si.Logs.Hint,
		&si.LogMatchMode, &si.LogMatchValue, &rules,
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
	if rules != "" {
		if err := json.Unmarshal([]byte(rules), &si.LogMatches); err != nil {
			return SiteSlackIntegration{}, err
		}
	}
	if si.LogMatches == nil {
		si.LogMatches = []SlackLogMatch{}
	}
	si.Common.Ciphertext = common
	si.Tickets.Ciphertext = tickets
	si.Logs.Ciphertext = logs
	si.Custom.Ciphertext = custom
	return si, nil
}

func (s *Store) UpdateSiteSlackIntegration(u SiteSlackIntegrationUpdate) (SiteSlackIntegration, error) {
	if !ValidSlackRoutingMode(u.RoutingMode) {
		return SiteSlackIntegration{}, errBadJSON
	}
	rules, err := NormalizeSlackLogMatches(u.LogMatches)
	if err != nil {
		return SiteSlackIntegration{}, err
	}
	encodedRules, err := json.Marshal(rules)
	if err != nil {
		return SiteSlackIntegration{}, err
	}
	// The legacy single-pattern columns mirror the first rule, so a rollback
	// to a build without rule lists keeps alerting on it.
	firstMode, firstValue := SlackLogMatchContains, ""
	if len(rules) > 0 {
		firstMode, firstValue = rules[0].Mode, rules[0].Value
	}
	now := time.Now().Unix()

	set := []string{"routing_mode=?", "tickets_enabled=?", "logs_enabled=?", "custom_enabled=?",
		"logs_match_mode=?", "logs_match_value=?", "logs_match_rules=?", "updated_at=?"}
	args := []any{u.RoutingMode, u.TicketsEnabled, u.LogsEnabled, u.CustomEnabled,
		firstMode, firstValue, string(encodedRules), now}

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
