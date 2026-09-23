package main

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"trace-ux/server/store"
)

// ---- Slack integration settings: per-site (tickets, browser logs, custom events) ----
//
// Each of these events already belongs to one site, so its Slack webhook is
// configured on that site's own Integrations tab rather than shared across
// the whole instance. System health has no site to attach to and is handled
// separately in slack_api.go.

type siteSlackIntegrationView struct {
	RoutingMode string `json:"routing_mode"`

	CommonWebhook slackWebhookView `json:"common_webhook"`

	TicketsEnabled bool             `json:"tickets_enabled"`
	TicketsWebhook slackWebhookView `json:"tickets_webhook"`

	LogsEnabled bool                  `json:"logs_enabled"`
	LogsWebhook slackWebhookView      `json:"logs_webhook"`
	LogMatches  []store.SlackLogMatch `json:"log_matches"`
	// The first rule, for dashboards that predate multiple rules.
	LogMatchMode  string `json:"log_match_mode"`
	LogMatchValue string `json:"log_match_value"`

	CustomEnabled bool             `json:"custom_enabled"`
	CustomWebhook slackWebhookView `json:"custom_webhook"`

	UpdatedAt int64 `json:"updated_at"`
}

func siteSlackIntegrationViewFrom(si store.SiteSlackIntegration) siteSlackIntegrationView {
	return siteSlackIntegrationView{
		RoutingMode:    si.RoutingMode,
		CommonWebhook:  slackWebhookViewFrom(si.Common),
		TicketsEnabled: si.TicketsEnabled,
		TicketsWebhook: slackWebhookViewFrom(si.Tickets),
		LogsEnabled:    si.LogsEnabled,
		LogsWebhook:    slackWebhookViewFrom(si.Logs),
		LogMatches:     si.LogMatches,
		LogMatchMode:   si.LogMatchMode,
		LogMatchValue:  si.LogMatchValue,
		CustomEnabled:  si.CustomEnabled,
		CustomWebhook:  slackWebhookViewFrom(si.Custom),
		UpdatedAt:      si.UpdatedAt,
	}
}

// siteIDFromPath parses and validates the {id} path segment shared by every
// site-scoped route, and confirms the site actually exists.
func (s *Server) siteIDFromPath(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return 0, false
	}
	site, _, _, _, err := s.store.GetSiteDetail(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return 0, false
	}
	if site == nil {
		writeErr(w, http.StatusNotFound, "site not found")
		return 0, false
	}
	return id, true
}

func (s *Server) handleGetSiteSlackIntegration(w http.ResponseWriter, r *http.Request) {
	id, ok := s.siteIDFromPath(w, r)
	if !ok {
		return
	}
	integ, err := s.store.GetSiteSlackIntegration(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load slack settings")
		return
	}
	writeJSON(w, http.StatusOK, siteSlackIntegrationViewFrom(integ))
}

type siteSlackIntegrationPutRequest struct {
	RoutingMode    string `json:"routing_mode"`
	TicketsEnabled bool   `json:"tickets_enabled"`
	LogsEnabled    bool   `json:"logs_enabled"`
	CustomEnabled  bool   `json:"custom_enabled"`
	// LogMatches replaces the single pattern. When it is absent, the legacy
	// log_match_mode/log_match_value pair is read as a one-rule list, so
	// older dashboards and scripts keep working.
	LogMatches    *[]store.SlackLogMatch `json:"log_matches,omitempty"`
	LogMatchMode  string                 `json:"log_match_mode"`
	LogMatchValue string                 `json:"log_match_value"`

	// Blank means "keep the current secret"; the corresponding clear_* flag
	// is the only way to remove one.
	CommonWebhook  string `json:"common_webhook,omitempty"`
	TicketsWebhook string `json:"tickets_webhook,omitempty"`
	LogsWebhook    string `json:"logs_webhook,omitempty"`
	CustomWebhook  string `json:"custom_webhook,omitempty"`

	ClearCommonWebhook  bool `json:"clear_common_webhook,omitempty"`
	ClearTicketsWebhook bool `json:"clear_tickets_webhook,omitempty"`
	ClearLogsWebhook    bool `json:"clear_logs_webhook,omitempty"`
	ClearCustomWebhook  bool `json:"clear_custom_webhook,omitempty"`
}

func (s *Server) handlePutSiteSlackIntegration(w http.ResponseWriter, r *http.Request) {
	id, ok := s.siteIDFromPath(w, r)
	if !ok {
		return
	}
	var body siteSlackIntegrationPutRequest
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	body.RoutingMode = strings.TrimSpace(body.RoutingMode)

	if !store.ValidSlackRoutingMode(body.RoutingMode) {
		writeErr(w, http.StatusBadRequest, "invalid routing mode")
		return
	}
	var requestedMatches []store.SlackLogMatch
	if body.LogMatches != nil {
		requestedMatches = *body.LogMatches
	} else {
		mode := strings.TrimSpace(body.LogMatchMode)
		if mode == "" {
			mode = store.SlackLogMatchContains
		}
		requestedMatches = []store.SlackLogMatch{{Mode: mode, Value: body.LogMatchValue}}
	}
	for _, rule := range requestedMatches {
		mode := strings.TrimSpace(rule.Mode)
		if mode != "" && !store.ValidSlackLogMatchMode(mode) {
			writeErr(w, http.StatusBadRequest, "invalid log match mode")
			return
		}
		if len(rule.Value) > store.MaxSlackMatchValueLen {
			writeErr(w, http.StatusBadRequest, "log match pattern is too long")
			return
		}
	}
	logMatches, err := store.NormalizeSlackLogMatches(requestedMatches)
	if err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("at most %d log matches are allowed", store.MaxSlackLogMatches))
		return
	}

	current, err := s.store.GetSiteSlackIntegration(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load slack settings")
		return
	}

	commonUpdate, commonFinal, err := s.resolveSlackWebhookField(body.ClearCommonWebhook, body.CommonWebhook, current.Common)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid common webhook: "+err.Error())
		return
	}
	ticketsUpdate, ticketsFinal, err := s.resolveSlackWebhookField(body.ClearTicketsWebhook, body.TicketsWebhook, current.Tickets)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid tickets webhook: "+err.Error())
		return
	}
	logsUpdate, logsFinal, err := s.resolveSlackWebhookField(body.ClearLogsWebhook, body.LogsWebhook, current.Logs)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid logs webhook: "+err.Error())
		return
	}
	customUpdate, customFinal, err := s.resolveSlackWebhookField(body.ClearCustomWebhook, body.CustomWebhook, current.Custom)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid custom webhook: "+err.Error())
		return
	}

	finalState := store.SiteSlackIntegration{
		RoutingMode: body.RoutingMode,
		Common:      commonFinal,
		Tickets:     ticketsFinal,
		Logs:        logsFinal,
		Custom:      customFinal,
	}
	if body.TicketsEnabled && !finalState.WebhookFor("tickets").Configured() {
		writeErr(w, http.StatusBadRequest, "ticket notifications need a configured webhook")
		return
	}
	if body.LogsEnabled && !finalState.WebhookFor("logs").Configured() {
		writeErr(w, http.StatusBadRequest, "log notifications need a configured webhook")
		return
	}
	if body.CustomEnabled && !finalState.WebhookFor("custom").Configured() {
		writeErr(w, http.StatusBadRequest, "custom event notifications need a configured webhook")
		return
	}

	updated, err := s.store.UpdateSiteSlackIntegration(store.SiteSlackIntegrationUpdate{
		SiteID:         id,
		RoutingMode:    body.RoutingMode,
		TicketsEnabled: body.TicketsEnabled,
		LogsEnabled:    body.LogsEnabled,
		CustomEnabled:  body.CustomEnabled,
		LogMatches:     logMatches,
		Common:         commonUpdate,
		Tickets:        ticketsUpdate,
		Logs:           logsUpdate,
		Custom:         customUpdate,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save slack settings")
		return
	}
	writeJSON(w, http.StatusOK, siteSlackIntegrationViewFrom(updated))
}

func (s *Server) handleTestSiteSlackWebhook(w http.ResponseWriter, r *http.Request) {
	id, ok := s.siteIDFromPath(w, r)
	if !ok {
		return
	}
	var body struct {
		Kind string `json:"kind"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	body.Kind = strings.TrimSpace(body.Kind)

	integ, err := s.store.GetSiteSlackIntegration(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load slack settings")
		return
	}
	if integ.RoutingMode == store.SlackRoutingPerNotification {
		switch body.Kind {
		case "tickets", "logs", "custom":
		default:
			writeErr(w, http.StatusBadRequest, "kind must be tickets, logs, or custom")
			return
		}
	}
	secret := integ.WebhookFor(body.Kind)
	if !secret.Configured() {
		writeErr(w, http.StatusBadRequest, "no webhook is configured for this notification")
		return
	}
	webhookURL, err := decryptSlackWebhook(s.secret, secret.Ciphertext)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not decrypt the saved webhook")
		return
	}
	msg := slackMessage{Text: "✅ TraceUX test notification — your Slack integration is working."}
	if err := s.postSlackMessage(webhookURL, msg, 1); err != nil {
		writeErr(w, http.StatusBadGateway, "Slack did not accept the test message")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
