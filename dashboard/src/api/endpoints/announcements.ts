import { request } from '../client';
import { Announcement } from '../types/announcements';

export const announcementsEndpoints = {
  listAnnouncements: (siteId: number | null) => request<Announcement[]>(`/api/announcements${siteId ? `?site_id=${siteId}` : ''}`),
  createAnnouncement: (input: Partial<Announcement> & { site_id: number; title: string }) => request<Announcement>('/api/announcements', { method: 'POST', body: JSON.stringify(input) }),
  updateAnnouncement: (id: number, input: Partial<Announcement>) => request<{ ok: boolean }>(`/api/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  publishAnnouncement: (id: number) => request<{ ok: boolean }>(`/api/announcements/${id}/publish`, { method: 'POST' }),
  archiveAnnouncement: (id: number) => request<{ ok: boolean }>(`/api/announcements/${id}/archive`, { method: 'POST' }),
  deleteAnnouncement: (id: number) => request<{ ok: boolean }>(`/api/announcements/${id}`, { method: 'DELETE' }),
};
