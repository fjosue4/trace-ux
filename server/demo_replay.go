package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"
	"time"
)

// Demo replay is isolated from dashboard authentication. It is disabled by
// default and uses random bearer capabilities stored only as HMAC digests.
func (s *Server) demoEnabled() bool { return s.cfg != nil && s.cfg.DemoReplayEnabled }

func demoTokenHash(secret []byte, token string) string {
	h := hmac.New(sha256.New, secret)
	_, _ = h.Write([]byte(token))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func newDemoToken() (string, error) {
	b := make([]byte, 32) // 256 bits of entropy
	if _, err := rand.Read(b); err != nil { return "", err }
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Server) handleDemoClaim(w http.ResponseWriter, r *http.Request) {
	if !s.demoEnabled() { writeErr(w, http.StatusNotFound, "not found"); return }
	s.initSecurity()
	if !s.demoClaimLimiter.allow("ip:" + s.clientIP(r)) { writeRateLimited(w, "too many demo replay requests"); return }
	site, err := s.store.GetSiteByKey(r.PathValue("siteKey"))
	if err != nil || site.ID == 0 { writeErr(w, http.StatusNotFound, "not found"); return }
	var body struct{ SessionID string `json:"session_id"` }
	if err := readJSON(w, r, &body); err != nil { return }
	body.SessionID = strings.TrimSpace(body.SessionID)
	if body.SessionID == "" || !validSessionID(body.SessionID) || len(body.SessionID) > 100 {
		writeErr(w, http.StatusBadRequest, "invalid session")
		return
	}
	sess, err := s.store.GetSession(body.SessionID)
	// This check prevents a token for a session belonging to another site.
	if err != nil || sess == nil || sess.SiteID != site.ID {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	token, err := newDemoToken()
	if err != nil { writeErr(w, http.StatusInternalServerError, "could not create access"); return }
	now := time.Now().Unix()
	expires := time.Now().Add(s.cfg.DemoReplayTTL).Unix()
	if err := s.store.CreateDemoReplayToken(demoTokenHash(s.secret, token), site.ID, body.SessionID, now, expires); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create access")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": "/share/" + token, "expires_at": expires})
}

type demoReplayToken struct { SiteID int64; SessionID string }

func (s *Server) allowDemoReplay(w http.ResponseWriter, r *http.Request) bool {
	s.initSecurity()
	if !s.demoReplayLimiter.allow("ip:" + s.clientIP(r)) {
		writeRateLimited(w, "too many replay requests")
		return false
	}
	return true
}

func (s *Server) demoSession(token string) (*Session, bool) {
	if !s.demoEnabled() || len(token) != 43 { return nil, false }
	rec, err := s.store.GetDemoReplayToken(demoTokenHash(s.secret, token), time.Now().Unix())
	if err != nil || rec == nil { return nil, false }
	sess, err := s.store.GetSession(rec.SessionID)
	if err != nil || sess == nil || sess.SiteID != rec.SiteID { return nil, false }
	return sess, true
}

func (s *Server) handleDemoReplay(w http.ResponseWriter, r *http.Request) {
	if !s.allowDemoReplay(w, r) { return }
	sess, ok := s.demoSession(r.PathValue("token")); if !ok { writeErr(w, http.StatusNotFound, "replay unavailable"); return }
	writeJSON(w, http.StatusOK, map[string]any{"session": publicDemoSession(sess)})
}

func (s *Server) handleDemoReplayEvents(w http.ResponseWriter, r *http.Request) {
	if !s.allowDemoReplay(w, r) { return }
	sess, ok := s.demoSession(r.PathValue("token")); if !ok { writeErr(w, http.StatusNotFound, "replay unavailable"); return }
	r.SetPathValue("id", sess.ID)
	s.handleSessionEvents(w, r)
}

// publicDemoSession contains only values needed to size the public player.
// Bearer links must not expose IP hashes, identity fields, referrers, user
// agents, or arbitrary attribution data.
func publicDemoSession(sess *Session) map[string]any {
	return map[string]any{
		"id": sess.ID, "started_at": sess.StartedAt, "last_seen": sess.LastSeen,
		"duration_ms": sess.DurationMs, "page_count": sess.PageCount,
		"event_count": sess.EventCount, "viewport_w": sess.ViewportW, "viewport_h": sess.ViewportH,
	}
}

func (s *Store) CreateDemoReplayToken(hash string, siteID int64, sessionID string, created, expires int64) error {
	_, err := s.db.Exec(`INSERT INTO demo_replay_tokens (token_hash, site_id, session_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`, hash, siteID, sessionID, created, expires)
	return err
}

func (s *Store) GetDemoReplayToken(hash string, now int64) (*demoReplayToken, error) {
	var rec demoReplayToken
	err := s.db.QueryRow(`SELECT site_id, session_id FROM demo_replay_tokens WHERE token_hash = ? AND expires_at > ?`, hash, now).Scan(&rec.SiteID, &rec.SessionID)
	if err != nil { return nil, err }
	return &rec, nil
}

func (s *Store) DeleteExpiredDemoReplayTokens(now int64) error {
	_, err := s.db.Exec(`DELETE FROM demo_replay_tokens WHERE expires_at <= ?`, now)
	return err
}
