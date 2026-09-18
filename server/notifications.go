package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"
)

// NotificationMessage is provider-neutral content. Providers translate it
// into their own native payload (Slack Block Kit today; another provider can
// render the same message into its own format without changing event hooks).
type NotificationMessage struct {
	Header  string
	Message string
	Button  *NotificationButton
	Footer  string
}

type NotificationButton struct {
	Text string
	URL  string
}

// NotificationProvider delivers a provider-neutral notification. Keeping the
// transport contract small makes it possible to add email, Teams, or another
// provider without teaching ticket/log/health producers about that provider's
// wire format.
type NotificationProvider interface {
	Send(context.Context, NotificationMessage) error
}

type notificationProviderFactory func(destination string, client *http.Client) (NotificationProvider, error)

// notificationDestinationResolver resolves the destination for one
// notification kind. siteID is the site the event belongs to (tickets, logs,
// custom events); it is ignored for instance-wide kinds like "system", which
// has no site to attach to.
type notificationDestinationResolver func(kind string, siteID int64) (destination string, enabled bool, err error)

type notificationProviderDefinition struct {
	Factory notificationProviderFactory
	Resolve notificationDestinationResolver
}

type notificationJob struct {
	Provider string
	Kind     string
	SiteID   int64
	Message  NotificationMessage
}

const (
	notificationProviderSlack = "slack"
	notificationQueueSize     = 200
	notificationHTTPTimeout   = 5 * time.Second
	notificationAttempts      = 3
)

func newNotificationHTTPClient() *http.Client {
	return &http.Client{
		Timeout: notificationHTTPTimeout,
		// A webhook is an outbound secret-bearing destination. Do not let a
		// redirect turn a validated Slack URL into a request to an arbitrary
		// host.
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// initNotifications lazily creates the shared provider registry, queue, and
// worker. The queue is intentionally bounded and non-blocking at the event
// producer so a slow integration cannot delay a public ingest request.
func (s *Server) initNotifications() {
	s.notificationOnce.Do(func() {
		s.notificationQueue = make(chan notificationJob, notificationQueueSize)
		s.notificationHTTPClient = newNotificationHTTPClient()
		s.notificationProviders = map[string]notificationProviderDefinition{
			notificationProviderSlack: {
				Factory: newSlackProvider,
				Resolve: s.resolveSlackNotificationDestination,
			},
		}
		// Health crossing state is related to monitoring, not queue startup. It
		// is initialized here as well as defensively in the monitor so a test or
		// future monitor can evaluate state before the first delivery.
		s.slackHealthMu.Lock()
		if s.slackHealthAbove == nil {
			s.slackHealthAbove = make(map[string]bool)
		}
		s.slackHealthMu.Unlock()
		go s.runNotificationDispatcher()
	})
}

func (s *Server) runNotificationDispatcher() {
	for job := range s.notificationQueue {
		s.deliverNotificationJob(job)
	}
}

func (s *Server) enqueueNotification(provider, kind string, siteID int64, message NotificationMessage) {
	s.initNotifications()
	select {
	case s.notificationQueue <- notificationJob{Provider: provider, Kind: kind, SiteID: siteID, Message: message}:
	default:
		log.Printf("notifications: queue full; dropping a %s %s notification", provider, kind)
	}
}

// enqueueSlackNotification is retained as a small compatibility helper for
// simple callers. New producers should use enqueueNotification with a full
// NotificationMessage so providers can use their richer native formats.
func (s *Server) enqueueSlackNotification(kind string, siteID int64, text string) {
	s.enqueueNotification(notificationProviderSlack, kind, siteID, NotificationMessage{Message: text})
}

func (s *Server) deliverNotificationJob(job notificationJob) {
	s.initNotifications()
	definition, ok := s.notificationProviders[job.Provider]
	if !ok || definition.Factory == nil || definition.Resolve == nil {
		log.Printf("notifications: unknown provider %q", job.Provider)
		return
	}

	destination, enabled, err := definition.Resolve(job.Kind, job.SiteID)
	if err != nil {
		log.Printf("notifications: could not resolve %s %s destination: %v", job.Provider, job.Kind, err)
		return
	}
	if !enabled || destination == "" {
		return // disabled or cleared since the notification was enqueued
	}

	provider, err := definition.Factory(destination, s.notificationHTTPClient)
	if err != nil {
		log.Printf("notifications: could not create %s provider: %v", job.Provider, err)
		return
	}
	if err := provider.Send(context.Background(), job.Message); err != nil {
		log.Printf("notifications: %s %s delivery failed: %v", job.Provider, job.Kind, err)
	}
}

// initSlack and postSlackMessage are kept as narrow compatibility shims for
// existing tests/callers while the actual delivery machinery is provider
// neutral. They can be removed once downstream users have moved to the
// NotificationProvider contract.
func (s *Server) initSlack() { s.initNotifications() }

func (s *Server) provider(name, destination string) (NotificationProvider, error) {
	s.initNotifications()
	definition, ok := s.notificationProviders[name]
	if !ok || definition.Factory == nil {
		return nil, fmt.Errorf("unknown notification provider %q", name)
	}
	return definition.Factory(destination, s.notificationHTTPClient)
}
