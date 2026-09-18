import { request } from '../client';
import {
  SiteSlackIntegration,
  SiteSlackIntegrationUpdate,
  SiteSlackNotificationKind,
  SlackSystemIntegration,
  SlackSystemIntegrationUpdate,
} from '../types/integrations';

export const integrationsEndpoints = {
  getSlackSystemIntegration: () => request<SlackSystemIntegration>('/api/integrations/slack'),
  updateSlackSystemIntegration: (update: SlackSystemIntegrationUpdate) =>
    request<SlackSystemIntegration>('/api/integrations/slack', {
      method: 'PUT',
      body: JSON.stringify(update),
    }),
  testSlackSystemWebhook: () =>
    request<{ ok: boolean }>('/api/integrations/slack/test', { method: 'POST', body: JSON.stringify({}) }),

  getSiteSlackIntegration: (siteId: number) => request<SiteSlackIntegration>(`/api/sites/${siteId}/integrations/slack`),
  updateSiteSlackIntegration: (siteId: number, update: SiteSlackIntegrationUpdate) =>
    request<SiteSlackIntegration>(`/api/sites/${siteId}/integrations/slack`, {
      method: 'PUT',
      body: JSON.stringify(update),
    }),
  testSiteSlackWebhook: (siteId: number, kind?: SiteSlackNotificationKind) =>
    request<{ ok: boolean }>(`/api/sites/${siteId}/integrations/slack/test`, {
      method: 'POST',
      body: JSON.stringify({ kind: kind ?? '' }),
    }),
};
