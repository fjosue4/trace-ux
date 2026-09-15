import { request } from '../client';
import { PerformanceQuery, PerformanceReport } from '../types/performance';

export const performanceEndpoints = {
  performance: (query: PerformanceQuery = {}) => {
    const q = new URLSearchParams();
    if (query.siteId) q.set('site_id', String(query.siteId));
    if (query.environment) q.set('environment', query.environment);
    if (query.service) q.set('service', query.service);
    if (query.version) q.set('version', query.version);
    if (query.from) q.set('from', String(query.from));
    if (query.to) q.set('to', String(query.to));
    if (query.limit) q.set('limit', String(query.limit));
    const suffix = q.toString();
    return request<PerformanceReport>(`/api/performance${suffix ? `?${suffix}` : ''}`);
  },
};
