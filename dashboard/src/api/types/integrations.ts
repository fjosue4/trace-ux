export type SlackRoutingMode = 'single' | 'per_notification';
export type SlackLogMatchMode = 'contains' | 'exact';

export type SlackWebhookView = {
  configured: boolean;
  hint?: string;
};

export type SlackIntegration = {
  routing_mode: SlackRoutingMode;

  common_webhook: SlackWebhookView;

  tickets_enabled: boolean;
  tickets_webhook: SlackWebhookView;

  logs_enabled: boolean;
  logs_webhook: SlackWebhookView;
  log_match_mode: SlackLogMatchMode;
  log_match_value: string;

  system_enabled: boolean;
  system_webhook: SlackWebhookView;

  updated_at: number;
};

// A blank *_webhook field means "keep the current secret"; the matching
// clear_* flag is the only way to remove one.
export type SlackIntegrationUpdate = {
  routing_mode: SlackRoutingMode;
  tickets_enabled: boolean;
  logs_enabled: boolean;
  system_enabled: boolean;
  log_match_mode: SlackLogMatchMode;
  log_match_value: string;

  common_webhook?: string;
  tickets_webhook?: string;
  logs_webhook?: string;
  system_webhook?: string;

  clear_common_webhook?: boolean;
  clear_tickets_webhook?: boolean;
  clear_logs_webhook?: boolean;
  clear_system_webhook?: boolean;
};

export type SlackNotificationKind = 'tickets' | 'logs' | 'system';
