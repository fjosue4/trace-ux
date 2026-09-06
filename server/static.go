package main

import (
	"embed"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

//go:embed all:static
var staticFS embed.FS

// newStaticHandler returns the SPA handler for the dashboard. In dev mode
// (WS_DEV_STATIC=<repo root>) it serves dashboard/dist from disk so frontend
// changes don't require rebuilding the Go binary.
func newStaticHandler(cfg Config) http.Handler {
	if cfg.DevStaticDir != "" {
		dir := filepath.Join(cfg.DevStaticDir, "dashboard", "dist")
		if _, err := os.Stat(dir); err == nil {
			return spaHandler(os.DirFS(dir))
		}
	}
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err) // embed FS layout is fixed at compile time
	}
	return spaHandler(sub)
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
