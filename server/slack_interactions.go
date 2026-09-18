package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	slackInteractionMaxBodyBytes  = 1 << 20
	slackInteractionTimestampSkew = 5 * time.Minute
)

// handleSlackInteraction is the Request URL for the Slack app that owns the
// incoming webhook. Slack sends URL-encoded payload=<json> bodies when a user
// clicks a Block Kit button, including buttons that also have a URL. The URL
// opens in Slack while this endpoint acknowledges the interaction.
func (s *Server) handleSlackInteraction(w http.ResponseWriter, r *http.Request) {
	signingSecret, err := s.slackInteractionSigningSecret()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not decrypt Slack signing secret")
		return
	}
	if strings.TrimSpace(signingSecret) == "" {
		writeErr(w, http.StatusServiceUnavailable, "Slack interactivity is not configured")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, slackInteractionMaxBodyBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "could not read Slack interaction")
		return
	}
	if len(body) > slackInteractionMaxBodyBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "Slack interaction is too large")
		return
	}
	if !verifySlackInteractionSignature(signingSecret, r, body) {
		writeErr(w, http.StatusUnauthorized, "invalid Slack signature")
		return
	}

	form, err := url.ParseQuery(string(body))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid Slack interaction form")
		return
	}
	payload := form.Get("payload")
	if payload == "" {
		writeErr(w, http.StatusBadRequest, "missing Slack interaction payload")
		return
	}
	var interaction struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal([]byte(payload), &interaction); err != nil || interaction.Type == "" {
		writeErr(w, http.StatusBadRequest, "invalid Slack interaction payload")
		return
	}

	// URL buttons open their configured link in Slack. No response body is
	// needed; the important part is acknowledging within Slack's three-second
	// deadline so it does not show an interaction error to the user.
	w.WriteHeader(http.StatusOK)
}

// The dashboard-managed secret takes precedence. The environment variable is
// retained as a migration path for deployments that configured Slack before
// the signing-secret field was added to the UI.
func (s *Server) slackInteractionSigningSecret() (string, error) {
	if s.store != nil {
		integration, err := s.store.GetSlackSystemIntegration()
		if err != nil {
			return "", err
		}
		if integration.SigningSecret.Configured() {
			return decryptSlackSigningSecret(s.secret, integration.SigningSecret.Ciphertext)
		}
	}
	if s.cfg == nil {
		return "", nil
	}
	return strings.TrimSpace(s.cfg.SlackSigningSecret), nil
}

func verifySlackInteractionSignature(signingSecret string, r *http.Request, body []byte) bool {
	timestamp := strings.TrimSpace(r.Header.Get("X-Slack-Request-Timestamp"))
	signature := strings.TrimSpace(r.Header.Get("X-Slack-Signature"))
	if timestamp == "" || signature == "" {
		return false
	}
	parsedTimestamp, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	delta := time.Now().Unix() - parsedTimestamp
	if delta > int64(slackInteractionTimestampSkew/time.Second) || delta < -int64(slackInteractionTimestampSkew/time.Second) {
		return false
	}

	mac := hmac.New(sha256.New, []byte(signingSecret))
	_, _ = mac.Write([]byte("v0:"))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte(":"))
	_, _ = mac.Write(body)
	expected := "v0=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}
