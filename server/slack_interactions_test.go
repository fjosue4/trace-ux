package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"trace-ux/server/store"
)

func signedSlackInteractionRequest(t *testing.T, secret, body string) *http.Request {
	t.Helper()
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte("v0:" + timestamp + ":" + body))
	req := httptest.NewRequest(http.MethodPost, "/api/integrations/slack/interactions", strings.NewReader(body))
	req.Header.Set("X-Slack-Request-Timestamp", timestamp)
	req.Header.Set("X-Slack-Signature", "v0="+hex.EncodeToString(mac.Sum(nil)))
	return req
}

func TestHandleSlackInteractionAcknowledgesSignedButton(t *testing.T) {
	const secret = "slack-signing-secret"
	srv := &Server{cfg: &Config{SlackSigningSecret: secret}}
	req := signedSlackInteractionRequest(t, secret, `payload=%7B%22type%22%3A%22block_actions%22%7D`)
	res := httptest.NewRecorder()

	srv.handleSlackInteraction(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", res.Code, res.Body.String())
	}
}

func TestHandleSlackInteractionUsesDashboardSigningSecret(t *testing.T) {
	srv, _ := newTestServer(t)
	const secret = "dashboard-signing-secret"
	ciphertext, err := encryptSlackSigningSecret(srv.secret, secret)
	if err != nil {
		t.Fatal(err)
	}
	_, err = srv.store.UpdateSlackSystemIntegration(store.SlackSystemIntegrationUpdate{
		SigningSecret: store.SlackWebhookUpdate{Set: true, Secret: store.SlackWebhookSecret{Ciphertext: ciphertext}},
	})
	if err != nil {
		t.Fatal(err)
	}

	req := signedSlackInteractionRequest(t, secret, `payload=%7B%22type%22%3A%22block_actions%22%7D`)
	res := httptest.NewRecorder()
	srv.handleSlackInteraction(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", res.Code, res.Body.String())
	}
}

func TestHandleSlackInteractionRejectsInvalidSignature(t *testing.T) {
	srv := &Server{cfg: &Config{SlackSigningSecret: "slack-signing-secret"}}
	req := httptest.NewRequest(http.MethodPost, "/api/integrations/slack/interactions", strings.NewReader(`payload=%7B%22type%22%3A%22block_actions%22%7D`))
	req.Header.Set("X-Slack-Request-Timestamp", strconv.FormatInt(time.Now().Unix(), 10))
	req.Header.Set("X-Slack-Signature", "v0=invalid")
	res := httptest.NewRecorder()

	srv.handleSlackInteraction(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", res.Code)
	}
}
