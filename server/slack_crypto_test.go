package main

import (
	"crypto/rand"
	"strings"
	"testing"
)

func testSecret(t *testing.T) []byte {
	t.Helper()
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	return secret
}

func TestSlackWebhookEncryptDecryptRoundTrip(t *testing.T) {
	secret := testSecret(t)
	const raw = "https://hooks.slack.com/services/T000/B000/abcdefghijklmnopqrstuvwx"

	ciphertext, err := encryptSlackWebhook(secret, raw)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(ciphertext), raw) {
		t.Fatal("ciphertext must not contain the plaintext webhook")
	}
	got, err := decryptSlackWebhook(secret, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if got != raw {
		t.Fatalf("decrypted = %q, want %q", got, raw)
	}
}

func TestSlackWebhookDecryptFailsOnTamperOrWrongKey(t *testing.T) {
	secret := testSecret(t)
	ciphertext, err := encryptSlackWebhook(secret, "https://hooks.slack.com/services/T000/B000/abcd")
	if err != nil {
		t.Fatal(err)
	}

	tampered := append([]byte(nil), ciphertext...)
	tampered[len(tampered)-1] ^= 0xFF
	if _, err := decryptSlackWebhook(secret, tampered); err == nil {
		t.Fatal("expected tampered ciphertext to fail authentication")
	}

	otherSecret := testSecret(t)
	if _, err := decryptSlackWebhook(otherSecret, ciphertext); err == nil {
		t.Fatal("expected decryption with the wrong key to fail")
	}
}

func TestValidateSlackWebhookURL(t *testing.T) {
	valid := "https://hooks.slack.com/services/T000/B000/abcdefghijklmnopqrstuvwx"
	if err := validateSlackWebhookURL(valid); err != nil {
		t.Fatalf("expected a real-looking Slack webhook URL to be valid, got %v", err)
	}

	cases := map[string]string{
		"http scheme":        "http://hooks.slack.com/services/T000/B000/abcd",
		"wrong host":         "https://evil.example/services/T000/B000/abcd",
		"internal host SSRF": "https://169.254.169.254/services/T000/B000/abcd",
		"no services prefix": "https://hooks.slack.com/T000/B000/abcd",
		"empty path":         "https://hooks.slack.com/services/",
		"query string":       "https://hooks.slack.com/services/T000/B000/abcd?x=1",
		"userinfo":           "https://user:pass@hooks.slack.com/services/T000/B000/abcd",
		"custom port":        "https://hooks.slack.com:8443/services/T000/B000/abcd",
		"empty":              "",
		"not a url":          "not a url",
	}
	for name, raw := range cases {
		if err := validateSlackWebhookURL(raw); err == nil {
			t.Errorf("%s: expected %q to be rejected", name, raw)
		}
	}
}

func TestSlackWebhookHintAndFingerprint(t *testing.T) {
	a := "https://hooks.slack.com/services/T000/B000/aaaaaaaaaaaaaaaa"
	b := "https://hooks.slack.com/services/T000/B000/bbbbbbbbbbbbbbbb"

	if got := slackWebhookHint(a); got != "***aaaa" {
		t.Fatalf("hint = %q, want a masked value ending in the last four characters", got)
	}
	if got := slackWebhookHint("short"); got != "***hort" {
		t.Fatalf("short hint = %q, want a masked value ending in the last four characters", got)
	}
	if slackWebhookFingerprint(a) == slackWebhookFingerprint(b) {
		t.Fatal("different webhooks must not share a fingerprint")
	}
	if slackWebhookFingerprint(a) != slackWebhookFingerprint(a) {
		t.Fatal("fingerprint must be deterministic")
	}
	if strings.Contains(slackWebhookFingerprint(a), a) {
		t.Fatal("fingerprint must not contain the raw URL")
	}
}
