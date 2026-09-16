package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"trace-ux/server/store"
)

const authCookie = "trace_ux_auth"

type Server struct {
	store  *store.Store
	cfg    *Config
	secret []byte       // HMAC salt for ip_hash (auth cookies are DB-backed now)
	static http.Handler // SPA + assets

	securityOnce            sync.Once
	loginIPLimiter          *requestLimiter
	loginUserLimiter        *requestLimiter
	ingestIPLimiter         *requestLimiter
	ingestSiteLimiter       *requestLimiter
	demoClaimLimiter        *requestLimiter
	demoReplayLimiter       *requestLimiter
	updatesReadLimiter      *requestLimiter
	updatesWriteLimiter     *requestLimiter
	updatesSiteLimiter      *requestLimiter
	ticketsReadLimiter      *requestLimiter
	ticketsWriteLimiter     *requestLimiter
	ticketsSiteLimiter      *requestLimiter
	widgetSocketLimiter     *requestLimiter
	widgetSocketSiteLimiter *requestLimiter
	widgetSocketOnce        sync.Once
	widgetSockets           *widgetSocketHub

	cspOnce sync.Once
	csp     string
}

type Config struct {
	Addr               string
	DataDir            string
	Password           string // bootstrap admin password (TRACE_UX_PASSWORD)
	ResetAdmin         bool   // TRACE_UX_RESET_ADMIN=1: re-point admin at TRACE_UX_PASSWORD
	RetentionDays      int
	DevStaticDir       string // serve dashboard/tracker from disk instead of embed (dev)
	SecureCookies      bool
	TrustedProxyCIDRs  []*net.IPNet
	DemoReplayEnabled  bool
	DemoReplayTTL      time.Duration
	MaxDiskBytes       uint64 // TRACE_UX_MAX_GB_DISK; 0 disables the disk budget
	SpaceFloorDays     int    // TRACE_UX_SPACE_FLOOR_DAYS; never prune newer than this
	MaxEventBytes      int    // TRACE_UX_MAX_EVENT_MB; ceiling on one rrweb event
	CheckoutIntervalMS int    // TRACE_UX_CHECKOUT_INTERVAL_MS; rrweb re-snapshot cadence
	InlineStylesheet   bool   // TRACE_UX_INLINE_STYLESHEET; copy CSS into every snapshot
	SlimDOM            bool   // TRACE_UX_SLIM_DOM; drop comments/scripts/meta from snapshots
}

const (
	// Unchanged defaults: setting neither variable behaves exactly as before.
	defaultMaxEventMB         = 4
	defaultCheckoutIntervalMS = 30_000

	// A decoded request body is held in memory per in-flight request, so the
	// event cap is bounded rather than free-form.
	maxMaxEventMB = 64

	// Below ~5s the tracker spends more time snapshotting than recording;
	// above an hour the checkout stops being a useful seek point at all.
	minCheckoutIntervalMS = 5_000
	maxCheckoutIntervalMS = 3_600_000
)

func loadConfig() Config {
	cfg := Config{
		Addr:               envOr("TRACE_UX_ADDR", ":8080"),
		DataDir:            envOr("TRACE_UX_DATA", "./data"),
		Password:           os.Getenv("TRACE_UX_PASSWORD"),
		ResetAdmin:         os.Getenv("TRACE_UX_RESET_ADMIN") == "1",
		RetentionDays:      90,
		SecureCookies:      envBool("TRACE_UX_SECURE_COOKIES", true),
		DemoReplayEnabled:  envBool("TRACE_UX_DEMO_REPLAY", false),
		DemoReplayTTL:      15 * time.Minute,
		SpaceFloorDays:     3,
		MaxEventBytes:      defaultMaxEventMB << 20,
		CheckoutIntervalMS: defaultCheckoutIntervalMS,
		// Default true, matching rrweb. Turning it off makes snapshots far
		// smaller, but the replay must then load the CSS from the recorded
		// origin -- which the replay page's CSP (style-src 'self') blocks, so
		// replays come back unstyled. Only worth switching off once the server
		// stores stylesheets itself.
		InlineStylesheet: true,
		SlimDOM:          true,
	}
	if v := os.Getenv("TRACE_UX_DEMO_REPLAY_TTL"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 60 && n <= 3600 {
			cfg.DemoReplayTTL = time.Duration(n) * time.Second
		}
	}
	if v := os.Getenv("TRACE_UX_RETENTION_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.RetentionDays = n
		}
	}
	// Unset -- or empty, or 0 -- means NO LIMIT: the store grows until the
	// time-based retention window bounds it, which is the behaviour every
	// existing install already has. Time-based retention stays the primary
	// control; this budget is a backstop for when traffic outruns the window.
	//
	// Parsed as a float so fractions of a gigabyte work ("0.5") without a second
	// unit-flavoured variable. A value that does not parse is NOT quietly
	// treated as "no limit": someone who wrote "25GB" or "25 " believes they
	// capped the disk, and silently leaving it uncapped is how they find out
	// months later, from a full filesystem.
	if v := strings.TrimSpace(os.Getenv("TRACE_UX_MAX_GB_DISK")); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		switch {
		case err != nil:
			log.Printf("WARNING: TRACE_UX_MAX_GB_DISK=%q is not a number; there is NO disk limit. Expected a plain GB value such as 25 or 0.5", v)
		case f < 0:
			log.Printf("WARNING: TRACE_UX_MAX_GB_DISK=%q is negative; there is NO disk limit", v)
		case f == 0:
			// Explicit "no limit". Spelling it out is allowed so the variable can
			// stay in an env file, set to 0, rather than being commented out.
		default:
			cfg.MaxDiskBytes = uint64(f * (1 << 30))
		}
	}
	if v := os.Getenv("TRACE_UX_SPACE_FLOOR_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			cfg.SpaceFloorDays = n
		}
	}
	// Ceiling on ONE rrweb event. The FullSnapshot is the whole serialized DOM
	// with stylesheets inlined, so a heavy app can exceed the default and its
	// replays come back blank -- the snapshot is refused while the incremental
	// events around it are accepted. The 400 reports the actual byte count, so
	// the number to put here comes straight out of the error.
	if v := strings.TrimSpace(os.Getenv("TRACE_UX_MAX_EVENT_MB")); v != "" {
		n, err := strconv.Atoi(v)
		switch {
		case err != nil || n <= 0:
			log.Printf("WARNING: TRACE_UX_MAX_EVENT_MB=%q is not a positive number; keeping %d MB",
				v, defaultMaxEventMB)
		case n > maxMaxEventMB:
			log.Printf("WARNING: TRACE_UX_MAX_EVENT_MB=%d exceeds the %d MB ceiling; clamping. "+
				"Each in-flight request holds a decoded body of this size in memory.", n, maxMaxEventMB)
			cfg.MaxEventBytes = maxMaxEventMB << 20
		default:
			cfg.MaxEventBytes = n << 20
		}
	}
	// Whether rrweb copies the page's stylesheets into every FullSnapshot.
	// Off keeps snapshots small, at the cost of the replay having to load the
	// CSS from the recorded origin -- which the replay page's CSP must permit,
	// or the replay comes back unstyled. Turn it on to trade disk for fidelity.
	cfg.InlineStylesheet = envBool("TRACE_UX_INLINE_STYLESHEET", cfg.InlineStylesheet)
	cfg.SlimDOM = envBool("TRACE_UX_SLIM_DOM", cfg.SlimDOM)

	// rrweb re-snapshots the entire DOM on this cadence. It is the dominant
	// term in storage: at 30s a nine-hour session stores ~1080 copies of the
	// page, stylesheets and all. Raising it trades seek latency in the player
	// (a jump may replay more diffs) for a near-linear drop in disk.
	if v := strings.TrimSpace(os.Getenv("TRACE_UX_CHECKOUT_INTERVAL_MS")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < minCheckoutIntervalMS || n > maxCheckoutIntervalMS {
			log.Printf("WARNING: TRACE_UX_CHECKOUT_INTERVAL_MS=%q is not between %d and %d; keeping %d",
				v, minCheckoutIntervalMS, maxCheckoutIntervalMS, defaultCheckoutIntervalMS)
		} else {
			cfg.CheckoutIntervalMS = n
		}
	}
	cfg.DevStaticDir = os.Getenv("TRACE_UX_DEV_STATIC")
	cfg.TrustedProxyCIDRs = parseTrustedProxyCIDRs(os.Getenv("TRACE_UX_TRUSTED_PROXIES"))
	if cfg.Password == "" {
		log.Println("WARNING: TRACE_UX_PASSWORD is not set; a fresh database will refuse to start until it is configured")
	}
	return cfg
}

func envBool(key string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		log.Printf("WARNING: %s has invalid boolean value %q; using %t", key, v, def)
		return def
	}
}

func parseTrustedProxyCIDRs(raw string) []*net.IPNet {
	var out []*net.IPNet
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		_, network, err := net.ParseCIDR(item)
		if err != nil {
			log.Printf("WARNING: ignoring invalid TRACE_UX_TRUSTED_PROXIES entry %q", item)
			continue
		}
		out = append(out, network)
	}
	return out
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
	if b, err := os.ReadFile(path); err == nil {
		if len(b) != 32 {
			return nil, fmt.Errorf("auth secret %s has invalid length", path)
		}
		if err := os.Chmod(path, 0o600); err != nil {
			return nil, err
		}
		return b, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dataDir, 0o700); err != nil {
		return nil, err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, err
	}
	return b, nil
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("POST /api/auth/login", s.sameOrigin(s.handleLogin))
	mux.HandleFunc("POST /api/auth/logout", s.sameOrigin(s.handleLogout))
	mux.HandleFunc("POST /api/auth/password", s.auth(s.handleChangePassword))
	mux.HandleFunc("GET /api/auth/me", s.auth(s.handleMe))

	// User management: admin role only.
	mux.HandleFunc("GET /api/users", s.auth(s.requireAdmin(s.handleListUsers)))
	mux.HandleFunc("POST /api/users", s.auth(s.requireAdmin(s.handleCreateUser)))
	mux.HandleFunc("PATCH /api/users/{id}", s.auth(s.requireAdmin(s.handleUpdateUser)))
	mux.HandleFunc("DELETE /api/users/{id}", s.auth(s.requireAdmin(s.handleDeleteUser)))

	// Server resource usage (admin only).
	mux.HandleFunc("GET /api/system/health", s.auth(s.requireAdmin(s.handleSystemHealth)))

	mux.HandleFunc("GET /api/sites", s.auth(s.handleListSites))
	mux.HandleFunc("POST /api/sites", s.auth(s.requireAdmin(s.handleCreateSite)))
	mux.HandleFunc("GET /api/sites/{id}", s.auth(s.handleGetSite))
	mux.HandleFunc("PATCH /api/sites/{id}", s.auth(s.requireAdmin(s.handleUpdateSite)))
	mux.HandleFunc("PUT /api/sites/{id}/settings", s.auth(s.requireAdmin(s.handlePutSiteSettings)))
	mux.HandleFunc("DELETE /api/sites/{id}", s.auth(s.requireAdmin(s.handleDeleteSite)))
	// Custom launcher icon for the unified widget.
	mux.HandleFunc("PUT /api/sites/{id}/widget-icon", s.auth(s.requireAdmin(s.handleUploadWidgetIcon)))
	mux.HandleFunc("DELETE /api/sites/{id}/widget-icon", s.auth(s.requireAdmin(s.handleDeleteWidgetIcon)))

	mux.HandleFunc("GET /api/sessions", s.auth(s.handleListSessions))
	mux.HandleFunc("GET /api/sessions/countries", s.auth(s.handleListSessionCountries))
	mux.HandleFunc("GET /api/sessions/stats", s.auth(s.handleSessionStats))
	mux.HandleFunc("GET /api/sessions/{id}", s.auth(s.handleGetSession))
	mux.HandleFunc("GET /api/sessions/{id}/events", s.auth(s.handleSessionEvents))
	mux.HandleFunc("DELETE /api/sessions/{id}", s.auth(s.requireAdmin(s.handleDeleteSession)))

	// Logs captured from tracked sites. Every row is linked to a
	// recording through its session_id.
	mux.HandleFunc("GET /api/logs", s.auth(s.handleListLogs))
	mux.HandleFunc("GET /api/logs/stats", s.auth(s.handleLogStats))

	// Backend endpoint latency and percentile metrics.
	mux.HandleFunc("GET /api/performance", s.auth(s.handlePerformance))
	mux.HandleFunc("POST /api/performance/ingest/{siteKey}", s.handlePerformanceIngest)
	mux.HandleFunc("GET /api/sites/{id}/performance-keys", s.auth(s.handleListPerformanceKeys))
	mux.HandleFunc("POST /api/sites/{id}/performance-keys", s.auth(s.requireAdmin(s.handleCreatePerformanceKey)))
	mux.HandleFunc("DELETE /api/sites/{id}/performance-keys/{keyId}", s.auth(s.requireAdmin(s.handleDeletePerformanceKey)))
	// Backward-compatible singular route; new dashboard flows use the plural
	// key collection so keys can coexist and be revoked independently.
	mux.HandleFunc("POST /api/sites/{id}/performance-key", s.auth(s.requireAdmin(s.handleRotatePerformanceKey)))

	// Feedback & surveys from tracked sites.
	mux.HandleFunc("GET /api/feedback", s.auth(s.handleListFeedback))
	mux.HandleFunc("GET /api/feedback/summary", s.auth(s.handleFeedbackSummary))
	mux.HandleFunc("DELETE /api/feedback/{id}", s.auth(s.requireAdmin(s.handleDeleteFeedback)))
	mux.HandleFunc("GET /api/announcements", s.auth(s.handleListAnnouncements))
	mux.HandleFunc("POST /api/announcements", s.auth(s.requireAdmin(s.handleCreateAnnouncement)))
	mux.HandleFunc("PATCH /api/announcements/{id}", s.auth(s.requireAdmin(s.handleUpdateAnnouncement)))
	mux.HandleFunc("DELETE /api/announcements/{id}", s.auth(s.requireAdmin(s.handleDeleteAnnouncement)))
	mux.HandleFunc("POST /api/announcements/{id}/publish", s.auth(s.requireAdmin(s.handlePublishAnnouncement)))
	mux.HandleFunc("POST /api/announcements/{id}/archive", s.auth(s.requireAdmin(s.handleArchiveAnnouncement)))
	mux.HandleFunc("DELETE /api/announcements/comments/{id}", s.auth(s.requireAdmin(s.handleDeleteAnnouncementComment)))
	mux.HandleFunc("GET /api/announcements/{id}/engagement", s.auth(s.handleAnnouncementEngagement))

	// Support tickets. Staff can read and reply; only admins can delete.
	mux.HandleFunc("GET /api/tickets", s.auth(s.handleListTickets))
	mux.HandleFunc("POST /api/tickets", s.auth(s.handleCreateStaffTicket))
	mux.HandleFunc("GET /api/tickets/socket", s.auth(s.handleDashboardTicketSocket))
	mux.HandleFunc("GET /api/tickets/{id}", s.auth(s.handleGetTicket))
	mux.HandleFunc("POST /api/tickets/{id}/messages", s.auth(s.handleStaffTicketReply))
	mux.HandleFunc("PATCH /api/tickets/{id}", s.auth(s.handleUpdateTicket))
	mux.HandleFunc("DELETE /api/tickets/{id}", s.auth(s.requireAdmin(s.handleDeleteTicket)))

	// Public tracker-facing endpoints. Cross-origin access is granted per
	// site via the URL the admin registers (see cors below).
	mux.HandleFunc("GET /api/config/{siteKey}", s.handleConfig)
	mux.HandleFunc("GET /api/widget-icon/{siteKey}", s.handlePublicWidgetIcon)
	mux.HandleFunc("POST /api/ingest/{siteKey}", s.handleIngest)
	mux.HandleFunc("POST /api/demo/claim/{siteKey}", s.handleDemoClaim)
	mux.HandleFunc("GET /api/updates/{siteKey}", s.handlePublicAnnouncements)
	mux.HandleFunc("POST /api/updates/{siteKey}/{id}/reaction", s.handleAnnouncementReaction)
	mux.HandleFunc("POST /api/updates/{siteKey}/{id}/comments", s.handleAnnouncementComment)
	mux.HandleFunc("POST /api/updates/{siteKey}/{id}/read", s.handleAnnouncementRead)
	mux.HandleFunc("GET /api/support/{siteKey}/tickets", s.handlePublicListTickets)
	mux.HandleFunc("POST /api/support/{siteKey}/tickets", s.handlePublicCreateTicket)
	mux.HandleFunc("GET /api/support/{siteKey}/tickets/{id}", s.handlePublicGetTicket)
	mux.HandleFunc("POST /api/support/{siteKey}/tickets/{id}/messages", s.handlePublicTicketReply)
	mux.HandleFunc("GET /api/widget/{siteKey}/socket", s.handleWidgetSocket)
	mux.HandleFunc("GET /api/demo/replay/{token}", s.handleDemoReplay)
	mux.HandleFunc("GET /api/demo/replay/{token}/events", s.handleDemoReplayEvents)

	mux.HandleFunc("GET /t.js", s.handleTracker)

	// An unknown /api path must not fall through to the SPA. Serving index.html
	// with 200 turns "this server is older than the dashboard" into a JSON parse
	// error at the call site, which is a miserable thing to debug.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, http.StatusNotFound, "unknown API endpoint")
	})

	mux.Handle("/", s.static)

	return s.securityHeaders(s.cors(mux))
}

// cors restricts cross-origin tracker traffic to the origins of sites
// registered in TraceUX. Each site declares its URL when an admin adds it;
// the public endpoints (/api/config/{key}, /api/ingest/{key}) only grant
// CORS to that origin. The dashboard API is same-origin and needs no grant.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isPublic := strings.HasPrefix(r.URL.Path, "/api/ingest/") || strings.HasPrefix(r.URL.Path, "/api/config/") || strings.HasPrefix(r.URL.Path, "/api/demo/claim/") || strings.HasPrefix(r.URL.Path, "/api/updates/") || strings.HasPrefix(r.URL.Path, "/api/support/") || strings.HasPrefix(r.URL.Path, "/api/widget/")
		if !isPublic {
			next.ServeHTTP(w, r)
			return
		}
		origin := r.Header.Get("Origin")
		if origin == "" {
			// Same-origin embedding or a non-browser client: nothing to grant.
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if !s.originAllowed(r.URL.Path, origin) {
			if r.Method == http.MethodOptions {
				writeErr(w, http.StatusForbidden, "origin not registered for this site")
			} else {
				// No grant header: the browser blocks reading the response.
				next.ServeHTTP(w, r)
			}
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Encoding")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// originAllowed reports whether origin matches the URL registered for the
// site addressed by the path (/api/config/{siteKey}, /api/ingest/{siteKey}).
func (s *Server) originAllowed(path, origin string) bool {
	var key string
	if after, ok := strings.CutPrefix(path, "/api/config/"); ok {
		key, _, _ = strings.Cut(after, "/")
	} else if after, ok := strings.CutPrefix(path, "/api/ingest/"); ok {
		key, _, _ = strings.Cut(after, "/")
	} else if after, ok := strings.CutPrefix(path, "/api/demo/claim/"); ok {
		key, _, _ = strings.Cut(after, "/")
	} else if after, ok := strings.CutPrefix(path, "/api/updates/"); ok {
		key, _, _ = strings.Cut(after, "/")
	} else if after, ok := strings.CutPrefix(path, "/api/support/"); ok {
		key, _, _ = strings.Cut(after, "/")
	} else if after, ok := strings.CutPrefix(path, "/api/widget/"); ok {
		key, _, _ = strings.Cut(after, "/")
	}
	if key == "" {
		return false
	}
	site, err := s.store.GetSiteByKey(key)
	if err != nil || site.ID == 0 || site.URL == "" {
		return false
	}
	return sameOrigin(site.URL, origin)
}

// sameOrigin compares scheme and host (with port) of a registered site URL
// and a request Origin header.
func sameOrigin(registered, origin string) bool {
	u, err := url.Parse(registered)
	if err != nil || u.Host == "" {
		return false
	}
	o, err := url.Parse(origin)
	if err != nil || o.Host == "" {
		return false
	}
	return strings.EqualFold(u.Scheme, o.Scheme) && strings.EqualFold(u.Host, o.Host)
}

// normalizeSiteURL validates the URL an admin registers for a site: it must
// be absolute http(s) so the origin used for CORS is well-defined.
func normalizeSiteURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("url must be an absolute http(s) URL, e.g. https://example.com")
	}
	return raw, nil
}

// ---- Auth ----

type ctxKey int

const userCtxKey ctxKey = 0

// currentUser returns the authenticated user attached by s.auth, or nil.
func currentUser(r *http.Request) *store.User {
	u, _ := r.Context().Value(userCtxKey).(*store.User)
	return u
}

// auth resolves the login cookie to a user via the auth_sessions table, so
// password changes, role changes and user deletion revoke access immediately.
func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if isMutation(r.Method) && !sameOriginRequest(r) {
			writeErr(w, http.StatusForbidden, "cross-origin request blocked")
			return
		}
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
	s.initSecurity()
	if !s.loginIPLimiter.allow("ip:" + s.clientIP(r)) {
		writeRateLimited(w, "too many login attempts")
		return
	}
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
	if !s.loginUserLimiter.allow("user:" + strings.ToLower(username)) {
		writeRateLimited(w, "too many login attempts")
		return
	}
	// First boot after upgrade: seed the admin account from TRACE_UX_PASSWORD.
	if err := s.store.EnsureAdmin(s.cfg.Password); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	rec, err := s.store.GetUserByUsername(username)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil || !store.VerifyPassword(body.Password, rec.PasswordHash) {
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
		Secure:   s.cfg != nil && s.cfg.SecureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(store.AuthSessionTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "user": rec.User})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(authCookie); err == nil && c.Value != "" {
		s.store.DeleteAuthSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     authCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cfg != nil && s.cfg.SecureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	// The build version rides along here rather than on /api/system/health,
	// which is admin-only: "which version am I looking at" is the first thing
	// anyone asks when a replay misbehaves, and a viewer reporting the problem
	// needs to be able to answer it too.
	writeJSON(w, http.StatusOK, map[string]string{
		"username": u.Username,
		"role":     u.Role,
		"version":  version,
	})
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
	if !store.VerifyPassword(body.CurrentPassword, rec.PasswordHash) {
		writeErr(w, http.StatusUnauthorized, "current password is wrong")
		return
	}
	if err := setPasswordRules(body.NewPassword); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := store.HashPassword(body.NewPassword)
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
	if !store.ValidateUsername(username) {
		writeErr(w, http.StatusBadRequest, "username must be 1-64 characters (letters, digits, . _ -)")
		return
	}
	if !store.ValidateRole(role) {
		writeErr(w, http.StatusBadRequest, "role must be admin or viewer")
		return
	}
	if err := setPasswordRules(body.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := store.HashPassword(body.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	user, err := s.store.CreateUser(username, hash, role)
	if err == store.ErrUserExists {
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
		if actor := currentUser(r); actor != nil && actor.ID == id {
			writeErr(w, http.StatusForbidden, "cannot change your own role")
			return
		}
	}
	if body.Role != "" {
		if !store.ValidateRole(body.Role) {
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
		hash, err := store.HashPassword(body.Password)
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
	if actor := currentUser(r); actor != nil && actor.ID == id {
		writeErr(w, http.StatusForbidden, "cannot delete your own account")
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
		URL  string `json:"url"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 100 {
		writeErr(w, http.StatusBadRequest, "name must be 1-100 characters")
		return
	}
	siteURL, err := normalizeSiteURL(body.URL)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	site, err := s.store.CreateSite(name, siteURL)
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
	feedbackAppearance := site.Settings.Appearance
	if a := site.Settings.UpdatesAppearance; a != nil {
		panelBg, panelText := "#ffffff", "#142018"
		if a.Theme == "dark" {
			panelBg, panelText = "#121b16", "#eef5f0"
		}
		accent := a.Accent
		if accent == "" {
			accent = "#2f7d4a"
		}
		radius := a.Radius
		if radius == 0 {
			radius = 18
		}
		feedbackAppearance = &store.SiteAppearance{ButtonBg: accent, ButtonText: "#ffffff", ButtonLabel: "Feedback", PanelBg: panelBg, PanelText: panelText, Accent: accent, Primary: accent, PrimaryText: "#ffffff", Radius: radius, Spacing: 16}
	}

	// The launcher icon lives behind its own cached endpoint rather than
	// inline in this response: /api/config is sent uncached on every page
	// load, so a base64 image here would be re-downloaded every navigation.
	// The ETag rides in the URL so a replaced icon busts the cache.
	iconURL := ""
	if icon, err := s.store.GetWidgetIcon(site.ID, false); err == nil && icon != nil {
		iconURL = "/api/widget-icon/" + url.PathEscape(site.SiteKey) + "?v=" + icon.ETag
	}

	widget := buildWidgetConfig(site, iconURL)

	// The dashboard owns these settings per site; the tracker consumes them.
	// "widget" is the unified shape; "feedback" and "updates" are kept so a
	// tracker cached from before the merge keeps working (t.js is cached for
	// 60s, so the two overlap briefly after a deploy).
	writeJSON(w, http.StatusOK, map[string]any{
		"widget":               widget,
		"sample_rate":          1.0,
		"checkout_interval_ms": s.checkoutIntervalMS(),
		"inline_stylesheet":    s.cfg != nil && s.cfg.InlineStylesheet,
		"slim_dom":             s.cfg == nil || s.cfg.SlimDOM,
		"mask_inputs":          true,
		"flush_interval_ms":    5000,
		"flush_batch_size":     20,
		"recording_enabled":    site.RecordingEnabled,
		"logs": map[string]any{
			"enabled":          site.RecordingEnabled && site.Settings.Logs.Enabled,
			"minimum_severity": site.Settings.Logs.MinimumSeverity,
		},
		"feedback": map[string]any{
			"enabled":    site.Settings.FeedbackEnabled,
			"position":   widget.Position,
			"survey_id":  site.Settings.SurveyID,
			"title":      site.Settings.SurveyTitle,
			"type":       site.Settings.SurveyType,
			"questions":  site.Settings.Questions,
			"appearance": feedbackAppearance,
			"trigger":    site.Settings.FeedbackTrigger,
		},
		"updates": map[string]any{
			"enabled":    site.Settings.UpdatesEnabled,
			"position":   widget.Position,
			"appearance": site.Settings.UpdatesAppearance,
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
	r.Body = http.MaxBytesReader(w, r.Body, 256<<10) // dashboard JSON cap
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, errBadJSON.Error())
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		writeErr(w, http.StatusBadRequest, errBadJSON.Error())
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
