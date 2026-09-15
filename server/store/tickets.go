package store

import (
	"database/sql"
	"errors"
	"net/url"
	"strings"
	"time"
)

const (
	MaxOpenTicketsPerVisitor = 5
	MaxTicketsPerVisitor     = 25
	MaxMessagesPerTicket     = 100
	maxTicketSubjectLen      = 120
	MaxTicketBodyLen         = 4000
)

var (
	ErrTicketNotFound      = errors.New("ticket not found")
	ErrTicketOpenLimit     = errors.New("too many open tickets")
	ErrTicketLifetimeLimit = errors.New("too many tickets")
	ErrTicketMessagesLimit = errors.New("too many messages")
	ErrTicketClosed        = errors.New("this ticket is closed")
)

type Ticket struct {
	ID                int64  `json:"id"`
	SiteID            int64  `json:"site_id"`
	SiteName          string `json:"site_name,omitempty"`
	VisitorKey        string `json:"-"`
	UserID            string `json:"user_id,omitempty"`
	Email             string `json:"email,omitempty"`
	Name              string `json:"name,omitempty"`
	Subject           string `json:"subject"`
	Status            string `json:"status"`
	SessionID         string `json:"session_id,omitempty"`
	PageURL           string `json:"page_url,omitempty"`
	MessageCount      int    `json:"message_count"`
	LastMessageAt     int64  `json:"last_message_at"`
	LastMessageAuthor string `json:"last_message_author"`
	CreatedAt         int64  `json:"created_at"`
	UpdatedAt         int64  `json:"updated_at"`
}

type TicketMessage struct {
	ID         int64  `json:"id"`
	TicketID   int64  `json:"ticket_id"`
	Author     string `json:"author"`
	UserID     int64  `json:"user_id"`
	AuthorName string `json:"author_name,omitempty"`
	Body       string `json:"body"`
	CreatedAt  int64  `json:"created_at"`
}

type TicketThread struct {
	Ticket   Ticket          `json:"ticket"`
	Messages []TicketMessage `json:"messages"`
}

type TicketFilter struct {
	SiteID int64
	Status string
	Limit  int
}

type NewTicket struct {
	SiteID     int64  `json:"site_id,omitempty"`
	VisitorKey string `json:"visitor_key"`
	UserID     string `json:"user_id"`
	Email      string `json:"email"`
	Name       string `json:"name"`
	Subject    string `json:"subject"`
	Body       string `json:"body"`
	SessionID  string `json:"session_id"`
	PageURL    string `json:"page_url"`

	// Author of the opening message. Empty means "visitor", the public path.
	// A staff member can also start the conversation from the dashboard, in
	// which case the ticket is delivered to that visitor's widget on their
	// next visit and the per-visitor abuse caps do not apply — those exist to
	// bound the unauthenticated surface, not our own inbox.
	Author      string `json:"-"`
	StaffUserID int64  `json:"-"`
	StaffName   string `json:"-"`
}

const ticketColumns = `t.id,t.site_id,t.visitor_key,t.user_id,t.email,t.name,t.subject,t.status,
	t.session_id,t.page_url,t.message_count,t.last_message_at,t.last_message_author,t.created_at,t.updated_at`

func scanTicket(row interface{ Scan(...any) error }, withSiteName bool) (Ticket, error) {
	var t Ticket
	dest := []any{
		&t.ID, &t.SiteID, &t.VisitorKey, &t.UserID, &t.Email, &t.Name, &t.Subject,
		&t.Status, &t.SessionID, &t.PageURL, &t.MessageCount, &t.LastMessageAt,
		&t.LastMessageAuthor, &t.CreatedAt, &t.UpdatedAt,
	}
	if withSiteName {
		dest = append(dest, &t.SiteName)
	}
	return t, row.Scan(dest...)
}

func (s *Store) CreateTicket(input NewTicket) (Ticket, error) {
	now := time.Now().Unix()
	if input.SessionID != "" {
		if err := s.EnsureSessionForSite(input.SiteID, input.SessionID, now); err != nil {
			if errors.Is(err, ErrSessionSiteMismatch) {
				input.SessionID = ""
			} else {
				return Ticket{}, err
			}
		}
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return Ticket{}, err
	}
	defer tx.Rollback()

	author := "visitor"
	if input.Author == "staff" {
		author = "staff"
	}

	if author == "visitor" {
		var openCount, totalCount int64
		if err := tx.QueryRow(`SELECT COALESCE(SUM(CASE WHEN status <> 'closed' THEN 1 ELSE 0 END),0), COUNT(*)
			FROM tickets WHERE site_id=? AND visitor_key=?`, input.SiteID, input.VisitorKey).Scan(&openCount, &totalCount); err != nil {
			return Ticket{}, err
		}
		if openCount >= MaxOpenTicketsPerVisitor {
			return Ticket{}, ErrTicketOpenLimit
		}
		if totalCount >= MaxTicketsPerVisitor {
			return Ticket{}, ErrTicketLifetimeLimit
		}
	}

	res, err := tx.Exec(`INSERT INTO tickets(site_id,visitor_key,user_id,email,name,subject,status,session_id,page_url,message_count,last_message_at,last_message_author,created_at,updated_at)
		VALUES(?,?,?,?,?,?,'open',?,?,?,?,?,?,?)`,
		input.SiteID, input.VisitorKey, input.UserID, input.Email, input.Name, input.Subject,
		input.SessionID, input.PageURL, 1, now, author, now, now)
	if err != nil {
		return Ticket{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Ticket{}, err
	}
	if _, err := tx.Exec(`INSERT INTO ticket_messages(ticket_id,author,user_id,author_name,body,created_at) VALUES(?,?,?,?,?,?)`,
		id, author, input.StaffUserID, input.StaffName, input.Body, now); err != nil {
		return Ticket{}, err
	}
	if err := tx.Commit(); err != nil {
		return Ticket{}, err
	}
	return Ticket{
		ID: id, SiteID: input.SiteID, VisitorKey: input.VisitorKey, UserID: input.UserID,
		Email: input.Email, Name: input.Name, Subject: input.Subject, Status: "open",
		SessionID: input.SessionID, PageURL: input.PageURL, MessageCount: 1,
		LastMessageAt: now, LastMessageAuthor: author, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (s *Store) ListTickets(f TicketFilter) ([]Ticket, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 100
	}
	q := `SELECT ` + ticketColumns + `,s.name FROM tickets t JOIN sites s ON s.id=t.site_id WHERE 1=1`
	args := []any{}
	if f.SiteID > 0 {
		q += ` AND t.site_id=?`
		args = append(args, f.SiteID)
	}
	if f.Status != "" {
		q += ` AND t.status=?`
		args = append(args, f.Status)
	}
	q += ` ORDER BY t.last_message_at DESC,t.id DESC LIMIT ?`
	args = append(args, f.Limit)
	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Ticket{}
	for rows.Next() {
		t, err := scanTicket(rows, true)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) ListVisitorTickets(siteID int64, visitorKey string) ([]Ticket, error) {
	rows, err := s.DB.Query(`SELECT `+ticketColumns+` FROM tickets t
		WHERE t.site_id=? AND t.visitor_key=? ORDER BY t.last_message_at DESC,t.id DESC`, siteID, visitorKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Ticket{}
	for rows.Next() {
		t, err := scanTicket(rows, false)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) GetTicket(id int64) (Ticket, error) {
	t, err := scanTicket(s.DB.QueryRow(`SELECT `+ticketColumns+`,s.name FROM tickets t JOIN sites s ON s.id=t.site_id WHERE t.id=?`, id), true)
	if errors.Is(err, sql.ErrNoRows) {
		return Ticket{}, ErrTicketNotFound
	}
	return t, err
}

func (s *Store) GetTicketForVisitor(siteID, id int64, visitorKey string) (Ticket, error) {
	t, err := scanTicket(s.DB.QueryRow(`SELECT `+ticketColumns+` FROM tickets t WHERE t.id=? AND t.site_id=? AND t.visitor_key=?`, id, siteID, visitorKey), false)
	if errors.Is(err, sql.ErrNoRows) {
		return Ticket{}, ErrTicketNotFound
	}
	return t, err
}

func (s *Store) ListTicketMessages(ticketID int64) ([]TicketMessage, error) {
	rows, err := s.DB.Query(`SELECT id,ticket_id,author,user_id,author_name,body,created_at
		FROM ticket_messages WHERE ticket_id=? ORDER BY created_at ASC,id ASC`, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TicketMessage{}
	for rows.Next() {
		var m TicketMessage
		if err := rows.Scan(&m.ID, &m.TicketID, &m.Author, &m.UserID, &m.AuthorName, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) AddTicketMessage(ticketID int64, author string, userID int64, authorName, body string) (TicketMessage, error) {
	if author != "visitor" && author != "staff" {
		return TicketMessage{}, errBadJSON
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return TicketMessage{}, err
	}
	defer tx.Rollback()
	var status string
	var messageCount int
	if err := tx.QueryRow(`SELECT status,message_count FROM tickets WHERE id=?`, ticketID).Scan(&status, &messageCount); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return TicketMessage{}, ErrTicketNotFound
		}
		return TicketMessage{}, err
	}
	if author == "visitor" && status == "closed" {
		return TicketMessage{}, ErrTicketClosed
	}
	if messageCount >= MaxMessagesPerTicket {
		return TicketMessage{}, ErrTicketMessagesLimit
	}
	now := time.Now().Unix()
	res, err := tx.Exec(`INSERT INTO ticket_messages(ticket_id,author,user_id,author_name,body,created_at) VALUES(?,?,?,?,?,?)`,
		ticketID, author, userID, authorName, body, now)
	if err != nil {
		return TicketMessage{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return TicketMessage{}, err
	}
	newStatus := status
	if author == "staff" && status == "open" {
		newStatus = "in_progress"
	}
	if _, err := tx.Exec(`UPDATE tickets SET status=?,message_count=?,last_message_at=?,last_message_author=?,updated_at=? WHERE id=?`,
		newStatus, messageCount+1, now, author, now, ticketID); err != nil {
		return TicketMessage{}, err
	}
	if err := tx.Commit(); err != nil {
		return TicketMessage{}, err
	}
	return TicketMessage{ID: id, TicketID: ticketID, Author: author, UserID: userID, AuthorName: authorName, Body: body, CreatedAt: now}, nil
}

func (s *Store) SetTicketStatus(id int64, status string) error {
	if !ValidTicketStatus(status) {
		return errBadJSON
	}
	res, err := s.DB.Exec(`UPDATE tickets SET status=?,updated_at=? WHERE id=?`, status, time.Now().Unix(), id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return ErrTicketNotFound
	}
	return err
}

func (s *Store) DeleteTicket(id int64) error {
	res, err := s.DB.Exec(`DELETE FROM tickets WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return ErrTicketNotFound
	}
	return err
}

func (s *Store) CountVisitorTickets(siteID int64, visitorKey string) (open, total int64, err error) {
	err = s.DB.QueryRow(`SELECT COALESCE(SUM(CASE WHEN status <> 'closed' THEN 1 ELSE 0 END),0),COUNT(*)
		FROM tickets WHERE site_id=? AND visitor_key=?`, siteID, visitorKey).Scan(&open, &total)
	return
}

func ValidTicketStatus(status string) bool {
	switch status {
	case "open", "in_progress", "under_review", "closed":
		return true
	default:
		return false
	}
}

func NormalizeTicketInput(input *NewTicket) error {
	input.VisitorKey = strings.TrimSpace(input.VisitorKey)
	if len(input.VisitorKey) < 8 || len(input.VisitorKey) > 100 {
		return errors.New("visitor_key must be 8-100 characters")
	}
	input.Subject = strings.TrimSpace(input.Subject)
	input.Body = strings.TrimSpace(input.Body)
	if len(input.Subject) < 1 || len(input.Subject) > maxTicketSubjectLen {
		return errors.New("subject must be 1-120 characters")
	}
	if len(input.Body) < 1 || len(input.Body) > MaxTicketBodyLen {
		return errors.New("message must be 1-4000 characters")
	}
	if len(input.UserID) > 200 {
		return errors.New("user_id must be at most 200 characters")
	}
	input.Name = strings.TrimSpace(input.Name)
	if len(input.Name) > 80 {
		return errors.New("name must be at most 80 characters")
	}
	input.Email = strings.TrimSpace(input.Email)
	if strings.TrimSpace(input.UserID) == "" {
		if !validTicketEmail(input.Email) {
			return errors.New("a valid email is required when user_id is empty")
		}
	}
	if len(input.Email) > 200 || (input.Email != "" && !validTicketEmail(input.Email)) {
		return errors.New("invalid email")
	}
	if len(input.SessionID) > 64 || (input.SessionID != "" && !validTicketSessionID(input.SessionID)) {
		input.SessionID = ""
	}
	if len(input.PageURL) > 500 || (input.PageURL != "" && !validTicketPageURL(input.PageURL)) {
		input.PageURL = ""
	}
	return nil
}

func validTicketEmail(email string) bool {
	if len(email) < 5 || len(email) > 200 || strings.ContainsAny(email, " \t\r\n") || strings.Count(email, "@") != 1 {
		return false
	}
	at := strings.IndexByte(email, '@')
	return at > 0 && at < len(email)-1 && strings.IndexByte(email[at+1:], '.') >= 1 && !strings.HasSuffix(email, ".")
}

func validTicketSessionID(value string) bool {
	for _, c := range value {
		if (c < 'A' || c > 'Z') && (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '_' && c != '-' {
			return false
		}
	}
	return true
}

func validTicketPageURL(value string) bool {
	if strings.IndexFunc(value, func(r rune) bool { return r <= ' ' || r == '"' || r == '\'' || r == '<' || r == '>' || r == '`' }) >= 0 {
		return false
	}
	u, err := url.Parse(value)
	return err == nil && u.Host != "" && (u.Scheme == "http" || u.Scheme == "https")
}
