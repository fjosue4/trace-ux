package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"

	"trace-ux/server/store"
)

// ---- Slack notification delivery ----
//
// Notifications are built on the request path (cheap: one indexed row read)
// but delivered off it, through a small bounded queue and a background
// worker, so a slow or unreachable Slack endpoint never delays ticket
// responses or browser-log ingest. System health is polled independently on
// its own timer since it has no request to piggyback on.

const (
	slackHealthPollEvery = 30 * time.Second
	slackHealthThreshold = 90.0

	// Slack's own payload ceiling is far larger than this; these caps exist so
	// one oversized log message or ticket body cannot dominate a notification.
	slackMaxFieldLen     = 300
	slackMaxSubjectLen   = 200
	slackMaxDetailsLen   = 1_000
	slackMaxDetailsBlock = 2_800 // Slack section text is limited to 3,000 chars.
	slackCustomCooldown  = 10 * time.Second
)

type slackMessage struct {
	Text string
}

// ---- Message builders ----

// truncateForSlack shortens text to at most max runes, cutting on a rune
// boundary so a message with non-ASCII characters near the limit never comes
// out as invalid UTF-8.
func truncateForSlack(text string, max int) string {
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	if max <= 1 {
		return string(runes[:max])
	}
	return string(runes[:max-1]) + "…"
}

func buildTicketSlackText(t store.Ticket, body, origin string) string {
	who := strings.TrimSpace(t.Name)
	if who == "" {
		who = strings.TrimSpace(t.Email)
	}
	if who == "" {
		who = "a visitor"
	}
	lines := []string{
		fmt.Sprintf("*New support ticket* on %s", t.SiteName),
		fmt.Sprintf("#%d — %s", t.ID, truncateForSlack(t.Subject, slackMaxSubjectLen)),
		"From: " + truncateForSlack(who, 120),
	}
	if body = strings.TrimSpace(body); body != "" {
		lines = append(lines, truncateForSlack(body, slackMaxFieldLen))
	}
	lines = append(lines, fmt.Sprintf("<%s/tickets?ticket=%d|Open ticket>", origin, t.ID))
	return strings.Join(lines, "\n")
}

const maxSlackLogLines = 20

func buildLogsSlackText(siteName string, logs []store.Log, origin string) string {
	lines := []string{fmt.Sprintf("*%d browser log(s)* on %s", len(logs), siteName)}
	shown := logs
	if len(shown) > maxSlackLogLines {
		shown = shown[:maxSlackLogLines]
	}
	for _, l := range shown {
		line := fmt.Sprintf("[%s] %s", strings.ToUpper(l.Severity), truncateForSlack(l.Message, slackMaxFieldLen))
		if l.URL != "" {
			line += " — " + truncateForSlack(l.URL, 150)
		}
		if l.SessionID != "" {
			line += fmt.Sprintf(" (<%s/replay/%s|replay>)", origin, l.SessionID)
		}
		lines = append(lines, line)
	}
	if extra := len(logs) - len(shown); extra > 0 {
		lines = append(lines, fmt.Sprintf("… and %d more", extra))
	}
	return strings.Join(lines, "\n")
}

type systemHealthAlert struct {
	Metric string
	Pct    float64
}

func buildSystemHealthSlackText(alerts []systemHealthAlert) string {
	lines := []string{"*TraceUX system health alert* — above 90%:"}
	for _, a := range alerts {
		lines = append(lines, fmt.Sprintf("%s: %.1f%%", a.Metric, a.Pct))
	}
	return strings.Join(lines, "\n")
}

// slackMrkdwn escapes user-controlled values before they are placed in a
// Slack mrkdwn block. Newlines remain useful for messages, while ampersands
// and angle brackets cannot accidentally create Slack mentions or links.
func slackMrkdwn(value string) string {
	value = strings.ReplaceAll(value, "&", "&amp;")
	value = strings.ReplaceAll(value, "<", "&lt;")
	value = strings.ReplaceAll(value, ">", "&gt;")
	return strings.ReplaceAll(value, "`", "'")
}

func buildTicketSlackMessage(t store.Ticket, body, origin string) NotificationMessage {
	who := strings.TrimSpace(t.Name)
	if who == "" {
		who = strings.TrimSpace(t.Email)
	}
	if who == "" {
		who = "a visitor"
	}
	details := []string{
		fmt.Sprintf("*#%d — %s*", t.ID, slackMrkdwn(truncateForSlack(t.Subject, slackMaxSubjectLen))),
		"From: " + slackMrkdwn(truncateForSlack(who, 120)),
	}
	if trimmed := strings.TrimSpace(body); trimmed != "" {
		details = append(details, slackMrkdwn(truncateForSlack(trimmed, slackMaxFieldLen)))
	}
	return NotificationMessage{
		Header:  "New support ticket",
		Message: strings.Join(details, "\n"),
		Button:  &NotificationButton{Text: "Open ticket", URL: fmt.Sprintf("%s/tickets?ticket=%d", origin, t.ID)},
		Footer:  "TraceUX · " + slackMrkdwn(truncateForSlack(t.SiteName, 120)),
	}
}

const maxSlackCustomEventLines = 20

func canonicalCustomDetails(details json.RawMessage) string {
	if len(details) == 0 || strings.TrimSpace(string(details)) == "null" {
		return ""
	}
	var value any
	if err := json.Unmarshal(details, &value); err != nil {
		return ""
	}
	encoded, err := json.Marshal(value)
	if err != nil || string(encoded) == "null" || string(encoded) == "{}" {
		return ""
	}
	return string(encoded)
}

func formatCustomEventDetails(details json.RawMessage) string {
	canonical := canonicalCustomDetails(details)
	if canonical == "" {
		return ""
	}

	// Keep object details readable in Slack while preserving nested values as
	// compact JSON. Sorting makes the rendered message and cooldown fingerprint
	// stable even when the browser sends keys in a different order.
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(details, &fields); err == nil && len(fields) > 0 {
		keys := make([]string, 0, len(fields))
		for key := range fields {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		lines := make([]string, 0, len(keys))
		for _, key := range keys {
			value := canonicalCustomDetails(fields[key])
			if value == "" {
				value = "null"
			}
			var stringValue string
			var decoded string
			if err := json.Unmarshal(fields[key], &decoded); err == nil {
				// Some error serializers send the two characters "\\n" instead
				// of a real newline. Turn those into line breaks so stack traces
				// are readable inside the code block.
				stringValue = strings.ReplaceAll(decoded, "\\r\\n", "\n")
				stringValue = strings.ReplaceAll(stringValue, "\\n", "\n")
				stringValue = strings.ReplaceAll(stringValue, "\\r", "\r")
			} else {
				stringValue = value
			}
			lines = append(lines, fmt.Sprintf("%s: %s", slackMrkdwn(key), slackMrkdwn(truncateForSlack(stringValue, slackMaxDetailsLen))))
		}
		return "*Details:*\n```\n" + truncateForSlack(strings.Join(lines, "\n"), slackMaxDetailsBlock) + "\n```"
	}
	return "*Details:*\n```\n" + slackMrkdwn(truncateForSlack(canonical, slackMaxDetailsBlock)) + "\n```"
}

func customEventCooldownKey(siteID int64, event store.CustomEvent) string {
	identity := strings.TrimSpace(event.TrackID)
	if identity == "" {
		identity = strings.TrimSpace(event.SessionID)
	}
	if identity == "" {
		return ""
	}
	errorFingerprint := event.Name + "\x00"
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(event.Details, &fields); err == nil {
		if errorInfo, ok := fields["errorInfo"]; ok {
			errorFingerprint += canonicalCustomDetails(errorInfo)
		} else {
			errorFingerprint += canonicalCustomDetails(event.Details)
		}
	} else {
		errorFingerprint += canonicalCustomDetails(event.Details)
	}
	key := fmt.Sprintf("%d\x00%s\x00%s", siteID, identity, errorFingerprint)
	digest := sha256.Sum256([]byte(key))
	return fmt.Sprintf("%x", digest[:])
}

// filterSlackCustomEvents prevents repeated reports for the same user and
// error from flooding Slack. A missing trackId falls back to the session ID,
// so anonymous events are still deduplicated within their own session without
// suppressing the same error for every anonymous visitor.
func (s *Server) filterSlackCustomEvents(siteID int64, events []store.CustomEvent) []store.CustomEvent {
	now := time.Now()
	s.slackCustomCooldownMu.Lock()
	defer s.slackCustomCooldownMu.Unlock()
	if s.slackCustomCooldown == nil {
		s.slackCustomCooldown = make(map[string]time.Time)
	}
	for key, expiresAt := range s.slackCustomCooldown {
		if !expiresAt.After(now) {
			delete(s.slackCustomCooldown, key)
		}
	}

	filtered := make([]store.CustomEvent, 0, len(events))
	for _, event := range events {
		key := customEventCooldownKey(siteID, event)
		if key != "" {
			if expiresAt, ok := s.slackCustomCooldown[key]; ok && expiresAt.After(now) {
				continue
			}
			s.slackCustomCooldown[key] = now.Add(slackCustomCooldown)
		}
		filtered = append(filtered, event)
	}
	return filtered
}

// buildCustomEventSlackMessage covers custom events the host page explicitly
// flagged with notify: true (window.TraceUX.track(name, trackId, {notify:
// true}) or a trace-ux-track-notify click) -- independent of the browser-log
// matcher, since these are opt-in per call rather than pattern-matched.
func buildCustomEventSlackMessage(siteName string, events []store.CustomEvent, origin string) NotificationMessage {
	shown := events
	if len(shown) > maxSlackCustomEventLines {
		shown = shown[:maxSlackCustomEventLines]
	}
	lines := make([]string, 0, len(shown))
	sessionID := ""
	for _, e := range shown {
		line := "*" + slackMrkdwn(truncateForSlack(e.Name, slackMaxFieldLen)) + "*"
		if e.TrackID != "" {
			line += " — " + slackMrkdwn(truncateForSlack(e.TrackID, 150))
		}
		if details := formatCustomEventDetails(e.Details); details != "" {
			line += "\n" + details
		}
		if sessionID == "" && e.SessionID != "" {
			sessionID = e.SessionID
		}
		lines = append(lines, line)
	}
	if extra := len(events) - len(shown); extra > 0 {
		lines = append(lines, fmt.Sprintf("… and %d more", extra))
	}
	message := NotificationMessage{
		Header:  "Custom event notification",
		Message: strings.Join(lines, "\n"),
		Footer:  fmt.Sprintf("TraceUX · %s · %d event(s)", slackMrkdwn(truncateForSlack(siteName, 120)), len(events)),
	}
	if sessionID != "" {
		message.Button = &NotificationButton{
			Text: "Open session",
			URL:  fmt.Sprintf("%s/replay/%s", origin, urlPathSegment(sessionID)),
		}
	}
	return message
}

func buildLogsSlackMessage(siteName string, logs []store.Log, origin string) NotificationMessage {
	shown := logs
	if len(shown) > maxSlackLogLines {
		shown = shown[:maxSlackLogLines]
	}
	lines := make([]string, 0, len(shown))
	for _, item := range shown {
		line := fmt.Sprintf("• *%s* %s", strings.ToUpper(item.Severity), slackMrkdwn(truncateForSlack(item.Message, slackMaxFieldLen)))
		if item.URL != "" {
			line += "\n  " + slackMrkdwn(truncateForSlack(item.URL, 150))
		}
		if item.SessionID != "" {
			line += fmt.Sprintf(" · <%s/replay/%s|Replay>", origin, urlPathSegment(item.SessionID))
		}
		lines = append(lines, line)
	}
	if extra := len(logs) - len(shown); extra > 0 {
		lines = append(lines, fmt.Sprintf("… and %d more", extra))
	}
	return NotificationMessage{
		Header:  "Matching browser logs",
		Message: strings.Join(lines, "\n"),
		Footer:  fmt.Sprintf("TraceUX · %s · %d log(s)", slackMrkdwn(truncateForSlack(siteName, 120)), len(logs)),
	}
}

func slackHealthPct(pct float64) string {
	if pct >= 10 {
		return fmt.Sprintf("%.0f%%", math.Round(pct))
	}
	return fmt.Sprintf("%.1f%%", pct)
}

func slackHealthPctOrUnavailable(total uint64, pct float64) string {
	if total == 0 {
		return "—"
	}
	return slackHealthPct(pct)
}

func slackHealthResourceBytes(total, value uint64) string {
	if total == 0 {
		return "n/a"
	}
	return slackHealthBytes(value)
}

func slackHealthBytes(bytes uint64) string {
	if bytes == 0 {
		return "0 MB"
	}
	value := float64(bytes)
	units := []string{"B", "KB", "MB", "GB", "TB"}
	unit := 0
	for value >= 1024 && unit < len(units)-1 {
		value /= 1024
		unit++
	}
	precision := 1
	if value >= 100 || unit == 0 {
		precision = 0
	}
	return fmt.Sprintf("%.*f %s", precision, value, units[unit])
}

func slackHealthDuration(seconds float64) string {
	total := int(math.Round(seconds))
	if total <= 0 {
		return "0s"
	}
	hours := total / 3600
	minutes := (total % 3600) / 60
	remaining := total % 60
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm %ds", minutes, remaining)
	}
	return fmt.Sprintf("%ds", remaining)
}

func systemHealthSnapshotAlerts(snapshot systemHealthSnapshot) []systemHealthAlert {
	metrics := make([]systemHealthAlert, 0, 3)
	if snapshot.Ram.TotalBytes > 0 {
		metrics = append(metrics, systemHealthAlert{
			Metric: "Memory",
			Pct:    float64(snapshot.Ram.UsedBytes) / float64(snapshot.Ram.TotalBytes) * 100,
		})
	}
	metrics = append(metrics, systemHealthAlert{Metric: "CPU", Pct: snapshot.Cpu.TraceUXPct})
	if snapshot.Disk.TotalBytes > 0 {
		used := snapshot.Disk.TotalBytes - snapshot.Disk.FreeBytes
		metrics = append(metrics, systemHealthAlert{
			Metric: "Disk",
			Pct:    float64(used) / float64(snapshot.Disk.TotalBytes) * 100,
		})
	}
	return metrics
}

// buildSystemHealthSlackMessage mirrors the fields and labels in the
// dashboard's System health page. The alert summary identifies the crossing,
// then the message includes the complete dashboard-equivalent snapshot so an
// operator does not need to open the page to understand the incident.
func buildSystemHealthSlackMessage(snapshot systemHealthSnapshot, alerts []systemHealthAlert) NotificationMessage {
	ramPct := float64(0)
	if snapshot.Ram.TotalBytes > 0 {
		ramPct = float64(snapshot.Ram.UsedBytes) / float64(snapshot.Ram.TotalBytes) * 100
	}
	diskUsed := uint64(0)
	diskPct := float64(0)
	if snapshot.Disk.TotalBytes > 0 {
		diskUsed = snapshot.Disk.TotalBytes - snapshot.Disk.FreeBytes
		diskPct = float64(diskUsed) / float64(snapshot.Disk.TotalBytes) * 100
	}

	triggered := make([]string, 0, len(alerts))
	for _, alert := range alerts {
		triggered = append(triggered, fmt.Sprintf("%s %s", alert.Metric, slackHealthPct(alert.Pct)))
	}

	lines := []string{
		"*Above 90%:* " + strings.Join(triggered, ", "),
		"",
		fmt.Sprintf("*Memory* · %s", slackHealthPctOrUnavailable(snapshot.Ram.TotalBytes, ramPct)),
		fmt.Sprintf("• Total: %s", slackHealthResourceBytes(snapshot.Ram.TotalBytes, snapshot.Ram.TotalBytes)),
		fmt.Sprintf("• In use: %s", slackHealthResourceBytes(snapshot.Ram.TotalBytes, snapshot.Ram.UsedBytes)),
		fmt.Sprintf("• Available: %s", slackHealthResourceBytes(snapshot.Ram.TotalBytes, snapshot.Ram.AvailableBytes)),
		fmt.Sprintf("• TraceUX (RSS): %s", slackHealthBytes(snapshot.Ram.TraceUXBytes)),
	}
	if snapshot.Ram.MemLimitBytes > 0 {
		lines = append(lines, fmt.Sprintf("• Soft memory cap: %s", slackHealthBytes(uint64(snapshot.Ram.MemLimitBytes))))
	}

	lines = append(lines,
		"",
		fmt.Sprintf("*CPU* · %s", slackHealthPct(snapshot.Cpu.TraceUXPct)),
		fmt.Sprintf("• Cores: %d", snapshot.Cpu.Cores),
		fmt.Sprintf("• Load (1m): %.2f", snapshot.Cpu.Load1),
		fmt.Sprintf("• Load (5m): %.2f", snapshot.Cpu.Load5),
		fmt.Sprintf("• Load (15m): %.2f", snapshot.Cpu.Load15),
		fmt.Sprintf("• TraceUX uptime: %s", slackHealthDuration(snapshot.Cpu.UptimeSeconds)),
		"",
		fmt.Sprintf("*Disk* · %s", slackHealthPctOrUnavailable(snapshot.Disk.TotalBytes, diskPct)),
	)
	if snapshot.Disk.TotalBytes > 0 {
		lines = append(lines,
			fmt.Sprintf("• Volume: %s", slackHealthBytes(snapshot.Disk.TotalBytes)),
			fmt.Sprintf("• Free: %s", slackHealthBytes(snapshot.Disk.FreeBytes)),
		)
	} else {
		lines = append(lines, "• Volume: n/a", "• Free: n/a")
	}
	lines = append(lines,
		fmt.Sprintf("• TraceUX data: %s", slackHealthBytes(snapshot.Disk.TraceUXBytes)),
		"• Data dir: "+slackMrkdwn(snapshot.Disk.DataDir),
		"",
		"*What TraceUX stores*",
		fmt.Sprintf("• %d sites", snapshot.Store.Sites),
		fmt.Sprintf("• %d recordings", snapshot.Store.Sessions),
		fmt.Sprintf("• %d feedback", snapshot.Store.Feedback),
	)

	return NotificationMessage{
		Header:  "System health",
		Message: strings.Join(lines, "\n"),
		Footer:  "TraceUX · Dashboard snapshot · recoveries re-arm the alert",
	}
}

// Session ids are validated by the ingest endpoint, but keeping URL assembly
// in one helper prevents a future notification producer from interpolating a
// value containing path delimiters into a Slack link.
func urlPathSegment(value string) string {
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// slackLogMatches applies the configured log matcher. An empty pattern
// matches everything that already passed the site's severity allow-list,
// which is enough to receive every captured error without a second rule
// language for "all of them".
func slackLogMatches(mode, pattern, message string) bool {
	if pattern == "" {
		return true
	}
	if mode == store.SlackLogMatchExact {
		return message == pattern
	}
	return strings.Contains(message, pattern)
}

// ---- Dispatch hooks called from the request handlers ----

func (s *Server) notifySlackTicket(t store.Ticket, body string, r *http.Request) {
	integ, err := s.store.GetSiteSlackIntegration(t.SiteID)
	if err != nil || !integ.TicketsEnabled || !integ.WebhookFor("tickets").Configured() {
		return
	}
	s.enqueueNotification(notificationProviderSlack, "tickets", t.SiteID, buildTicketSlackMessage(t, body, s.originFor(r)))
}

func (s *Server) notifySlackLogs(site store.Site, logs []store.Log, r *http.Request) {
	if len(logs) == 0 {
		return
	}
	integ, err := s.store.GetSiteSlackIntegration(site.ID)
	if err != nil || !integ.LogsEnabled || !integ.WebhookFor("logs").Configured() {
		return
	}
	matched := make([]store.Log, 0, len(logs))
	for _, l := range logs {
		if slackLogMatches(integ.LogMatchMode, integ.LogMatchValue, l.Message) {
			matched = append(matched, l)
		}
	}
	if len(matched) == 0 {
		return
	}
	s.enqueueNotification(notificationProviderSlack, "logs", site.ID, buildLogsSlackMessage(site.Name, matched, s.originFor(r)))
}

// notifySlackCustomEvents fires for custom events the tracker call or
// trace-ux-track-notify click explicitly flagged with notify: true. Unlike
// logs, there is no pattern to match here -- the opt-in already happened at
// the source, so every flagged event that reaches this hook is notified.
func (s *Server) notifySlackCustomEvents(site store.Site, events []store.CustomEvent, r *http.Request) {
	if len(events) == 0 {
		return
	}
	integ, err := s.store.GetSiteSlackIntegration(site.ID)
	if err != nil || !integ.CustomEnabled || !integ.WebhookFor("custom").Configured() {
		return
	}
	flagged := make([]store.CustomEvent, 0, len(events))
	for _, e := range events {
		if e.Notify {
			flagged = append(flagged, e)
		}
	}
	if len(flagged) == 0 {
		return
	}
	flagged = s.filterSlackCustomEvents(site.ID, flagged)
	if len(flagged) == 0 {
		return
	}
	s.enqueueNotification(notificationProviderSlack, "custom", site.ID, buildCustomEventSlackMessage(site.Name, flagged, s.originFor(r)))
}

// resolveSlackNotificationDestination is the Slack-specific half of the
// provider registry. The generic dispatcher only asks a registered provider
// for an enabled destination; it does not know how that provider stores or
// decrypts its credentials. "system" is instance-wide and ignores siteID;
// every other kind belongs to the site it was enqueued for.
func (s *Server) resolveSlackNotificationDestination(kind string, siteID int64) (string, bool, error) {
	if kind == "system" {
		integ, err := s.store.GetSlackSystemIntegration()
		if err != nil {
			return "", false, err
		}
		if !integ.Enabled || !integ.Webhook.Configured() {
			return "", false, nil
		}
		destination, err := decryptSlackWebhook(s.secret, integ.Webhook.Ciphertext)
		if err != nil {
			return "", false, err
		}
		return destination, true, nil
	}

	integ, err := s.store.GetSiteSlackIntegration(siteID)
	if err != nil {
		return "", false, err
	}
	enabled := map[string]bool{
		"tickets": integ.TicketsEnabled,
		"logs":    integ.LogsEnabled,
		"custom":  integ.CustomEnabled,
	}[kind]
	secret := integ.WebhookFor(kind)
	if !enabled || !secret.Configured() {
		return "", false, nil
	}
	destination, err := decryptSlackWebhook(s.secret, secret.Ciphertext)
	if err != nil {
		return "", false, err
	}
	return destination, true, nil
}

// ---- System health polling ----

// runSlackHealthMonitor polls CPU/RAM/disk on a fixed interval for the
// lifetime of the process. It is started once from main().
func (s *Server) runSlackHealthMonitor() {
	ticker := time.NewTicker(slackHealthPollEvery)
	defer ticker.Stop()
	for range ticker.C {
		s.checkSlackSystemHealth()
	}
}

func (s *Server) checkSlackSystemHealth() {
	integ, err := s.store.GetSlackSystemIntegration()
	if err != nil {
		return
	}
	snapshot, err := s.collectSystemHealth()
	if err != nil {
		return
	}
	metrics := systemHealthSnapshotAlerts(snapshot)

	s.slackHealthMu.Lock()
	if s.slackHealthAbove == nil {
		s.slackHealthAbove = make(map[string]bool)
	}
	above := evaluateSlackHealthCrossing(s.slackHealthAbove, metrics)
	s.slackHealthMu.Unlock()
	if !integ.Enabled || !integ.Webhook.Configured() || len(above) == 0 {
		return
	}
	s.enqueueNotification(notificationProviderSlack, "system", 0, buildSystemHealthSlackMessage(snapshot, above))
}

// evaluateSlackHealthCrossing updates the per-metric alerting state in place
// and returns every metric currently above the threshold, but only when at
// least one of them just crossed up into that state -- so a persistent
// incident produces one alert on the way up, not one per poll, while the
// message it does send still reports every metric currently over the line.
// A metric becomes eligible for another alert once it falls back to at or
// below the threshold.
func evaluateSlackHealthCrossing(state map[string]bool, metrics []systemHealthAlert) []systemHealthAlert {
	var crossed bool
	var above []systemHealthAlert
	seen := make(map[string]bool, len(metrics))
	for _, m := range metrics {
		seen[m.Metric] = true
		isAbove := m.Pct > slackHealthThreshold
		if isAbove {
			above = append(above, m)
			if !state[m.Metric] {
				crossed = true
			}
		}
		state[m.Metric] = isAbove
	}
	// If a platform cannot provide one of the metrics on a later poll, treat
	// that metric as recovered instead of leaving an old crossing latched
	// forever. The next valid sample can then alert normally.
	for metric := range state {
		if !seen[metric] {
			state[metric] = false
		}
	}
	if !crossed {
		return nil
	}
	return above
}

// ---- Absolute link origin ----

// originFor returns the scheme+host to use for absolute dashboard links in a
// Slack message. TRACE_UX_PUBLIC_URL wins when set (the only sound choice
// behind a reverse proxy that doesn't forward the original host); otherwise
// it's derived from the request, honouring X-Forwarded-* only from a
// configured trusted proxy -- the same trust model as clientIP.
func (s *Server) originFor(r *http.Request) string {
	if s.cfg != nil && s.cfg.PublicURL != "" {
		return s.cfg.PublicURL
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	host := r.Host
	if s.cfg != nil {
		if remoteIP := net.ParseIP(stripPort(r.RemoteAddr)); remoteIP != nil && trustedProxy(remoteIP, s.cfg.TrustedProxyCIDRs) {
			if proto := r.Header.Get("X-Forwarded-Proto"); proto == "http" || proto == "https" {
				scheme = proto
			}
			if h := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); h != "" {
				host = h
			}
		}
	}
	return scheme + "://" + host
}

func stripPort(addr string) string {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}
