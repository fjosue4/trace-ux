package store

import (
	"database/sql"
	"errors"
	"strings"
)

// SessionContactKeyPrefix marks a ticket key made up for a recording whose
// visitor never touched the widget. No browser holds such a key, so the
// conversation lives only in the dashboard and is carried on by email.
const SessionContactKeyPrefix = "session-"

// ErrSessionNotIdentified means the recording's visitor never gave the site a
// user_id. Staff cannot tell who that is, so no ticket can be opened for them.
var ErrSessionNotIdentified = errors.New("this visitor was never identified, so a ticket cannot be opened for them")

// SessionContact is how staff can reach the visitor behind one recording.
type SessionContact struct {
	SiteID int64 `json:"site_id"`
	// VisitorKey addresses a ticket to a widget. When InWidget is false it is
	// a stand-in that no widget will ever ask for.
	VisitorKey string `json:"visitor_key"`
	InWidget   bool   `json:"in_widget"`
	UserID     string `json:"user_id,omitempty"`
	// Email is the address this visitor gave on an earlier ticket, if any.
	Email string `json:"email,omitempty"`
}

// SessionContact finds the widget key of the visitor behind a recording.
// Sessions do not store it, but anything the visitor did through the widget
// during the recording does: a ticket, a feedback answer, a survey shown to
// them. Failing that, the visitor's user_id is matched with what they did
// through the widget on other visits to the same site. Only identified
// visitors qualify: see ErrSessionNotIdentified. The most
// recent match wins, preferring this recording's own.
func (s *Store) SessionContact(sessionID string) (SessionContact, error) {
	session, err := s.GetSession(sessionID)
	if err != nil {
		return SessionContact{}, err
	}
	contact := SessionContact{SiteID: session.SiteID, UserID: strings.TrimSpace(session.UserID)}
	if contact.UserID == "" {
		return SessionContact{}, ErrSessionNotIdentified
	}

	var key string
	err = s.DB.QueryRow(`SELECT visitor_key FROM (
		SELECT visitor_key, 0 AS pref, created_at AS at FROM tickets
			WHERE session_id = ?1 AND visitor_key NOT LIKE ?4
		UNION ALL SELECT visitor_key, 0, created_at FROM feedback
			WHERE session_id = ?1 AND visitor_key <> ''
		UNION ALL SELECT visitor_key, 0, created_at FROM feedback_deliveries
			WHERE session_id = ?1 AND visitor_key <> ''
		UNION ALL SELECT visitor_key, 1, created_at FROM tickets
			WHERE ?3 <> '' AND site_id = ?2 AND user_id = ?3 AND visitor_key NOT LIKE ?4
		UNION ALL SELECT visitor_key, 1, created_at FROM feedback
			WHERE ?3 <> '' AND site_id = ?2 AND user_id = ?3 AND visitor_key <> ''
		UNION ALL SELECT visitor_key, 1, created_at FROM feedback_deliveries
			WHERE ?3 <> '' AND site_id = ?2 AND user_id = ?3 AND visitor_key <> ''
		UNION ALL SELECT c.visitor_key, 1, c.created_at FROM announcement_comments c
			JOIN announcements a ON a.id = c.announcement_id
			WHERE ?3 <> '' AND a.site_id = ?2 AND c.user_id = ?3
		UNION ALL SELECT r.visitor_key, 1, r.created_at FROM announcement_reactions r
			JOIN announcements a ON a.id = r.announcement_id
			WHERE ?3 <> '' AND a.site_id = ?2 AND r.user_id = ?3
		UNION ALL SELECT r.visitor_key, 1, r.read_at FROM announcement_reads r
			JOIN announcements a ON a.id = r.announcement_id
			WHERE ?3 <> '' AND a.site_id = ?2 AND r.user_id = ?3
	) ORDER BY pref, at DESC LIMIT 1`,
		sessionID, session.SiteID, contact.UserID, SessionContactKeyPrefix+"%").Scan(&key)
	switch {
	case err == nil && len(key) >= 8 && len(key) <= 100:
		contact.VisitorKey, contact.InWidget = key, true
	case err == nil, errors.Is(err, sql.ErrNoRows):
		contact.VisitorKey = SessionContactKeyPrefix + sessionID
	default:
		return SessionContact{}, err
	}

	// The address this visitor gave before, so staff need not ask again.
	err = s.DB.QueryRow(`SELECT email FROM tickets
		WHERE site_id = ?1 AND email <> ''
			AND (session_id = ?2 OR visitor_key = ?3 OR (?4 <> '' AND user_id = ?4))
		ORDER BY created_at DESC LIMIT 1`,
		session.SiteID, sessionID, contact.VisitorKey, contact.UserID).Scan(&contact.Email)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return SessionContact{}, err
	}
	return contact, nil
}
