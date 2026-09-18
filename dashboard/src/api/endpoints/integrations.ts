import { request } from '../client';
import { SlackIntegration, SlackIntegrationUpdate, SlackNotificationKind } from '../types/integrations';

export const integrationsEndpoints = {
  getSlackIntegration: () => request<SlackIntegration>('/api/integrations/slack'),
  updateSlackIntegration: (update: SlackIntegrationUpdate) =>
    request<SlackIntegration>('/api/integrations/slack', {
      method: 'PUT',
      body: JSON.stringify(update),
    }),
  testSlackWebhook: (kind?: SlackNotificationKind) =>
    request<{ ok: boolean }>('/api/integrations/slack/test', {
      method: 'POST',
      body: JSON.stringify({ kind: kind ?? '' }),
    }),
};
