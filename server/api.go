package main

import (
	"context"
	"crypto/rand"
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

type Server struct {
	store  *Store
	cfg    *Config
	secret []byte // HMAC salt for ip_hash (auth cookies are DB-backed now)
	static http.Handler // SPA + assets
}

type Config struct {
	Addr          string
	DataDir       string
	Password      string // bootstrap admin password (WS_PASSWORD)
	ResetAdmin    bool   // WS_RESET_ADMIN=1: re-point admin at WS_PASSWORD
	RetentionDays int
	DevStaticDir  string // serve dashboard/tracker from disk instead of embed (dev)
}

func loadConfig() Config {
	cfg := Config{
		Addr:          envOr("WS_ADDR", ":8080"),
		DataDir:       envOr("WS_DATA", "./data"),
		Password:      os.Getenv("WS_PASSWORD"),
		ResetAdmin:    os.Getenv("WS_RESET_ADMIN") == "1",
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
	mux.HandleFunc("POST /api/auth/password", s.auth(s.handleChangePassword))
	mux.HandleFunc("GET /api/auth/me", s.auth(s.handleMe))

	// User management: admin role only.
	mux.HandleFunc("GET /api/users", s.auth(s.requireAdmin(s.handleListUsers)))
	mux.HandleFunc("POST /api/users", s.auth(s.requireAdmin(s.handleCreateUser)))
	mux.HandleFunc("PATCH /api/users/{id}", s.auth(s.requireAdmin(s.handleUpdateUser)))
	mux.HandleFunc("DELETE /api/users/{id}", s.auth(s.requireAdmin(s.handleDeleteUser)))

	mux.HandleFunc("GET /api/sites", s.auth(s.handleListSites))
	mux.HandleFunc("POST /api/sites", s.auth(s.handleCreateSite))
	mux.HandleFunc("GET /api/sites/{id}", s.auth(s.handleGetSite))
	mux.HandleFunc("PATCH /api/sites/{id}", s.auth(s.requireAdmin(s.handleUpdateSite)))
	mux.HandleFunc("PUT /api/sites/{id}/settings", s.auth(s.requireAdmin(s.handlePutSiteSettings)))
	mux.HandleFunc("DELETE /api/sites/{id}", s.auth(s.handleDeleteSite))

	mux.HandleFunc("GET /api/sessions", s.auth(s.handleListSessions))
	mux.HandleFunc("GET /api/sessions/{id}", s.auth(s.handleGetSession))
	mux.HandleFunc("GET /api/sessions/{id}/events", s.auth(s.handleSessionEvents))
	mux.HandleFunc("DELETE /api/sessions/{id}", s.auth(s.requireAdmin(s.handleDeleteSession)))

	// Feedback & surveys from tracked sites.
	mux.HandleFunc("GET /api/feedback", s.auth(s.handleListFeedback))
	mux.HandleFunc("GET /api/feedback/summary", s.auth(s.handleFeedbackSummary))
	mux.HandleFunc("DELETE /api/feedback/{id}", s.auth(s.requireAdmin(s.handleDeleteFeedback)))

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

type ctxKey int

const userCtxKey ctxKey = 0

// currentUser returns the authenticated user attached by s.auth, or nil.
func currentUser(r *http.Request) *User {
	u, _ := r.Context().Value(userCtxKey).(*User)
	return u
}

// auth resolves the login cookie to a user via the auth_sessions table, so
// password changes, role changes and user deletion revoke access immediately.
func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(authCookie)
		if err != nil || c.Value == "" {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		u, err := s.store.UserForToken(c.Value)
		if err != nil || u == nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), userCtxKey, u)))
	}
}

// requireAdmin gates a handler to the admin role (user management).
func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if u := currentUser(r); u == nil || u.Role != "admin" {
			writeErr(w, http.StatusForbidden, "admin only")
			return
		}
		next(w, r)
	}
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	username := strings.TrimSpace(body.Username)
	if username == "" {
		username = "admin" // legacy single-password logins
	}
	// First boot after upgrade: seed the admin account from WS_PASSWORD.
	if err := s.store.EnsureAdmin(s.cfg.Password); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	rec, err := s.store.GetUserByUsername(username)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil || !verifyPassword(body.Password, rec.PasswordHash) {
		time.Sleep(200 * time.Millisecond) // blunt brute-force attempts
		writeErr(w, http.StatusUnauthorized, "invalid username or password")
		return
	}
	token, err := s.store.CreateAuthSession(rec.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     authCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(authSessionTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "user": rec.User})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(authCookie); err == nil && c.Value != "" {
		s.store.DeleteAuthSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: authCookie, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	writeJSON(w, http.StatusOK, map[string]string{"username": u.Username, "role": u.Role})
}

// handleChangePassword lets any logged-in user rotate their own password after
// confirming the current one. Every other login session is revoked.
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	rec, err := s.store.GetUserByID(u.ID)
	if err != nil || rec == nil {
		writeErr(w, http.StatusInternalServerError, "user lookup failed")
		return
	}
	if !verifyPassword(body.CurrentPassword, rec.PasswordHash) {
		writeErr(w, http.StatusUnauthorized, "current password is wrong")
		return
	}
	if err := setPasswordRules(body.NewPassword); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := hashPassword(body.NewPassword)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.store.UpdateUserPassword(u.ID, hash); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	keep := ""
	if c, err := r.Cookie(authCookie); err == nil {
		keep = c.Value
	}
	if err := s.store.DeleteAuthSessionsForUser(u.ID, keep); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func setPasswordRules(pw string) error {
	if len(pw) < 8 || len(pw) > 200 {
		return errors.New("password must be 8-200 characters")
	}
	return nil
}

// ---- Users API (admin only) ----

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	username := strings.TrimSpace(body.Username)
	role := body.Role
	if role == "" {
		role = "viewer"
	}
	if !validateUsername(username) {
		writeErr(w, http.StatusBadRequest, "username must be 1-64 characters (letters, digits, . _ -)")
		return
	}
	if !validateRole(role) {
		writeErr(w, http.StatusBadRequest, "role must be admin or viewer")
		return
	}
	if err := setPasswordRules(body.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := hashPassword(body.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	user, err := s.store.CreateUser(username, hash, role)
	if err == errUserExists {
		writeErr(w, http.StatusConflict, "username already taken")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, user)
}

// handleUpdateUser resets a password and/or changes a role. Both revoke the
// target user's logins so the change takes effect immediately.
func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var body struct {
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	if body.Password == "" && body.Role == "" {
		writeErr(w, http.StatusBadRequest, "nothing to update")
		return
	}
	target, err := s.store.GetUserByID(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if target == nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	if body.Role != "" {
		if !validateRole(body.Role) {
			writeErr(w, http.StatusBadRequest, "role must be admin or viewer")
			return
		}
		if target.Role == "admin" && body.Role != "admin" {
			other, err := s.store.HasOtherAdmin(id)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			if !other {
				writeErr(w, http.StatusBadRequest, "cannot demote the last admin")
				return
			}
		}
		if err := s.store.UpdateUserRole(id, body.Role); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if body.Password != "" {
		if err := setPasswordRules(body.Password); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		hash, err := hashPassword(body.Password)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := s.store.UpdateUserPassword(id, hash); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := s.store.DeleteAuthSessionsForUser(id, ""); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	updated, err := s.store.GetUserByID(id)
	if err != nil || updated == nil {
		writeErr(w, http.StatusInternalServerError, "user lookup failed")
		return
	}
	writeJSON(w, http.StatusOK, updated.User)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid user id")
		return
	}
	target, err := s.store.GetUserByID(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if target == nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	if target.Role == "admin" {
		other, err := s.store.HasOtherAdmin(id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !other {
			writeErr(w, http.StatusBadRequest, "cannot delete the last admin")
			return
		}
	}
	// auth_sessions cascade; the operator must log in again (as someone else).
	if err := s.store.DeleteUser(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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
	// The dashboard owns these settings per site; the tracker consumes them.
	writeJSON(w, http.StatusOK, map[string]any{
		"sample_rate":          1.0,
		"checkout_interval_ms": 30000,
		"mask_inputs":          true,
		"flush_interval_ms":    5000,
		"flush_batch_size":     20,
		"recording_enabled":    site.RecordingEnabled,
		"feedback": map[string]any{
			"enabled":    site.Settings.FeedbackEnabled,
			"position":   site.Settings.FeedbackPosition,
			"survey_id":  site.Settings.SurveyID,
			"title":      site.Settings.SurveyTitle,
			"type":       site.Settings.SurveyType,
			"questions":  site.Settings.Questions,
			"appearance": site.Settings.Appearance,
			"trigger":    site.Settings.FeedbackTrigger,
		},
	})
}

// ---- Static / tracker serving ----

func (s *Server) handleTracker(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	// Short cache: tracker updates should reach sites quickly; the file is
	// tiny so revalidation cost is negligible.
	w.Header().Set("Cache-Control", "public, max-age=60")
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
