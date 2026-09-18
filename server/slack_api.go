package main

import (
	"net/http"
	"strings"

	"trace-ux/server/store"
)

// ---- Slack integration settings: system health (instance-wide, admin only) ----
//
// CPU/RAM/disk describe the TraceUX server itself, not any one site, so this
// stays a single global toggle+webhook. Per-site notifications (tickets,
// browser logs, custom events) live in site_slack_api.go instead, since each
// of those events already belongs to one site.
//
// GET/PUT never see or return decryptable Slack secrets: the dashboard gets
// masked hints, and blank fields on PUT mean "keep the current secret" so
// re-saving the form (e.g. to flip a switch) can't accidentally wipe them.

type slackWebhookView struct {
	Configured bool   `json:"configured"`
	Hint       string `json:"hint,omitempty"`
}

func slackWebhookViewFrom(w store.SlackWebhookSecret) slackWebhookView {
	return slackWebhookView{Configured: w.Configured(), Hint: w.Hint}
}

type slackSystemIntegrationView struct {
	Enabled       bool             `json:"enabled"`
	Webhook       slackWebhookView `json:"webhook"`
	SigningSecret slackWebhookView `json:"signing_secret"`
	UpdatedAt     int64            `json:"updated_at"`
}

func slackSystemIntegrationViewFrom(si store.SlackSystemIntegration) slackSystemIntegrationView {
	return slackSystemIntegrationView{
		Enabled:       si.Enabled,
		Webhook:       slackWebhookViewFrom(si.Webhook),
		SigningSecret: slackWebhookViewFrom(si.SigningSecret),
		UpdatedAt:     si.UpdatedAt,
	}
}

func (s *Server) handleGetSlackIntegration(w http.ResponseWriter, r *http.Request) {
	integ, err := s.store.GetSlackSystemIntegration()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load slack settings")
		return
	}
	writeJSON(w, http.StatusOK, slackSystemIntegrationViewFrom(integ))
}

type slackSystemIntegrationPutRequest struct {
	Enabled bool `json:"enabled"`

	// Blank means "keep the current secret"; clear_webhook is the only way
	// to remove one.
	Webhook      string `json:"webhook,omitempty"`
	ClearWebhook bool   `json:"clear_webhook,omitempty"`

	SigningSecret      string `json:"signing_secret,omitempty"`
	ClearSigningSecret bool   `json:"clear_signing_secret,omitempty"`
}

// resolveSlackWebhookField is what one PUT field decided to do, expressed
// both as a store update (ciphertext only) and as the resulting
// plaintext-derived secret (used to validate the final "enabled needs a
// webhook" state). Shared with the per-site handlers in site_slack_api.go.
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

func (s *Server) resolveSlackSigningSecretField(clear bool, raw string, existing store.SlackWebhookSecret) (store.SlackWebhookUpdate, store.SlackWebhookSecret, error) {
	raw = strings.TrimSpace(raw)
	switch {
	case clear:
		return store.SlackWebhookUpdate{Clear: true}, store.SlackWebhookSecret{}, nil
	case raw != "":
		if len(raw) > maxSlackSigningSecretLen {
			return store.SlackWebhookUpdate{}, store.SlackWebhookSecret{}, errInvalidSlackSigningSecret
		}
		ciphertext, err := encryptSlackSigningSecret(s.secret, raw)
		if err != nil {
			return store.SlackWebhookUpdate{}, store.SlackWebhookSecret{}, err
		}
		secret := store.SlackWebhookSecret{
			Ciphertext:  ciphertext,
			Fingerprint: slackSecretFingerprint(raw),
			Hint:        slackSecretHint(raw),
		}
		return store.SlackWebhookUpdate{Set: true, Secret: secret}, secret, nil
	default:
		return store.SlackWebhookUpdate{}, existing, nil
	}
}

func (s *Server) handlePutSlackIntegration(w http.ResponseWriter, r *http.Request) {
	var body slackSystemIntegrationPutRequest
	if err := readJSON(w, r, &body); err != nil {
		return
	}

	current, err := s.store.GetSlackSystemIntegration()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load slack settings")
		return
	}

	webhookUpdate, webhookFinal, err := s.resolveSlackWebhookField(body.ClearWebhook, body.Webhook, current.Webhook)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid webhook: "+err.Error())
		return
	}
	signingUpdate, _, err := s.resolveSlackSigningSecretField(body.ClearSigningSecret, body.SigningSecret, current.SigningSecret)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid signing secret: "+err.Error())
		return
	}
	if body.Enabled && !webhookFinal.Configured() {
		writeErr(w, http.StatusBadRequest, "system health notifications need a configured webhook")
		return
	}

	updated, err := s.store.UpdateSlackSystemIntegration(store.SlackSystemIntegrationUpdate{
		Enabled:       body.Enabled,
		Webhook:       webhookUpdate,
		SigningSecret: signingUpdate,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save slack settings")
		return
	}
	writeJSON(w, http.StatusOK, slackSystemIntegrationViewFrom(updated))
}

func (s *Server) handleTestSlackWebhook(w http.ResponseWriter, r *http.Request) {
	integ, err := s.store.GetSlackSystemIntegration()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load slack settings")
		return
	}
	if !integ.Webhook.Configured() {
		writeErr(w, http.StatusBadRequest, "no webhook is configured for this notification")
		return
	}
	webhookURL, err := decryptSlackWebhook(s.secret, integ.Webhook.Ciphertext)
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
