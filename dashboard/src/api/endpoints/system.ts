import { request } from '../client';
import { SearchIndexStatus, SystemHealth } from '../types/system';

export const systemEndpoints = {
  // Server health (admin only).
  getSystemHealth: () => request<SystemHealth>('/api/system/health'),
  getSearchIndex: (signal?: AbortSignal) =>
    request<SearchIndexStatus>('/api/system/search-index', { signal }),
  updateSearchIndex: (enabled: boolean) =>
    request<SearchIndexStatus>('/api/system/search-index', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
};
