package main

import (
	"net/http"
	"strings"

	"trace-ux/server/store"
)

// ---- Slack integration settings (admin only) ----
//
// GET/PUT never see or return a decryptable webhook: the dashboard gets a
// masked hint, and a blank field on PUT means "keep the current secret" so
// re-saving the form (e.g. to flip a switch) can't accidentally wipe it.

type slackWebhookView struct {
	Configured bool   `json:"configured"`
	Hint       string `json:"hint,omitempty"`
}

type slackIntegrationView struct {
	RoutingMode string `json:"routing_mode"`

	CommonWebhook slackWebhookView `json:"common_webhook"`

	TicketsEnabled bool             `json:"tickets_enabled"`
	TicketsWebhook slackWebhookView `json:"tickets_webhook"`

	LogsEnabled   bool             `json:"logs_enabled"`
	LogsWebhook   slackWebhookView `json:"logs_webhook"`
	LogMatchMode  string           `json:"log_match_mode"`
	LogMatchValue string           `json:"log_match_value"`

	SystemEnabled bool             `json:"system_enabled"`
	SystemWebhook slackWebhookView `json:"system_webhook"`

	UpdatedAt int64 `json:"updated_at"`
}

func slackWebhookViewFrom(w store.SlackWebhookSecret) slackWebhookView {
	return slackWebhookView{Configured: w.Configured(), Hint: w.Hint}
}

func slackIntegrationViewFrom(si store.SlackIntegration) slackIntegrationView {
	return slackIntegrationView{
		RoutingMode:    si.RoutingMode,
		CommonWebhook:  slackWebhookViewFrom(si.Common),
		TicketsEnabled: si.TicketsEnabled,
		TicketsWebhook: slackWebhookViewFrom(si.Tickets),
		LogsEnabled:    si.LogsEnabled,
		LogsWebhook:    slackWebhookViewFrom(si.Logs),
		LogMatchMode:   si.LogMatchMode,
		LogMatchValue:  si.LogMatchValue,
		SystemEnabled:  si.SystemEnabled,
		SystemWebhook:  slackWebhookViewFrom(si.System),
		UpdatedAt:      si.UpdatedAt,
	}
}

func (s *Server) handleGetSlackIntegration(w http.ResponseWriter, r *http.Request) {
	integ, err := s.store.GetSlackIntegration()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load slack settings")
		return
	}
	writeJSON(w, http.StatusOK, slackIntegrationViewFrom(integ))
}

type slackIntegrationPutRequest struct {
	RoutingMode    string `json:"routing_mode"`
	TicketsEnabled bool   `json:"tickets_enabled"`
	LogsEnabled    bool   `json:"logs_enabled"`
	SystemEnabled  bool   `json:"system_enabled"`
	LogMatchMode   string `json:"log_match_mode"`
	LogMatchValue  string `json:"log_match_value"`

	// Blank means "keep the current secret"; the corresponding clear_* flag
	// is the only way to remove one.
	CommonWebhook  string `json:"common_webhook,omitempty"`
	TicketsWebhook string `json:"tickets_webhook,omitempty"`
	LogsWebhook    string `json:"logs_webhook,omitempty"`
	SystemWebhook  string `json:"system_webhook,omitempty"`

	ClearCommonWebhook  bool `json:"clear_common_webhook,omitempty"`
	ClearTicketsWebhook bool `json:"clear_tickets_webhook,omitempty"`
	ClearLogsWebhook    bool `json:"clear_logs_webhook,omitempty"`
	ClearSystemWebhook  bool `json:"clear_system_webhook,omitempty"`
}

// resolvedSlackWebhook is what one PUT field decided to do, expressed both as
// a store update (ciphertext only) and as the resulting plaintext-derived
// secret (used to validate the final "enabled needs a webhook" state).
func (s *Server) resolveSlackWebhookField(clear bool, raw string, existing store.SlackWebhookSecret) (store.SlackWebhookUpdate, store.SlackWebhookSecret, error) {
	raw = strings.TrimSpace(raw)
	switch {
	case clear:
		return store.SlackWebhookUpdate{Clear: true}, store.SlackWebhookSecret{}, nil
	case raw != "":
		if err := validateSlackWebhookURL(raw); err != nil {
			return store.SlackWebhookUpdate{}, store.SlackWebhookSecret{}, err
		}
		ciphertext, err := encryptSlackWebhook(s.secret, raw)
		if err != nil {
			return store.SlackWebhookUpdate{}, store.SlackWebhookSecret{}, err
		}
		secret := store.SlackWebhookSecret{
			Ciphertext:  ciphertext,
			Fingerprint: slackWebhookFingerprint(raw),
			Hint:        slackWebhookHint(raw),
		}
		return store.SlackWebhookUpdate{Set: true, Secret: secret}, secret, nil
	default:
		return store.SlackWebhookUpdate{}, existing, nil // keep whatever is already saved
	}
}

func (s *Server) handlePutSlackIntegration(w http.ResponseWriter, r *http.Request) {
	var body slackIntegrationPutRequest
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	body.RoutingMode = strings.TrimSpace(body.RoutingMode)
	body.LogMatchMode = strings.TrimSpace(body.LogMatchMode)

	if !store.ValidSlackRoutingMode(body.RoutingMode) {
		writeErr(w, http.StatusBadRequest, "invalid routing mode")
		return
	}
	if !store.ValidSlackLogMatchMode(body.LogMatchMode) {
		writeErr(w, http.StatusBadRequest, "invalid log match mode")
		return
	}
	if len(body.LogMatchValue) > store.MaxSlackMatchValueLen {
		writeErr(w, http.StatusBadRequest, "log match pattern is too long")
		return
	}

	current, err := s.store.GetSlackIntegration()
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
	systemUpdate, systemFinal, err := s.resolveSlackWebhookField(body.ClearSystemWebhook, body.SystemWebhook, current.System)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid system webhook: "+err.Error())
		return
	}

	finalState := store.SlackIntegration{
		RoutingMode: body.RoutingMode,
		Common:      commonFinal,
		Tickets:     ticketsFinal,
		Logs:        logsFinal,
		System:      systemFinal,
	}
	if body.TicketsEnabled && !finalState.WebhookFor("tickets").Configured() {
		writeErr(w, http.StatusBadRequest, "ticket notifications need a configured webhook")
		return
	}
	if body.LogsEnabled && !finalState.WebhookFor("logs").Configured() {
		writeErr(w, http.StatusBadRequest, "log notifications need a configured webhook")
		return
	}
	if body.SystemEnabled && !finalState.WebhookFor("system").Configured() {
		writeErr(w, http.StatusBadRequest, "system health notifications need a configured webhook")
		return
	}

	updated, err := s.store.UpdateSlackIntegration(store.SlackIntegrationUpdate{
		RoutingMode:    body.RoutingMode,
		TicketsEnabled: body.TicketsEnabled,
		LogsEnabled:    body.LogsEnabled,
		SystemEnabled:  body.SystemEnabled,
		LogMatchMode:   body.LogMatchMode,
		LogMatchValue:  body.LogMatchValue,
		Common:         commonUpdate,
		Tickets:        ticketsUpdate,
		Logs:           logsUpdate,
		System:         systemUpdate,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save slack settings")
		return
	}
	writeJSON(w, http.StatusOK, slackIntegrationViewFrom(updated))
}

func (s *Server) handleTestSlackWebhook(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind string `json:"kind"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	body.Kind = strings.TrimSpace(body.Kind)

	integ, err := s.store.GetSlackIntegration()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load slack settings")
		return
	}
	if integ.RoutingMode == store.SlackRoutingPerNotification {
		switch body.Kind {
		case "tickets", "logs", "system":
		default:
			writeErr(w, http.StatusBadRequest, "kind must be tickets, logs, or system")
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
