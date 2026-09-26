import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnalyzeReport, AnalyzeResult, AnalyzeScope, AnalyzeSource, api, Site } from '../../../api';
import { SUMMARY_CONCURRENCY } from '../Analyze.constants';
import { SiteSelection } from '../Analyze.types';

export type SummaryState = { status: 'loading' } | { status: 'ready'; result: AnalyzeResult } | { status: 'error'; message: string };

function readScope(value: string | null): AnalyzeScope {
  return value === 'mine' || value === 'team' ? value : 'all';
}

function readSite(value: string | null): SiteSelection {
  const id = Number(value);
  return value && Number.isInteger(id) && id > 0 ? id : 'all';
}

function readSource(value: string | null): AnalyzeSource | 'all' {
  return value === 'event' || value === 'log' ? value : 'all';
}

// Filters live in the URL so the library survives opening a report and
// coming back, and a filtered view can be shared.
export function useAnalyzeLibrary() {
  const [params, setParams] = useSearchParams();
  const scope = readScope(params.get('scope'));
  const siteSel = readSite(params.get('site'));
  const sourceSel = readSource(params.get('source'));

  const [sites, setSites] = useState<Site[]>([]);
  const [reports, setReports] = useState<AnalyzeReport[] | null>(null);
  const [error, setError] = useState('');
  const [summaries, setSummaries] = useState<Record<string, SummaryState>>({});
  const [pendingDelete, setPendingDelete] = useState<AnalyzeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(new Set<string>());

  const setFilter = useCallback((key: 'scope' | 'site' | 'source', value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    api.listSites().then(setSites).catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReports(null);
    api
      .listAnalyzeReports({
        scope,
        siteId: siteSel === 'all' ? null : siteSel,
        source: sourceSel === 'all' ? null : sourceSel,
      })
      .then((rows) => {
        if (!cancelled) { setReports(rows); setError(''); }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load reports.');
      });
    return () => { cancelled = true; };
  }, [scope, siteSel, sourceSel]);

  // Each card's total and trend come from its own results request, so one slow
  // or broken report never holds up the list. Keyed by updated_at: an edited
  // report is re-evaluated, an unchanged one is not.
  useEffect(() => {
    if (!reports) return;
    const queue = reports
      .map((r) => ({ id: r.id, key: `${r.id}:${r.updated_at}` }))
      .filter(({ key }) => !started.current.has(key));
    if (queue.length === 0) return;
    queue.forEach(({ key }) => started.current.add(key));
    setSummaries((current) => {
      const next = { ...current };
      queue.forEach(({ key }) => { next[key] = { status: 'loading' }; });
      return next;
    });
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const { id, key } = queue[cursor++];
        let state: SummaryState;
        try {
          state = { status: 'ready', result: await api.analyzeReportResults(id) };
        } catch (e) {
          state = { status: 'error', message: e instanceof Error ? e.message : 'Could not load results.' };
        }
        setSummaries((current) => ({ ...current, [key]: state }));
      }
    }
    for (let i = 0; i < Math.min(SUMMARY_CONCURRENCY, queue.length); i++) worker();
  }, [reports]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.deleteAnalyzeReport(pendingDelete.id);
      setReports((rows) => rows && rows.filter((r) => r.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the report.');
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(report: AnalyzeReport): Promise<AnalyzeReport | null> {
    setBusy(true);
    try {
      return await api.duplicateAnalyzeReport(report.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate the report.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const siteOptions = useMemo(() => [
    { value: 'all', label: 'All sites' },
    ...sites.map((site) => ({ value: String(site.id), label: site.name })),
  ], [sites]);

  const filtered = scope !== 'all' || siteSel !== 'all' || sourceSel !== 'all';

  return {
    scope,
    siteSel,
    sourceSel,
    setFilter,
    siteOptions,
    reports,
    summaries,
    error,
    filtered,
    pendingDelete,
    setPendingDelete,
    confirmDelete,
    duplicate,
    busy,
  };
}
