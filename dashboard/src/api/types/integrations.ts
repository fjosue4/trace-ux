export type SlackRoutingMode = 'single' | 'per_notification';
import { LogSeverity } from './logs';

export type SlackLogMatchMode = 'contains' | 'exact';

/** One Slack log alert rule. A log is sent when it matches any rule: its
 *  severity is one of `severities` (absent or empty = any) and the pattern
 *  matches (blank = any message). No rules at all sends every log that passes
 *  the site's own log settings. */
export type SlackLogMatch = {
  mode: SlackLogMatchMode;
  value: string;
  severities?: LogSeverity[];
};

export type SlackWebhookView = {
  configured: boolean;
  hint?: string;
};

// Instance-wide: CPU/RAM/disk describe the TraceUX server itself, not any
// one site, so this stays a single global toggle+webhook.
export type SlackSystemIntegration = {
  enabled: boolean;
  webhook: SlackWebhookView;
  signing_secret: SlackWebhookView;
  updated_at: number;
};

export type SlackSystemIntegrationUpdate = {
  enabled: boolean;
  // Blank means "keep the current secret"; clear_webhook is the only way to
  // remove one.
  webhook?: string;
  clear_webhook?: boolean;
  signing_secret?: string;
  clear_signing_secret?: boolean;
};

// Per-site: tickets, browser logs, and flagged custom events all belong to
// one site, so each site configures its own webhook(s) from its own
// Integrations tab.
export type SiteSlackIntegration = {
  routing_mode: SlackRoutingMode;

  common_webhook: SlackWebhookView;

  tickets_enabled: boolean;
  tickets_webhook: SlackWebhookView;

  logs_enabled: boolean;
  logs_webhook: SlackWebhookView;
  log_matches?: SlackLogMatch[];
  /** First rule only; kept for servers that predate rule lists. */
  log_match_mode: SlackLogMatchMode;
  log_match_value: string;

  // Custom events the host page explicitly flags with notify: true
  // (track(name, trackId, { notify: true }) or a trace-ux-track-notify
  // click), independent of the log matcher above.
  custom_enabled: boolean;
  custom_webhook: SlackWebhookView;

  updated_at: number;
};

// A blank *_webhook field means "keep the current secret"; the matching
// clear_* flag is the only way to remove one.
export type SiteSlackIntegrationUpdate = {
  routing_mode: SlackRoutingMode;
  tickets_enabled: boolean;
  logs_enabled: boolean;
  custom_enabled: boolean;
  log_matches: SlackLogMatch[];

  common_webhook?: string;
  tickets_webhook?: string;
  logs_webhook?: string;
  custom_webhook?: string;

  clear_common_webhook?: boolean;
  clear_tickets_webhook?: boolean;
  clear_logs_webhook?: boolean;
  clear_custom_webhook?: boolean;
};

export type SiteSlackNotificationKind = 'tickets' | 'logs' | 'custom';
