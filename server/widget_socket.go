package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	widgetSocketWriteWait      = 10 * time.Second
	widgetSocketPongWait       = 60 * time.Second
	widgetSocketPingPeriod     = (widgetSocketPongWait * 9) / 10
	widgetSocketMaxMessageSize = 1024
)

type widgetSocketEvent struct {
	Type         string         `json:"type"`
	ID           int64          `json:"id,omitempty"`
	Announcement *Announcement  `json:"announcement,omitempty"`
	Ticket       *Ticket        `json:"ticket,omitempty"`
	Message      *TicketMessage `json:"message,omitempty"`
}

type widgetSocketClient struct {
	conn       *websocket.Conn
	siteID     int64
	visitorKey string
	updates    bool
	tickets    bool
	// dashboardTickets receives authenticated ticket events for every site.
	dashboardTickets bool
	send       chan []byte
}

type widgetSocketHub struct {
	mu      sync.Mutex
	clients map[*widgetSocketClient]struct{}
}

func newWidgetSocketHub() *widgetSocketHub {
	return &widgetSocketHub{clients: make(map[*widgetSocketClient]struct{})}
}

func (s *Server) widgetSocketHub() *widgetSocketHub {
	s.widgetSocketOnce.Do(func() {
		s.widgetSockets = newWidgetSocketHub()
	})
	return s.widgetSockets
}

func (h *widgetSocketHub) add(client *widgetSocketClient) {
	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()
}

func (h *widgetSocketHub) remove(client *widgetSocketClient) {
	h.mu.Lock()
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		close(client.send)
	}
	h.mu.Unlock()
}

func (h *widgetSocketHub) broadcast(siteID int64, visitorKey, channel string, payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for client := range h.clients {
		if client.dashboardTickets {
			if channel != "tickets" {
				continue
			}
		} else {
			if client.siteID != siteID {
				continue
			}
			if channel == "updates" {
				if !client.updates {
					continue
				}
			} else if channel == "tickets" {
				if !client.tickets || client.visitorKey != visitorKey {
					continue
				}
			} else {
				continue
			}
		}

		// A wedged browser must not hold the hub lock or consume unbounded
		// memory. Dropping that connection lets its read/write pumps clean up.
		select {
		case client.send <- payload:
		default:
			delete(h.clients, client)
			close(client.send)
			_ = client.conn.Close()
		}
	}
}

func (client *widgetSocketClient) writePump() {
	ticker := time.NewTicker(widgetSocketPingPeriod)
	defer func() {
		ticker.Stop()
		_ = client.conn.Close()
	}()

	for {
		select {
		case payload, ok := <-client.send:
			_ = client.conn.SetWriteDeadline(time.Now().Add(widgetSocketWriteWait))
			if !ok {
				_ = client.conn.WriteControl(
					websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
					time.Now().Add(widgetSocketWriteWait),
				)
				return
			}
			if err := client.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		case <-ticker.C:
			_ = client.conn.SetWriteDeadline(time.Now().Add(widgetSocketWriteWait))
			if err := client.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (client *widgetSocketClient) readPump() {
	defer client.conn.Close()
	client.conn.SetReadLimit(widgetSocketMaxMessageSize)
	_ = client.conn.SetReadDeadline(time.Now().Add(widgetSocketPongWait))
	client.conn.SetPongHandler(func(string) error {
		return client.conn.SetReadDeadline(time.Now().Add(widgetSocketPongWait))
	})
	for {
		if _, _, err := client.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func requestedWidgetSocketChannel(raw, wanted string) bool {
	for _, channel := range strings.Split(strings.ToLower(raw), ",") {
		if strings.TrimSpace(channel) == wanted {
			return true
		}
	}
	return false
}

func (s *Server) handleWidgetSocket(w http.ResponseWriter, r *http.Request) {
	site, ok := s.publicSite(r)
	if !ok || !site.Settings.WidgetOn() {
		writeErr(w, http.StatusNotFound, "unknown site")
		return
	}

	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" && !s.originAllowed(r.URL.Path, origin) {
		writeErr(w, http.StatusForbidden, "origin not registered for this site")
		return
	}

	s.initSecurity()
	if !s.widgetSocketLimiter.allow("ip:"+s.clientIP(r)) ||
		!s.widgetSocketSiteLimiter.allow("widget-site:"+strconv.FormatInt(site.ID, 10)) {
		writeRateLimited(w, "too many widget connections")
		return
	}

	visitor := strings.TrimSpace(r.URL.Query().Get("visitor"))
	if !validPublicTicketVisitor(visitor) {
		writeErr(w, http.StatusBadRequest, "visitor is required")
		return
	}
	updates := requestedWidgetSocketChannel(r.URL.Query().Get("channels"), "updates") && site.Settings.UpdatesEnabled
	tickets := requestedWidgetSocketChannel(r.URL.Query().Get("channels"), "tickets") && site.Settings.TicketsEnabled
	if !updates && !tickets {
		writeErr(w, http.StatusBadRequest, "no active widget channels")
		return
	}

	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 4096,
		CheckOrigin: func(req *http.Request) bool {
			requestOrigin := strings.TrimSpace(req.Header.Get("Origin"))
			return requestOrigin == "" || s.originAllowed(req.URL.Path, requestOrigin)
		},
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &widgetSocketClient{
		conn:       conn,
		siteID:     site.ID,
		visitorKey: visitor,
		updates:    updates,
		tickets:    tickets,
		send:       make(chan []byte, 16),
	}
	hub := s.widgetSocketHub()
	hub.add(client)
	defer hub.remove(client)
	go client.writePump()
	client.readPump()
}

// handleDashboardTicketSocket is the authenticated counterpart to the public
// widget socket. It intentionally has no site or visitor filter: the
// dashboard's ticket inbox is cross-site, and auth has already established
// that the caller is allowed to see it.
func (s *Server) handleDashboardTicketSocket(w http.ResponseWriter, r *http.Request) {
	if !sameOriginRequest(r) {
		writeErr(w, http.StatusForbidden, "cross-origin request blocked")
		return
	}
	s.initSecurity()
	if !s.widgetSocketLimiter.allow("dashboard-ip:" + s.clientIP(r)) {
		writeRateLimited(w, "too many dashboard connections")
		return
	}

	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 4096,
		CheckOrigin: func(req *http.Request) bool {
			return sameOriginRequest(req)
		},
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &widgetSocketClient{
		conn:             conn,
		dashboardTickets: true,
		send:             make(chan []byte, 16),
	}
	hub := s.widgetSocketHub()
	hub.add(client)
	defer hub.remove(client)
	go client.writePump()
	client.readPump()
}

func (s *Server) broadcastWidgetEvent(siteID int64, visitorKey, channel string, event widgetSocketEvent) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	s.widgetSocketHub().broadcast(siteID, visitorKey, channel, payload)
}
