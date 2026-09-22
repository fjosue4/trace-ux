import { request } from '../client';
import { Log, LogFilterOptions, LogQuery, LogStats } from '../types/logs';

export const logsEndpoints = {
  listLogs: (query: LogQuery = {}) => {
    const q = new URLSearchParams();
    if (query.siteId) q.set('site_id', String(query.siteId));
    if (query.serviceId) q.set('service_id', String(query.serviceId));
    if (query.environment) q.set('environment', query.environment);
    if (Array.isArray(query.severity)) {
      if (query.severity.length > 0) q.set('severity', query.severity.join(','));
    } else if (query.severity) {
      q.set('severity', query.severity);
    }
    if (query.search) q.set('search', query.search);
    if (query.searchIn) q.set('search_in', query.searchIn);
    if (query.sessionId) q.set('session_id', query.sessionId);
    if (query.beforeId) q.set('before_id', String(query.beforeId));
    if (query.fromMs) q.set('from_ms', String(query.fromMs));
    if (query.toMs) q.set('to_ms', String(query.toMs));
    q.set('limit', String(query.limit ?? 1000));
    return request<Log[]>(`/api/logs?${q.toString()}`);
  },

  logOptions: (siteId?: number | null) => {
    const q = new URLSearchParams();
    if (siteId) q.set('site_id', String(siteId));
    const suffix = q.toString();
    return request<LogFilterOptions>(`/api/logs/options${suffix ? `?${suffix}` : ''}`);
  },

  logStats: (query: Pick<LogQuery, 'siteId' | 'serviceId' | 'environment' | 'fromMs' | 'toMs'> = {}) => {
    const q = new URLSearchParams();
    if (query.siteId) q.set('site_id', String(query.siteId));
    if (query.serviceId) q.set('service_id', String(query.serviceId));
    if (query.environment) q.set('environment', query.environment);
    if (query.fromMs) q.set('from_ms', String(query.fromMs));
    if (query.toMs) q.set('to_ms', String(query.toMs));
    const suffix = q.toString();
    return request<LogStats>(`/api/logs/stats${suffix ? `?${suffix}` : ''}`);
  },
};
