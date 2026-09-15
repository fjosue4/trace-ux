package store

import (
	"net/url"
	"strings"
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
	rows, err := s.DB.Query(q, args...)
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

func (s *Store) GetAnnouncement(id int64) (Announcement, error) {
	return scanAnnouncement(s.DB.QueryRow(announcementSelect+` FROM announcements a
		JOIN sites s ON s.id=a.site_id WHERE a.id=?`, id))
}

func ValidateAnnouncement(a Announcement) error {
	if strings.TrimSpace(a.Title) == "" || len(a.Title) > 160 {
		return errBadJSON
	}
	if len(a.Summary) > 300 || len(a.Body) > 10000 || len(a.ReleaseLabel) > 60 || len(a.LinkURL) > 500 {
		return errBadJSON
	}
	if a.LinkURL != "" && !ValidAnnouncementLink(a.LinkURL) {
		return errBadJSON
	}
	return nil
}

// ValidAnnouncementLink accepts only absolute http(s) URLs built from
// characters that are safe to interpolate into the tracker widget's markup.
// net/url happily parses `https://example.com/?a=" onfocus="alert(1)`, which
// would break out of the href attribute the widget renders, so quotes, angle
// brackets, backticks, backslashes and whitespace are rejected outright.
func ValidAnnouncementLink(raw string) bool {
	for _, c := range raw {
		if c <= ' ' || c == 0x7f || strings.ContainsRune(`"'<>`+"`"+`\`, c) {
			return false
		}
	}
	u, err := url.Parse(raw)
	return err == nil && u.Host != "" && (u.Scheme == "http" || u.Scheme == "https")
}
