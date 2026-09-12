package main

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

//go:embed all:static
var staticFS embed.FS

// dashboardFS resolves the filesystem the SPA is served from. In dev mode
// (TRACE_UX_DEV_STATIC=<repo root>) that is dashboard/dist on disk, so frontend
// changes don't require rebuilding the Go binary.
func dashboardFS(cfg Config) fs.FS {
	if cfg.DevStaticDir != "" {
		dir := filepath.Join(cfg.DevStaticDir, "dashboard", "dist")
		if _, err := os.Stat(dir); err == nil {
			return os.DirFS(dir)
		}
	}
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err) // embed FS layout is fixed at compile time
	}
	return sub
}

// newStaticHandler returns the SPA handler for the dashboard.
func newStaticHandler(cfg Config) http.Handler {
	return spaHandler(dashboardFS(cfg))
}

var inlineScriptRe = regexp.MustCompile(`(?is)<script([^>]*)>(.*?)</script>`)

// scriptSrcDirective builds the CSP script-src for the dashboard. The SPA ships
// one inline bootstrap script (it sets the theme before first paint), which is
// pinned by hash so 'unsafe-inline' can be dropped — an injected <script> then
// has no matching hash and will not run. If index.html cannot be read we keep
// the permissive directive rather than serving a dashboard that cannot boot.
func scriptSrcDirective(cfg Config) string {
	index, err := fs.ReadFile(dashboardFS(cfg), "index.html")
	if err != nil {
		log.Printf("csp: cannot read index.html (%v); falling back to script-src 'unsafe-inline'", err)
		return "script-src 'self' 'unsafe-inline'"
	}
	directive := "script-src 'self'"
	for _, m := range inlineScriptRe.FindAllSubmatch(index, -1) {
		if bytes.Contains(bytes.ToLower(m[1]), []byte("src=")) {
			continue // external script, already covered by 'self'
		}
		sum := sha256.Sum256(m[2])
		directive += " 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	}
	return directive
}

// trackerBundle returns the tracker JS: dev dist if present, else embedded copy.
func trackerBundle(cfg Config) ([]byte, error) {
	if cfg.DevStaticDir != "" {
		p := filepath.Join(cfg.DevStaticDir, "tracker", "dist", "tracker.js")
		if b, err := os.ReadFile(p); err == nil {
			return b, nil
		}
	}
	b, err := staticFS.ReadFile("static/tracker.js")
	if err != nil {
		return nil, errors.New("tracker.js not embedded (run 'make build-tracker' or 'make build')")
	}
	return b, nil
}

// spaHandler serves files, falling back to index.html for client-side routes.
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServerFS(fsys)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(fsys, p); err != nil {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}
