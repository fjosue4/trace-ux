package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// SlackTextObject is the common Slack text object used by headers, sections,
// buttons, and context elements.
type SlackTextObject struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	Emoji bool   `json:"emoji,omitempty"`
}

type SlackButton struct {
	Text string
	URL  string
}

type SlackButtonAccessory struct {
	Type string          `json:"type"`
	Text SlackTextObject `json:"text"`
	URL  string          `json:"url,omitempty"`
}

// SlackBlock covers the Block Kit block variants used by TraceUX. Keeping the
// native block shape in this backend means every Slack notification can add a
// header, action button, context footer, or divider without reverting to a
// plain text payload.
type SlackBlock struct {
	Type      string                `json:"type"`
	Text      *SlackTextObject      `json:"text,omitempty"`
	Accessory *SlackButtonAccessory `json:"accessory,omitempty"`
	Elements  []SlackTextObject     `json:"elements,omitempty"`
}

type SlackCustomMessage struct {
	Blocks []SlackBlock `json:"blocks"`
}

type SlackAdvancedMessage struct {
	Blocks []SlackBlock `json:"blocks"`
}

// SlackAdvancedMessageOptions mirrors the message builder contract used by
// the dashboard's Slack integration while remaining idiomatic for backend
// callers.
type SlackAdvancedMessageOptions struct {
	Message string
	Header  string
	Button  *SlackButton
	Footer  string
}

// CreateSlackMessage creates the smallest valid Block Kit message: one
// mrkdwn section. It is useful for simple provider tests and future events.
func CreateSlackMessage(message string) SlackCustomMessage {
	return SlackCustomMessage{Blocks: []SlackBlock{{
		Type: "section",
		Text: &SlackTextObject{Type: "mrkdwn", Text: message},
	}}}
}

// CreateSlackAdvancedMessage builds the reusable Block Kit shape used by all
// TraceUX notifications. Optional blocks are omitted, matching Slack's API
// contract and the supplied TypeScript builder.
func CreateSlackAdvancedMessage(options SlackAdvancedMessageOptions) SlackAdvancedMessage {
	blocks := make([]SlackBlock, 0, 4)
	if options.Header != "" {
		blocks = append(blocks, SlackBlock{
			Type: "header",
			Text: &SlackTextObject{Type: "plain_text", Text: options.Header, Emoji: true},
		})
	}

	section := SlackBlock{
		Type: "section",
		Text: &SlackTextObject{Type: "mrkdwn", Text: options.Message},
	}
	if options.Button != nil {
		section.Accessory = &SlackButtonAccessory{
			Type: "button",
			Text: SlackTextObject{Type: "plain_text", Text: options.Button.Text, Emoji: true},
			URL:  options.Button.URL,
		}
	}
	blocks = append(blocks, section)

	if options.Footer != "" {
		blocks = append(blocks, SlackBlock{
			Type:     "context",
			Elements: []SlackTextObject{{Type: "plain_text", Text: options.Footer, Emoji: true}},
		})
	}
	return SlackAdvancedMessage{Blocks: blocks}
}

type slackProvider struct {
	destination string
	client      *http.Client
}

func newSlackProvider(destination string, client *http.Client) (NotificationProvider, error) {
	if strings.TrimSpace(destination) == "" {
		return nil, errors.New("Slack webhook is not configured")
	}
	if client == nil {
		client = newNotificationHTTPClient()
	}
	return &slackProvider{destination: destination, client: client}, nil
}

func (p *slackProvider) Send(ctx context.Context, message NotificationMessage) error {
	payload := CreateSlackAdvancedMessage(SlackAdvancedMessageOptions{
		Message: message.Message,
		Header:  message.Header,
		Button:  notificationButtonToSlack(message.Button),
		Footer:  message.Footer,
	})
	return p.sendPayload(ctx, payload, notificationAttempts)
}

func notificationButtonToSlack(button *NotificationButton) *SlackButton {
	if button == nil {
		return nil
	}
	return &SlackButton{Text: button.Text, URL: button.URL}
}

func (p *slackProvider) sendPayload(ctx context.Context, payload any, maxAttempts int) error {
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			timer := time.NewTimer(time.Duration(attempt) * time.Second)
			select {
			case <-ctx.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return ctx.Err()
			case <-timer.C:
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.destination, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("create Slack request: %s", redactWebhookError(err, p.destination))
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := p.client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("Slack request failed: %s", redactWebhookError(err, p.destination))
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode < http.StatusMultipleChoices {
			return nil
		}
		lastErr = fmt.Errorf("Slack responded with status %d", resp.StatusCode)
		if resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode < http.StatusInternalServerError {
			return lastErr
		}
	}
	return lastErr
}

// postSlackMessage is a compatibility helper for callers that only have a
// plain message. It still serializes a Block Kit section, never Slack's legacy
// top-level {"text": ...} payload.
func (s *Server) postSlackMessage(webhookURL string, msg slackMessage, maxAttempts int) error {
	s.initNotifications()
	provider := &slackProvider{destination: webhookURL, client: s.notificationHTTPClient}
	return provider.sendPayload(context.Background(), CreateSlackMessage(msg.Text), maxAttempts)
}
