package main

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// requestLimiter is an intentionally small in-process fixed-window limiter.
// It protects a single TraceUX instance from accidental or low-effort abuse;
// deployments with multiple replicas should also enforce limits at the proxy.
type requestLimiter struct {
	mu      sync.Mutex
	entries map[string]limitEntry
	limit   int
	window  time.Duration
}

type limitEntry struct {
	started time.Time
	count   int
}

func newRequestLimiter(limit int, window time.Duration) *requestLimiter {
	return &requestLimiter{
		entries: make(map[string]limitEntry),
		limit:   limit,
		window:  window,
	}
}

func (l *requestLimiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	// Bound memory if an attacker rotates source addresses or usernames.
	if len(l.entries) > 10_000 {
		for k, entry := range l.entries {
			if now.Sub(entry.started) >= l.window {
				delete(l.entries, k)
			}
		}
	}

	entry, ok := l.entries[key]
	if !ok || now.Sub(entry.started) >= l.window {
		entry = limitEntry{started: now}
	}
	if entry.count >= l.limit {
		l.entries[key] = entry
		return false
	}
	entry.count++
	l.entries[key] = entry
	return true
}

func (s *Server) initSecurity() {
	s.securityOnce.Do(func() {
		minute := time.Minute
		s.loginIPLimiter = newRequestLimiter(30, minute)
		s.loginUserLimiter = newRequestLimiter(10, minute)
		s.ingestIPLimiter = newRequestLimiter(120, minute)
		s.ingestSiteLimiter = newRequestLimiter(2_000, minute)
	})
}

func writeRateLimited(w http.ResponseWriter, message string) {
	w.Header().Set("Retry-After", "60")
	writeErr(w, http.StatusTooManyRequests, message)
}

func isMutation(method string) bool {
	return method == http.MethodPost || method == http.MethodPut ||
		method == http.MethodPatch || method == http.MethodDelete
}

// sameOriginRequest is a defense-in-depth CSRF check for cookie-authenticated
// dashboard requests. Non-browser clients commonly omit both headers, so an
// absent Origin/Referer remains allowed for backwards-compatible API use.
func sameOriginRequest(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		origin = strings.TrimSpace(r.Header.Get("Referer"))
	}
	if origin == "" {
		return true
	}
	u, err := parseHTTPURL(origin)
	if err != nil || u.Host == "" {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

func parseHTTPURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, errors.New("invalid http origin")
	}
	return u, nil
}

func (s *Server) sameOrigin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if isMutation(r.Method) && !sameOriginRequest(r) {
			writeErr(w, http.StatusForbidden, "cross-origin request blocked")
			return
		}
		next(w, r)
	}
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		// TraceUX never needs device, geolocation, or local-network access. Deny
		// these explicitly so replayed pages/subframes cannot trigger a browser
		// permission prompt while loading a recorded resource.
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), local-network=(), loopback-network=(), local-network-access=()")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; form-action 'self'")
		if s.cfg != nil && s.cfg.SecureCookies {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}
