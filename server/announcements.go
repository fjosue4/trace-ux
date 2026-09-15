package main

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"trace-ux/server/store"
)

func (s *Server) handleListAnnouncements(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.URL.Query().Get("site_id"), 10, 64)
	rows, e := s.store.ListAnnouncements(id, false)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	writeJSON(w, 200, rows)
}
func (s *Server) handleCreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	var a store.Announcement
	if readJSON(w, r, &a) != nil {
		return
	}
	if a.SiteID <= 0 || store.ValidateAnnouncement(a) != nil {
		writeErr(w, 400, "title and valid site_id are required")
		return
	}
	now := time.Now().Unix()
	res, e := s.store.DB.Exec(`INSERT INTO announcements(site_id,title,summary,body,release_label,link_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?)`, a.SiteID, strings.TrimSpace(a.Title), a.Summary, a.Body, a.ReleaseLabel, a.LinkURL, now, now)
	if e != nil {
		writeErr(w, 400, e.Error())
		return
	}
	a.ID, _ = res.LastInsertId()
	a.Status = "draft"
	a.CreatedAt = now
	a.UpdatedAt = now
	writeJSON(w, 201, a)
}
func (s *Server) handleUpdateAnnouncement(w http.ResponseWriter, r *http.Request) {
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var a store.Announcement
	if e != nil || readJSON(w, r, &a) != nil {
		return
	}
	if store.ValidateAnnouncement(a) != nil {
		writeErr(w, 400, "invalid announcement")
		return
	}
	res, e := s.store.DB.Exec(`UPDATE announcements SET title=?,summary=?,body=?,release_label=?,link_url=?,updated_at=? WHERE id=?`, strings.TrimSpace(a.Title), a.Summary, a.Body, a.ReleaseLabel, a.LinkURL, time.Now().Unix(), id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeErr(w, 404, "announcement not found")
		return
	}
	if updated, err := s.store.GetAnnouncement(id); err == nil && updated.Status == "published" {
		s.broadcastWidgetEvent(updated.SiteID, "", "updates", widgetSocketEvent{
			Type:         "announcement.updated",
			Announcement: &updated,
		})
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) setAnnouncementStatus(w http.ResponseWriter, r *http.Request, status string) {
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	now := time.Now().Unix()
	pub := int64(0)
	if status == "published" {
		pub = now
	}
	res, e := s.store.DB.Exec(`UPDATE announcements SET status=?,published_at=CASE WHEN ?='published' THEN ? ELSE published_at END,updated_at=? WHERE id=?`, status, status, pub, now, id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	if n, err := res.RowsAffected(); err != nil {
		writeErr(w, 500, err.Error())
		return
	} else if n == 0 {
		writeErr(w, 404, "announcement not found")
		return
	}
	if updated, err := s.store.GetAnnouncement(id); err == nil {
		eventType := "announcement.updated"
		if status == "published" {
			eventType = "announcement.published"
		} else if status == "archived" {
			eventType = "announcement.archived"
		}
		s.broadcastWidgetEvent(updated.SiteID, "", "updates", widgetSocketEvent{
			Type:         eventType,
			Announcement: &updated,
		})
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) handlePublishAnnouncement(w http.ResponseWriter, r *http.Request) {
	s.setAnnouncementStatus(w, r, "published")
}
func (s *Server) handleArchiveAnnouncement(w http.ResponseWriter, r *http.Request) {
	s.setAnnouncementStatus(w, r, "archived")
}
func (s *Server) handleDeleteAnnouncement(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	previous, _ := s.store.GetAnnouncement(id)
	_, e := s.store.DB.Exec(`DELETE FROM announcements WHERE id=?`, id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	if previous.ID > 0 {
		s.broadcastWidgetEvent(previous.SiteID, "", "updates", widgetSocketEvent{
			Type: "announcement.deleted",
			ID:   previous.ID,
		})
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) handleDeleteAnnouncementComment(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	_, e := s.store.DB.Exec(`DELETE FROM announcement_comments WHERE id=?`, id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func publicVisitor(r *http.Request) string {
	v := strings.TrimSpace(r.URL.Query().Get("visitor"))
	if len(v) > 100 {
		return ""
	}
	return v
}
func (s *Server) publicSite(r *http.Request) (store.Site, bool) {
	site, e := s.store.GetSiteByKey(r.PathValue("siteKey"))
	return site, e == nil && site.ID > 0
}

// allowPublicUpdates rate limits the unauthenticated /api/updates/* surface.
// Site keys are published in every tracker snippet, so these endpoints are
// effectively open to the internet and must be capped per caller and per site.
func (s *Server) allowPublicUpdates(w http.ResponseWriter, r *http.Request, siteID int64, write bool) bool {
	s.initSecurity()
	limiter := s.updatesReadLimiter
	if write {
		limiter = s.updatesWriteLimiter
	}
	if !limiter.allow("ip:"+s.clientIP(r)) || !s.updatesSiteLimiter.allow(fmt.Sprintf("updates-site:%d", siteID)) {
		writeRateLimited(w, "too many announcement requests")
		return false
	}
	return true
}

func (s *Server) handlePublicAnnouncements(w http.ResponseWriter, r *http.Request) {
	site, ok := s.publicSite(r)
	if !ok {
		writeErr(w, 404, "unknown site")
		return
	}
	if !s.allowPublicUpdates(w, r, site.ID, false) {
		return
	}
	rows, e := s.store.ListAnnouncements(site.ID, true)
	if e != nil {
		log.Printf("updates: list announcements for site %d: %v", site.ID, e)
		writeErr(w, 500, "could not load announcements")
		return
	}
	if v := publicVisitor(r); v != "" {
		for i := range rows {
			_ = s.store.DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM announcement_reactions WHERE announcement_id=? AND visitor_key=?),EXISTS(SELECT 1 FROM announcement_reads WHERE announcement_id=? AND visitor_key=?)`, rows[i].ID, v, rows[i].ID, v).Scan(&rows[i].Liked, &rows[i].Read)
		}
	}
	writeJSON(w, 200, rows)
}

// publicRequest is the validated shape of a POST to /api/updates/{siteKey}/{id}/*.
type publicRequest struct {
	AnnouncementID int64
	VisitorKey     string
	Body           string
	Liked          *bool
}

func (s *Server) publicAnnouncement(w http.ResponseWriter, r *http.Request) (publicRequest, bool) {
	site, ok := s.publicSite(r)
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !ok || e != nil || id <= 0 {
		writeErr(w, 404, "announcement not found")
		return publicRequest{}, false
	}
	if !s.allowPublicUpdates(w, r, site.ID, true) {
		return publicRequest{}, false
	}
	var body struct {
		VisitorKey string `json:"visitor_key"`
		Body       string `json:"body"`
		Liked      *bool  `json:"liked"`
	}
	if readJSON(w, r, &body) != nil {
		return publicRequest{}, false
	}
	v := strings.TrimSpace(body.VisitorKey)
	if len(v) < 8 || len(v) > 100 {
		writeErr(w, 400, "invalid visitor_key")
		return publicRequest{}, false
	}
	var exists int
	if s.store.DB.QueryRow(`SELECT COUNT(*) FROM announcements WHERE id=? AND site_id=? AND status='published'`, id, site.ID).Scan(&exists) != nil || exists == 0 {
		writeErr(w, 404, "announcement not found")
		return publicRequest{}, false
	}
	return publicRequest{AnnouncementID: id, VisitorKey: v, Body: body.Body, Liked: body.Liked}, true
}
func (s *Server) handleAnnouncementReaction(w http.ResponseWriter, r *http.Request) {
	req, ok := s.publicAnnouncement(w, r)
	if !ok {
		return
	}
	if req.Liked != nil && !*req.Liked {
		_, _ = s.store.DB.Exec(`DELETE FROM announcement_reactions WHERE announcement_id=? AND visitor_key=?`, req.AnnouncementID, req.VisitorKey)
	} else {
		_, _ = s.store.DB.Exec(`INSERT OR IGNORE INTO announcement_reactions(announcement_id,visitor_key,created_at) VALUES(?,?,?)`, req.AnnouncementID, req.VisitorKey, time.Now().Unix())
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) handleAnnouncementRead(w http.ResponseWriter, r *http.Request) {
	req, ok := s.publicAnnouncement(w, r)
	if !ok {
		return
	}
	_, _ = s.store.DB.Exec(`INSERT INTO announcement_reads(announcement_id,visitor_key,read_at) VALUES(?,?,?) ON CONFLICT(announcement_id,visitor_key) DO UPDATE SET read_at=excluded.read_at`, req.AnnouncementID, req.VisitorKey, time.Now().Unix())
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// Comments are the only unauthenticated endpoint that stores caller-supplied
// text, so they carry hard row caps on top of the request rate limit: a single
// visitor key cannot flood one announcement, and one announcement cannot grow
// without bound no matter how many keys an attacker rotates through.
const (
	maxCommentsPerVisitor      = 10
	maxCommentsPerAnnouncement = 5_000
)

func (s *Server) handleAnnouncementComment(w http.ResponseWriter, r *http.Request) {
	req, ok := s.publicAnnouncement(w, r)
	if !ok {
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" || len(body) > 1000 {
		writeErr(w, 400, "comment must be 1-1000 characters")
		return
	}
	var byVisitor, total int64
	if e := s.store.DB.QueryRow(`SELECT
		COUNT(*) FILTER (WHERE visitor_key=?),
		COUNT(*)
		FROM announcement_comments WHERE announcement_id=?`, req.VisitorKey, req.AnnouncementID).Scan(&byVisitor, &total); e != nil {
		log.Printf("updates: count comments for announcement %d: %v", req.AnnouncementID, e)
		writeErr(w, 500, "could not save comment")
		return
	}
	if byVisitor >= maxCommentsPerVisitor || total >= maxCommentsPerAnnouncement {
		writeErr(w, 429, "comment limit reached for this announcement")
		return
	}
	now := time.Now().Unix()
	res, e := s.store.DB.Exec(`INSERT INTO announcement_comments(announcement_id,visitor_key,body,created_at) VALUES(?,?,?,?)`, req.AnnouncementID, req.VisitorKey, body, now)
	if e != nil {
		log.Printf("updates: insert comment for announcement %d: %v", req.AnnouncementID, e)
		writeErr(w, 500, "could not save comment")
		return
	}
	cid, _ := res.LastInsertId()
	writeJSON(w, 201, store.AnnouncementComment{ID: cid, Body: body, CreatedAt: now})
}
