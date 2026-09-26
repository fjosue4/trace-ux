import { request } from '../client';
import {
  AnalyzeDefinition,
  AnalyzeEventOption,
  AnalyzeListQuery,
  AnalyzeLogOption,
  AnalyzeRange,
  AnalyzeReport,
  AnalyzeReportInput,
  AnalyzeResult,
  AnalyzeSource,
} from '../types/analyze';

function rangeQuery(range: AnalyzeRange = {}): string {
  const q = new URLSearchParams();
  if (range.hours) q.set('hours', String(range.hours));
  if (range.days) q.set('days', String(range.days));
  if (range.from) q.set('from', range.from);
  if (range.to) q.set('to', range.to);
  const suffix = q.toString();
  return suffix ? `?${suffix}` : '';
}

export const analyzeEndpoints = {
  listAnalyzeReports: (query: AnalyzeListQuery = {}) => {
    const q = new URLSearchParams();
    if (query.scope) q.set('scope', query.scope);
    if (query.siteId) q.set('site_id', String(query.siteId));
    if (query.source) q.set('source', query.source);
    const suffix = q.toString();
    return request<AnalyzeReport[]>(`/api/analyze/reports${suffix ? `?${suffix}` : ''}`);
  },
  getAnalyzeReport: (id: number) => request<AnalyzeReport>(`/api/analyze/reports/${id}`),
  createAnalyzeReport: (input: AnalyzeReportInput) =>
    request<AnalyzeReport>('/api/analyze/reports', { method: 'POST', body: JSON.stringify(input) }),
  updateAnalyzeReport: (id: number, patch: Partial<AnalyzeReportInput>) =>
    request<AnalyzeReport>(`/api/analyze/reports/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAnalyzeReport: (id: number) =>
    request<{ ok: boolean }>(`/api/analyze/reports/${id}`, { method: 'DELETE' }),
  duplicateAnalyzeReport: (id: number) =>
    request<AnalyzeReport>(`/api/analyze/reports/${id}/duplicate`, { method: 'POST' }),
  analyzeReportResults: (id: number, range?: AnalyzeRange) =>
    request<AnalyzeResult>(`/api/analyze/reports/${id}/results${rangeQuery(range)}`),
  previewAnalyze: (definition: AnalyzeDefinition, range: AnalyzeRange = {}) =>
    request<AnalyzeResult>('/api/analyze/preview', { method: 'POST', body: JSON.stringify({ definition, ...range }) }),
  analyzeEventOptions: (siteId: number | null, search = '') =>
    request<{ events: AnalyzeEventOption[] }>(`/api/analyze/options?${optionsQuery('event', siteId, search)}`),
  analyzeLogOptions: (siteId: number | null, search = '') =>
    request<{ logs: AnalyzeLogOption[] }>(`/api/analyze/options?${optionsQuery('log', siteId, search)}`),
};

function optionsQuery(source: AnalyzeSource, siteId: number | null, search: string): string {
  const q = new URLSearchParams({ source });
  if (siteId) q.set('site_id', String(siteId));
  if (search.trim()) q.set('search', search.trim());
  return q.toString();
}
