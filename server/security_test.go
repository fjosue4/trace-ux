package main

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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

// script-src must pin the dashboard's inline bootstrap script by hash instead
// of blanket-allowing inline script, so an injected <script> cannot execute.
func TestContentSecurityPolicyHashesInlineScripts(t *testing.T) {
	root := t.TempDir()
	dist := filepath.Join(root, "dashboard", "dist")
	if err := os.MkdirAll(dist, 0o755); err != nil {
		t.Fatal(err)
	}
	inline := "\n      document.documentElement.dataset.theme = 'dark';\n    "
	index := "<!doctype html><html><head><script>" + inline +
		"</script><script type=\"module\" src=\"/assets/app.js\"></script></head><body></body></html>"
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte(index), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := &Server{cfg: &Config{DevStaticDir: root}}
	csp := srv.contentSecurityPolicy()

	sum := sha256.Sum256([]byte(inline))
	want := "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	if !strings.Contains(csp, "script-src 'self' "+want+";") {
		t.Fatalf("CSP = %q, want script-src to pin %s", csp, want)
	}
	scriptSrc := csp[strings.Index(csp, "script-src"):]
	scriptSrc = scriptSrc[:strings.Index(scriptSrc, ";")]
	if strings.Contains(scriptSrc, "unsafe-inline") {
		t.Fatalf("script-src still allows unsafe-inline: %q", scriptSrc)
	}
	if strings.Contains(scriptSrc, "unsafe-eval") {
		t.Fatalf("script-src allows unsafe-eval: %q", scriptSrc)
	}
}

// A dashboard build we cannot read must not silently ship a policy that blocks
// its own bootstrap script and leaves an unusable page.
func TestContentSecurityPolicyFallsBackWhenIndexMissing(t *testing.T) {
	root := t.TempDir()
	// An existing but empty dist directory: dashboardFS resolves to it, so
	// index.html is genuinely unreadable rather than falling through to the
	// embedded copy.
	if err := os.MkdirAll(filepath.Join(root, "dashboard", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	srv := &Server{cfg: &Config{DevStaticDir: root}}
	if csp := srv.contentSecurityPolicy(); !strings.Contains(csp, "script-src 'self' 'unsafe-inline'") {
		t.Fatalf("CSP = %q, want the permissive fallback", csp)
	}
}
