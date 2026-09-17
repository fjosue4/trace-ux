import { request } from '../client';
import { Log, LogQuery, LogStats } from '../types/logs';

export const logsEndpoints = {
  listLogs: (query: LogQuery = {}) => {
    const q = new URLSearchParams();
    if (query.siteId) q.set('site_id', String(query.siteId));
    if (Array.isArray(query.severity)) {
      if (query.severity.length > 0) q.set('severity', query.severity.join(','));
    } else if (query.severity) {
      q.set('severity', query.severity);
    }
    if (query.sessionId) q.set('session_id', query.sessionId);
    if (query.beforeId) q.set('before_id', String(query.beforeId));
    if (query.fromMs) q.set('from_ms', String(query.fromMs));
    if (query.toMs) q.set('to_ms', String(query.toMs));
    q.set('limit', String(query.limit ?? 1000));
    return request<Log[]>(`/api/logs?${q.toString()}`);
  },

  logStats: (query: Pick<LogQuery, 'siteId' | 'fromMs' | 'toMs'> = {}) => {
    const q = new URLSearchParams();
    if (query.siteId) q.set('site_id', String(query.siteId));
    if (query.fromMs) q.set('from_ms', String(query.fromMs));
    if (query.toMs) q.set('to_ms', String(query.toMs));
    const suffix = q.toString();
    return request<LogStats>(`/api/logs/stats${suffix ? `?${suffix}` : ''}`);
  },
};
