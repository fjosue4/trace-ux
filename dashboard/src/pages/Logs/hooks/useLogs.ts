import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Log, LogStats, Site } from '../../../api';
import { LIVE_REFRESH_MS, MAX_VISIBLE_LOGS } from '../Logs.constants';
import { resolveTimeWindow } from '../Logs.helpers';
import { SeveritySelection, SiteSelection, TimeRange } from '../Logs.types';

export function useLogs() {
  const [params] = useSearchParams();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [live, setLive] = useState(true);
  const [siteSel, setSiteSel] = useState<SiteSelection>(
    params.get('site') ? Number(params.get('site')) : 'all',
  );
  const [severitySel, setSeveritySel] = useState<SeveritySelection>([]);
  const [search, setSearch] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('15m');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    const initialWindow = resolveTimeWindow(timeRange, customFrom, customTo);
    if (!initialWindow.valid) {
      setLogs([]);
      setStats(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let fetching = false;

    async function load() {
      if (fetching) return;
      fetching = true;
      const window = resolveTimeWindow(timeRange, customFrom, customTo);
      const siteId = siteSel === 'all' ? null : siteSel;
      const severity = severitySel.length > 0 ? severitySel : '';
      try {
        const [rows, summary] = await Promise.all([
          api.listLogs({
            siteId,
            severity,
            search: search.trim(),
            fromMs: window.fromMs,
            toMs: window.toMs,
            limit: MAX_VISIBLE_LOGS,
          }),
          api.logStats({ siteId, fromMs: window.fromMs, toMs: window.toMs }),
        ]);
        if (!cancelled) {
          setLogs(rows);
          setStats(summary);
          setError('');
          setLastUpdated(Date.now());
        }
      } catch {
        if (!cancelled) setError('Could not load logs.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          fetching = false;
        }
      }
    }

    setLoading(true);
    load();
    const timer = live ? window.setInterval(load, LIVE_REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [siteSel, severitySel, search, timeRange, customFrom, customTo, live, refreshNonce]);

  const timeWindow = resolveTimeWindow(timeRange, customFrom, customTo);
  const summary = stats
    ? [
        { label: 'All logs', value: stats.total, severity: '' as const },
        { label: 'Errors', value: stats.error, severity: 'error' as const },
        { label: 'Warnings', value: stats.warn, severity: 'warn' as const },
        { label: 'Info', value: stats.info, severity: 'info' as const },
        { label: 'Debug', value: stats.debug, severity: 'debug' as const },
      ]
    : [];

  function changeTimeRange(value: string) {
    const next = value as TimeRange;
    setTimeRange(next);
    if (next === 'all') setLive(false);
  }

  return {
    sites,
    logs,
    error,
    lastUpdated,
    loading,
    setRefreshNonce,
    live,
    setLive,
    siteSel,
    setSiteSel,
    severitySel,
    setSeveritySel,
    search,
    setSearch,
    timeRange,
    changeTimeRange,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    timeWindow,
    summary,
  };
}
