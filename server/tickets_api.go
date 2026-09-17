package main

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"trace-ux/server/store"
)

func parseTicketID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

func handleTicketStoreError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, store.ErrTicketNotFound):
		writeErr(w, http.StatusNotFound, "ticket not found")
	case errors.Is(err, store.ErrTicketClosed):
		writeErr(w, http.StatusConflict, "this ticket is closed")
	case errors.Is(err, store.ErrTicketArchived):
		writeErr(w, http.StatusConflict, "this ticket is archived")
	case errors.Is(err, store.ErrTicketOpenLimit), errors.Is(err, store.ErrTicketLifetimeLimit), errors.Is(err, store.ErrTicketMessagesLimit):
		writeRateLimited(w, err.Error())
	default:
		return false
	}
	return true
}

func (s *Server) handleListTickets(w http.ResponseWriter, r *http.Request) {
	siteID, _ := strconv.ParseInt(r.URL.Query().Get("site_id"), 10, 64)
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && !store.ValidTicketStatus(status) {
		writeErr(w, http.StatusBadRequest, "invalid ticket status")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := s.store.ListTickets(store.TicketFilter{SiteID: siteID, Status: status, Limit: limit})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handleGetTicket(w http.ResponseWriter, r *http.Request) {
	id, ok := parseTicketID(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid ticket id")
		return
	}
	t, err := s.store.GetTicket(id)
	if err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	messages, err := s.store.ListTicketMessages(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, store.TicketThread{Ticket: t, Messages: messages})
}

func (s *Server) handleStaffTicketReply(w http.ResponseWriter, r *http.Request) {
	id, ok := parseTicketID(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid ticket id")
		return
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	message := strings.TrimSpace(body.Body)
	if len(message) < 1 || len(message) > store.MaxTicketBodyLen {
		writeErr(w, http.StatusBadRequest, "message must be 1-4000 characters")
		return
	}
	u := currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	newMessage, err := s.store.AddTicketMessage(id, "staff", u.ID, u.Username, message)
	if err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	t, err := s.store.GetTicket(id)
	if err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.broadcastWidgetEvent(t.SiteID, t.VisitorKey, "tickets", widgetSocketEvent{
		Type:    "ticket.message",
		Ticket:  &t,
		Message: &newMessage,
	})
	messages, err := s.store.ListTicketMessages(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, store.TicketThread{Ticket: t, Messages: messages})
}

func (s *Server) handleUpdateTicket(w http.ResponseWriter, r *http.Request) {
	id, ok := parseTicketID(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid ticket id")
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	status := strings.TrimSpace(body.Status)
	if !store.ValidTicketStatus(status) {
		writeErr(w, http.StatusBadRequest, "invalid ticket status")
		return
	}
	user := currentUser(r)
	if status == "archived" && (user == nil || user.Role != "admin") {
		writeErr(w, http.StatusForbidden, "admin only")
		return
	}
	if status != "archived" {
		current, err := s.store.GetTicket(id)
		if err != nil {
			if handleTicketStoreError(w, err) {
				return
			}
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if current.Status == "archived" && (user == nil || user.Role != "admin") {
			writeErr(w, http.StatusForbidden, "admin only")
			return
		}
	}
	if err := s.store.SetTicketStatus(id, status); err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	t, err := s.store.GetTicket(id)
	if err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.broadcastWidgetEvent(t.SiteID, t.VisitorKey, "tickets", widgetSocketEvent{
		Type:   "ticket.updated",
		Ticket: &t,
	})
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleArchiveTicket(w http.ResponseWriter, r *http.Request) {
	id, ok := parseTicketID(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid ticket id")
		return
	}
	if err := s.store.SetTicketStatus(id, "archived"); err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	t, err := s.store.GetTicket(id)
	if err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.broadcastWidgetEvent(t.SiteID, t.VisitorKey, "tickets", widgetSocketEvent{
		Type:   "ticket.updated",
		Ticket: &t,
	})
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleDeleteTicket(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Allow", "GET, PATCH")
	writeErr(w, http.StatusMethodNotAllowed, "tickets cannot be deleted; archive the ticket instead")
}

func (s *Server) allowPublicTickets(w http.ResponseWriter, r *http.Request, siteID int64, write bool) bool {
	s.initSecurity()
	limiter := s.ticketsReadLimiter
	if write {
		limiter = s.ticketsWriteLimiter
	}
	if !limiter.allow("ip:"+s.clientIP(r)) || !s.ticketsSiteLimiter.allow(fmt.Sprintf("tickets-site:%d", siteID)) {
		writeRateLimited(w, "too many support requests")
		return false
	}
	return true
}

func validPublicTicketVisitor(value string) bool {
	return len(value) >= 8 && len(value) <= 100
}

func (s *Server) handlePublicListTickets(w http.ResponseWriter, r *http.Request) {
	site, ok := s.publicSite(r)
	if !ok {
		writeErr(w, http.StatusNotFound, "unknown site")
		return
	}
	if !s.allowPublicTickets(w, r, site.ID, false) {
		return
	}
	visitor := publicVisitor(r)
	if !validPublicTicketVisitor(visitor) {
		writeErr(w, http.StatusBadRequest, "visitor is required")
		return
	}
	rows, err := s.store.ListVisitorTickets(site.ID, visitor)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load tickets")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) handlePublicCreateTicket(w http.ResponseWriter, r *http.Request) {
	site, ok := s.publicSite(r)
	if !ok {
		writeErr(w, http.StatusNotFound, "unknown site")
		return
	}
	if !s.allowPublicTickets(w, r, site.ID, true) {
		return
	}
	var input store.NewTicket
	if err := readJSON(w, r, &input); err != nil {
		return
	}
	input.SiteID = site.ID
	if err := store.NormalizeTicketInput(&input); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	open, total, err := s.store.CountVisitorTickets(site.ID, input.VisitorKey)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not check ticket limits")
		return
	}
	if open >= store.MaxOpenTicketsPerVisitor {
		writeRateLimited(w, "too many open tickets")
		return
	}
	if total >= store.MaxTicketsPerVisitor {
		writeRateLimited(w, "too many tickets")
		return
	}
	ticket, err := s.store.CreateTicket(input)
	if err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create ticket")
		return
	}
	s.broadcastWidgetEvent(ticket.SiteID, ticket.VisitorKey, "tickets", widgetSocketEvent{
		Type:   "ticket.created",
		Ticket: &ticket,
	})
	writeJSON(w, http.StatusCreated, ticket)
}

func (s *Server) handlePublicGetTicket(w http.ResponseWriter, r *http.Request) {
	site, ok := s.publicSite(r)
	if !ok {
		writeErr(w, http.StatusNotFound, "unknown site")
		return
	}
	id, ok := parseTicketID(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid ticket id")
		return
	}
	if !s.allowPublicTickets(w, r, site.ID, false) {
		return
	}
	visitor := publicVisitor(r)
	if !validPublicTicketVisitor(visitor) {
		writeErr(w, http.StatusBadRequest, "visitor is required")
		return
	}
	ticket, err := s.store.GetTicketForVisitor(site.ID, id, visitor)
	if err != nil {
		// Keep the authorization result flat so callers cannot distinguish an
		// existing ticket belonging to another visitor or site.
		if errors.Is(err, store.ErrTicketNotFound) {
			writeErr(w, http.StatusNotFound, "ticket not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not load ticket")
		return
	}
	messages, err := s.store.ListTicketMessages(ticket.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load ticket messages")
		return
	}
	writeJSON(w, http.StatusOK, store.TicketThread{Ticket: ticket, Messages: messages})
}

func (s *Server) handlePublicTicketReply(w http.ResponseWriter, r *http.Request) {
	site, ok := s.publicSite(r)
	if !ok {
		writeErr(w, http.StatusNotFound, "unknown site")
		return
	}
	id, ok := parseTicketID(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid ticket id")
		return
	}
	if !s.allowPublicTickets(w, r, site.ID, true) {
		return
	}
	var body struct {
		VisitorKey string `json:"visitor_key"`
		Body       string `json:"body"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return
	}
	body.VisitorKey = strings.TrimSpace(body.VisitorKey)
	if !validPublicTicketVisitor(body.VisitorKey) {
		writeErr(w, http.StatusBadRequest, "visitor is required")
		return
	}
	message := strings.TrimSpace(body.Body)
	if len(message) < 1 || len(message) > store.MaxTicketBodyLen {
		writeErr(w, http.StatusBadRequest, "message must be 1-4000 characters")
		return
	}
	ticket, err := s.store.GetTicketForVisitor(site.ID, id, body.VisitorKey)
	if err != nil {
		if errors.Is(err, store.ErrTicketNotFound) {
			writeErr(w, http.StatusNotFound, "ticket not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not load ticket")
		return
	}
	newMessage, err := s.store.AddTicketMessage(ticket.ID, "visitor", 0, "", message)
	if err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not add ticket message")
		return
	}
	ticket, err = s.store.GetTicketForVisitor(site.ID, id, body.VisitorKey)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load ticket")
		return
	}
	s.broadcastWidgetEvent(ticket.SiteID, ticket.VisitorKey, "tickets", widgetSocketEvent{
		Type:    "ticket.message",
		Ticket:  &ticket,
		Message: &newMessage,
	})
	messages, err := s.store.ListTicketMessages(ticket.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load ticket messages")
		return
	}
	writeJSON(w, http.StatusOK, store.TicketThread{Ticket: ticket, Messages: messages})
}

// POST /api/tickets — a staff member opens the conversation.
//
// The ticket is delivered through the visitor's widget, so it needs that
// visitor's key: take it from the announcement comment, reaction or feedback
// row the ticket is being raised from. An email is always required here even
// when the visitor is identified, because it is the only way to reach someone
// who never comes back to the site — TraceUX does not send it, it stores it so
// a human can.
func (s *Server) handleCreateStaffTicket(w http.ResponseWriter, r *http.Request) {
	var input store.NewTicket
	if readJSON(w, r, &input) != nil {
		return
	}
	if input.SiteID <= 0 {
		writeErr(w, http.StatusBadRequest, "site_id is required")
		return
	}
	if err := store.NormalizeTicketInput(&input); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if input.Email == "" {
		writeErr(w, http.StatusBadRequest, "an email address is required to contact this visitor")
		return
	}

	user := currentUser(r)
	input.Author = "staff"
	if user != nil {
		input.StaffUserID = user.ID
		input.StaffName = user.Username
	}

	ticket, err := s.store.CreateTicket(input)
	if err != nil {
		if handleTicketStoreError(w, err) {
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create ticket")
		return
	}
	s.broadcastWidgetEvent(ticket.SiteID, ticket.VisitorKey, "tickets", widgetSocketEvent{
		Type:   "ticket.created",
		Ticket: &ticket,
	})
	writeJSON(w, http.StatusCreated, ticket)
}
