package main

import (
	"database/sql"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Announcement struct {
	ID           int64  `json:"id"`
	SiteID       int64  `json:"site_id"`
	SiteName     string `json:"site_name,omitempty"`
	Title        string `json:"title"`
	Summary      string `json:"summary"`
	Body         string `json:"body"`
	ReleaseLabel string `json:"release_label"`
	LinkURL      string `json:"link_url"`
	Status       string `json:"status"`
	PublishedAt  int64  `json:"published_at"`
	CreatedAt    int64  `json:"created_at"`
	UpdatedAt    int64  `json:"updated_at"`
	Reactions    int64  `json:"reactions"`
	Comments     int64  `json:"comments"`
	Reads        int64  `json:"reads"`
	Liked        bool   `json:"liked,omitempty"`
	Read         bool   `json:"read,omitempty"`
}

type AnnouncementComment struct {
	ID        int64  `json:"id"`
	Body      string `json:"body"`
	CreatedAt int64  `json:"created_at"`
}

const announcementSelect = `SELECT a.id,a.site_id,s.name,a.title,a.summary,a.body,a.release_label,a.link_url,a.status,a.published_at,a.created_at,a.updated_at,
	(SELECT COUNT(*) FROM announcement_reactions r WHERE r.announcement_id=a.id),
	(SELECT COUNT(*) FROM announcement_comments c WHERE c.announcement_id=a.id AND c.status='visible'),
	(SELECT COUNT(*) FROM announcement_reads rd WHERE rd.announcement_id=a.id)`

func scanAnnouncement(row interface{ Scan(...any) error }) (Announcement, error) {
	var a Announcement
	err := row.Scan(&a.ID, &a.SiteID, &a.SiteName, &a.Title, &a.Summary, &a.Body, &a.ReleaseLabel, &a.LinkURL, &a.Status, &a.PublishedAt, &a.CreatedAt, &a.UpdatedAt, &a.Reactions, &a.Comments, &a.Reads)
	return a, err
}

func (s *Store) ListAnnouncements(siteID int64, publishedOnly bool) ([]Announcement, error) {
	q := announcementSelect + ` FROM announcements a JOIN sites s ON s.id=a.site_id WHERE 1=1`
	args := []any{}
	if siteID > 0 {
		q += ` AND a.site_id=?`
		args = append(args, siteID)
	}
	if publishedOnly {
		q += ` AND a.status='published'`
	}
	q += ` ORDER BY CASE WHEN a.status='published' THEN 0 ELSE 1 END,a.published_at DESC,a.updated_at DESC`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Announcement{}
	for rows.Next() {
		a, err := scanAnnouncement(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func validateAnnouncement(a Announcement) error {
	if strings.TrimSpace(a.Title) == "" || len(a.Title) > 160 {
		return errBadJSON
	}
	if len(a.Summary) > 300 || len(a.Body) > 10000 || len(a.ReleaseLabel) > 60 || len(a.LinkURL) > 500 {
		return errBadJSON
	}
	if a.LinkURL != "" {
		u, e := url.Parse(a.LinkURL)
		if e != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return errBadJSON
		}
	}
	return nil
}

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
	var a Announcement
	if readJSON(w, r, &a) != nil {
		return
	}
	if a.SiteID <= 0 || validateAnnouncement(a) != nil {
		writeErr(w, 400, "title and valid site_id are required")
		return
	}
	now := time.Now().Unix()
	res, e := s.store.db.Exec(`INSERT INTO announcements(site_id,title,summary,body,release_label,link_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?)`, a.SiteID, strings.TrimSpace(a.Title), a.Summary, a.Body, a.ReleaseLabel, a.LinkURL, now, now)
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
	var a Announcement
	if e != nil || readJSON(w, r, &a) != nil {
		return
	}
	if validateAnnouncement(a) != nil {
		writeErr(w, 400, "invalid announcement")
		return
	}
	res, e := s.store.db.Exec(`UPDATE announcements SET title=?,summary=?,body=?,release_label=?,link_url=?,updated_at=? WHERE id=?`, strings.TrimSpace(a.Title), a.Summary, a.Body, a.ReleaseLabel, a.LinkURL, time.Now().Unix(), id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeErr(w, 404, "announcement not found")
		return
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
	_, e = s.store.db.Exec(`UPDATE announcements SET status=?,published_at=CASE WHEN ?='published' THEN ? ELSE published_at END,updated_at=? WHERE id=?`, status, status, pub, now, id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
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
	_, e := s.store.db.Exec(`DELETE FROM announcements WHERE id=?`, id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) handleDeleteAnnouncementComment(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	_, e := s.store.db.Exec(`DELETE FROM announcement_comments WHERE id=?`, id)
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
func (s *Server) publicSite(r *http.Request) (Site, bool) {
	site, e := s.store.GetSiteByKey(r.PathValue("siteKey"))
	return site, e == nil && site.ID > 0
}
func (s *Server) handlePublicAnnouncements(w http.ResponseWriter, r *http.Request) {
	site, ok := s.publicSite(r)
	if !ok {
		writeErr(w, 404, "unknown site")
		return
	}
	rows, e := s.store.ListAnnouncements(site.ID, true)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	v := publicVisitor(r)
	for i := range rows {
		if v != "" {
			_ = s.store.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM announcement_reactions WHERE announcement_id=? AND visitor_key=?),EXISTS(SELECT 1 FROM announcement_reads WHERE announcement_id=? AND visitor_key=?)`, rows[i].ID, v, rows[i].ID, v).Scan(&rows[i].Liked, &rows[i].Read)
		}
		cs, _ := s.store.db.Query(`SELECT id,body,created_at FROM announcement_comments WHERE announcement_id=? AND status='visible' ORDER BY created_at DESC LIMIT 20`, rows[i].ID)
		comments := []AnnouncementComment{}
		if cs != nil {
			for cs.Next() {
				var c AnnouncementComment
				_ = cs.Scan(&c.ID, &c.Body, &c.CreatedAt)
				comments = append(comments, c)
			}
			cs.Close()
		}
		_ = comments
	}
	writeJSON(w, 200, rows)
}
func (s *Server) publicAnnouncement(w http.ResponseWriter, r *http.Request) (int64, string, bool) {
	site, ok := s.publicSite(r)
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	v := ""
	var body struct {
		VisitorKey string `json:"visitor_key"`
		Body       string `json:"body"`
		Liked      *bool  `json:"liked"`
	}
	if !ok || e != nil || readJSON(w, r, &body) != nil {
		return 0, "", false
	}
	v = strings.TrimSpace(body.VisitorKey)
	if len(v) < 8 || len(v) > 100 {
		writeErr(w, 400, "invalid visitor_key")
		return 0, "", false
	}
	var exists int
	if s.store.db.QueryRow(`SELECT COUNT(*) FROM announcements WHERE id=? AND site_id=? AND status='published'`, id, site.ID).Scan(&exists) != nil || exists == 0 {
		writeErr(w, 404, "announcement not found")
		return 0, "", false
	}
	r.Header.Set("X-Announcement-Body", body.Body)
	if body.Liked != nil {
		r.Header.Set("X-Announcement-Liked", strconv.FormatBool(*body.Liked))
	}
	return id, v, true
}
func (s *Server) handleAnnouncementReaction(w http.ResponseWriter, r *http.Request) {
	id, v, ok := s.publicAnnouncement(w, r)
	if !ok {
		return
	}
	if r.Header.Get("X-Announcement-Liked") == "false" {
		_, _ = s.store.db.Exec(`DELETE FROM announcement_reactions WHERE announcement_id=? AND visitor_key=?`, id, v)
	} else {
		_, _ = s.store.db.Exec(`INSERT OR IGNORE INTO announcement_reactions VALUES(?,?,?)`, id, v, time.Now().Unix())
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) handleAnnouncementRead(w http.ResponseWriter, r *http.Request) {
	id, v, ok := s.publicAnnouncement(w, r)
	if !ok {
		return
	}
	_, _ = s.store.db.Exec(`INSERT INTO announcement_reads VALUES(?,?,?) ON CONFLICT(announcement_id,visitor_key) DO UPDATE SET read_at=excluded.read_at`, id, v, time.Now().Unix())
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) handleAnnouncementComment(w http.ResponseWriter, r *http.Request) {
	id, v, ok := s.publicAnnouncement(w, r)
	if !ok {
		return
	}
	body := strings.TrimSpace(r.Header.Get("X-Announcement-Body"))
	if body == "" || len(body) > 1000 {
		writeErr(w, 400, "comment must be 1-1000 characters")
		return
	}
	res, e := s.store.db.Exec(`INSERT INTO announcement_comments(announcement_id,visitor_key,body,created_at) VALUES(?,?,?,?)`, id, v, body, time.Now().Unix())
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	cid, _ := res.LastInsertId()
	writeJSON(w, 201, AnnouncementComment{ID: cid, Body: body, CreatedAt: time.Now().Unix()})
}

var _ = sql.ErrNoRows
