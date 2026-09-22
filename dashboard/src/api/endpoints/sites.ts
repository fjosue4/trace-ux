import { request } from '../client';
import { Site, SiteDetail, SiteSettings, WidgetIcon } from '../types/sites';

export const sitesEndpoints = {
  listSites: () => request<Site[]>('/api/sites'),
  createSite: (name: string, url: string) =>
    request<Site>('/api/sites', { method: 'POST', body: JSON.stringify({ name, url }) }),
  deleteSite: (id: number) => request<{ ok: boolean }>(`/api/sites/${id}`, { method: 'DELETE' }),

  // Site management.
  getSiteDetail: (id: number) => request<SiteDetail>(`/api/sites/${id}`),

  // The icon is posted as raw bytes: the server decides the format by decoding
  // the image, so there is nothing useful to declare in a multipart wrapper.
  uploadWidgetIcon: (id: number, file: File) =>
    request<WidgetIcon>(`/api/sites/${id}/widget-icon`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  deleteWidgetIcon: (id: number) =>
    request<{ ok: boolean }>(`/api/sites/${id}/widget-icon`, { method: 'DELETE' }),
  updateSiteRecording: (id: number, enabled: boolean) =>
    request<{ ok: boolean; recording_enabled: boolean }>(`/api/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ recording_enabled: enabled }),
    }),
  // Name and URL travel together so one Save cannot half-apply; the server
  // validates both before writing either. Omitted fields are left alone.
  updateSiteDetails: (id: number, details: { name?: string; url?: string }) =>
    request<{ ok: boolean; name?: string; url?: string }>(`/api/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(details),
    }),
  updateSiteSettings: (id: number, settings: SiteSettings) =>
    request<SiteSettings>(`/api/sites/${id}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  deletePerformanceKey: (siteId: number, keyId: number) =>
    request<{ ok: boolean }>(`/api/sites/${siteId}/performance-keys/${keyId}`, {
      method: 'DELETE',
    }),
};
