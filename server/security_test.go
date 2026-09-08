package main

import (
	"net/http"
	"testing"
)

func TestSecurityHeadersDenyDeviceAndLocalNetworkAccess(t *testing.T) {
	_, ts := newTestServer(t)

	resp, err := http.Get(ts.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	want := "camera=(), microphone=(), geolocation=(), local-network=(), loopback-network=(), local-network-access=()"
	if got := resp.Header.Get("Permissions-Policy"); got != want {
		t.Fatalf("Permissions-Policy = %q, want %q", got, want)
	}
}
