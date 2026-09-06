package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const authCookie = "ws_auth"
const authTTL = 30 * 24 * time.Hour

type Server struct {
	store  *Store
	cfg    *Config
	secret []byte
	static http.Handler // SPA + assets
}

type Config struct {
	Addr          string
	DataDir       string
	Password      string
	RetentionDays int
	DevStaticDir  string // serve dashboard/tracker from disk instead of embed (dev)
}

func loadConfig() Config {
	cfg := Config{
		Addr:          envOr("WS_ADDR", ":8080"),
		DataDir:       envOr("WS_DATA", "./data"),
		Password:      os.Getenv("WS_PASSWORD"),
		RetentionDays: 90,
	}
	if v := os.Getenv("WS_RETENTION_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.RetentionDays = n
		}
	}
	cfg.DevStaticDir = os.Getenv("WS_DEV_STATIC")
	if cfg.Password == "" {
		log.Println("WARNING: WS_PASSWORD not set, using default password 'webshots'. Set WS_PASSWORD in production.")
		cfg.Password = "webshots"
	}
	return cfg
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// loadSecret returns the persisted HMAC secret used to sign auth cookies.
func loadSecret(dataDir string) ([]byte, error) {
	path := filepath.Join(dataDir, "secret.key")
	if b, err := os.ReadFile(path); err == nil && len(b) == 32 {
		return b, nil
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, os.WriteFile(path, b, 0o600)
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/me", s.auth(s.handleMe))

	mux.HandleFunc("GET /api/sites", s.auth(s.handleListSites))
	mux.HandleFunc("POST /api/sites", s.auth(s.handleCreateSite))
	mux.HandleFunc("DELETE /api/sites/{id}", s.auth(s.handleDeleteSite))

	// Public tracker-facing endpoints (permissive CORS, like all web analytics).
	mux.HandleFunc("GET /api/config/{siteKey}", s.handleConfig)
	mux.HandleFunc("POST /api/ingest/{siteKey}", s.handleIngest)

	mux.HandleFunc("GET /t.js", s.handleTracker)

	mux.Handle("/", s.static)

	return cors(mux)
}

// cors applies permissive CORS to public endpoints only; dashboard API is same-origin.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isPublic := strings.HasPrefix(r.URL.Path, "/api/ingest/") || strings.HasPrefix(r.URL.Path, "/api/config/")
		if isPublic {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Encoding")
			w.Header().Set("Access-Control-Max-Age", "86400")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// ---- Auth ----

func (s *Server) signAuth(expiry int64) string {
	mac := hmac.New(sha256.New, s.secret)
	fmt.Fprintf(mac, "%d", expiry)
	return fmt.Sprintf("%d.%s", expiry, hex.EncodeToString(mac.Sum(nil)))
}

func (s *Server) checkAuth(token string) bool {
	expStr, _, ok := strings.Cut(token, ".")
	if !ok {
		return false
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	expected := s.signAuth(exp)
	return subtle.ConstantTimeCompare([]byte(expected), []byte(token)) == 1
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(authCookie)
		if err != nil || !s.checkAuth(c.Value) {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	if subtle.ConstantTimeCompare([]byte(body.Password), []byte(s.cfg.Password)) != 1 {
		writeErr(w, http.StatusUnauthorized, "invalid password")
		return
	}
	exp := time.Now().Add(authTTL).Unix()
	http.SetCookie(w, &http.Cookie{
		Name:     authCookie,
		Value:    s.signAuth(exp),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(authTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: authCookie, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"authenticated": true})
}

// ---- Sites ----

func (s *Server) handleListSites(w http.ResponseWriter, r *http.Request) {
	sites, err := s.store.ListSites()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sites)
}

func (s *Server) handleCreateSite(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 100 {
		writeErr(w, http.StatusBadRequest, "name must be 1-100 characters")
		return
	}
	site, err := s.store.CreateSite(name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, site)
}

func (s *Server) handleDeleteSite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid site id")
		return
	}
	if err := s.store.DeleteSite(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---- Public tracker endpoints ----

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	site, err := s.store.GetSiteByKey(r.PathValue("siteKey"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if site.ID == 0 {
		writeErr(w, http.StatusNotFound, "unknown site key")
		return
	}
	// v1: fixed config; sampling and masking knobs arrive with the dashboard.
	writeJSON(w, http.StatusOK, map[string]any{
		"sample_rate":          1.0,
		"checkout_interval_ms": 30000,
		"mask_inputs":          true,
		"flush_interval_ms":    5000,
		"flush_batch_size":     20,
	})
}

// ---- Static / tracker serving ----

func (s *Server) handleTracker(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	body, err := trackerBundle(*s.cfg)
	if err != nil {
		log.Printf("tracker: %v", err)
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, "/* tracker bundle not built; run 'make build-tracker' */")
		return
	}
	w.Write(body)
}

// ---- JSON helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

var errBadJSON = errors.New("invalid JSON body")

func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10 MB batch cap
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, errBadJSON.Error())
		return err
	}
	return nil
}
