package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"
)

const maxSlackWebhookURLLen = 512

var errInvalidSlackWebhook = errors.New("Slack webhooks must be an https://hooks.slack.com/services/... URL")

// slackWebhookAESKey derives a distinct AES-256 key from the server's auth
// secret (server/api.go's loadSecret) so encrypting webhook URLs never reuses
// the same key material as the ip_hash HMAC that secret otherwise salts.
func slackWebhookAESKey(secret []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte("trace-ux:slack-webhook-encryption:v1"))
	return mac.Sum(nil)
}

// encryptSlackWebhook seals a webhook URL with AES-256-GCM. The returned
// blob is nonce||ciphertext||tag; nothing about the plaintext is recoverable
// without the server's own secret.
func encryptSlackWebhook(secret []byte, plaintext string) ([]byte, error) {
	block, err := aes.NewCipher(slackWebhookAESKey(secret))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func decryptSlackWebhook(secret []byte, ciphertext []byte) (string, error) {
	block, err := aes.NewCipher(slackWebhookAESKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(ciphertext) < gcm.NonceSize() {
		return "", errors.New("slack webhook ciphertext is too short")
	}
	nonce, data := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, data, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// slackWebhookFingerprint is a stable, non-reversible identifier for a
// webhook URL, used so an admin can tell two saved secrets apart without
// either being decrypted.
func slackWebhookFingerprint(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	return hex.EncodeToString(sum[:])
}

// slackWebhookHint is the masked value shown in the dashboard, keeping only
// the last four characters of the saved value, e.g. "***abcd". Showing the
// URL's "http" prefix adds no useful recognition and makes the hint look like
// a broken URL.
func slackWebhookHint(rawURL string) string {
	runes := []rune(rawURL)
	if len(runes) == 0 {
		return ""
	}
	last := runes
	if len(last) > 4 {
		last = last[len(last)-4:]
	}
	return "***" + string(last)
}

// validateSlackWebhookURL accepts only Slack's own incoming-webhook hosts
// over HTTPS. This is the SSRF guard for the integration form: an admin (or
// anyone who compromises an admin session) cannot point a "webhook" at an
// internal address or another scheme, because the server only ever issues
// requests to a fixed, known-safe host.
func validateSlackWebhookURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxSlackWebhookURLLen {
		return errInvalidSlackWebhook
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return errInvalidSlackWebhook
	}
	if u.User != nil || u.Port() != "" || u.RawQuery != "" || u.Fragment != "" {
		return errInvalidSlackWebhook
	}
	switch strings.ToLower(u.Hostname()) {
	case "hooks.slack.com":
	default:
		return errInvalidSlackWebhook
	}
	if !strings.HasPrefix(u.Path, "/services/") || len(u.Path) <= len("/services/") {
		return errInvalidSlackWebhook
	}
	return nil
}

// redactWebhookError removes a literal webhook URL from an error string
// before it is logged -- net/http request errors otherwise embed the full
// request URL (e.g. `Get "https://hooks.slack.com/services/...": ...`).
func redactWebhookError(err error, webhookURL string) string {
	if err == nil {
		return ""
	}
	return strings.ReplaceAll(err.Error(), webhookURL, "[redacted]")
}
