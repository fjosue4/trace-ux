import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Log, LogFilterOptions, LogStats, Site } from '../../../api';
import { LIVE_REFRESH_MS, LOG_PAGE_SIZE } from '../Logs.constants';
import { resolveTimeWindow } from '../Logs.helpers';
import { SearchScope, ServiceSelection, SeveritySelection, SiteSelection, TimeRange } from '../Logs.types';

export function useLogs() {
  const [params, setParams] = useSearchParams();
  const initialRange = readTimeRange(params.get('range'));
  const [sites, setSites] = useState<Site[] | null>(null);
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [filterOptions, setFilterOptions] = useState<LogFilterOptions>({ services: [], environments: [] });
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const requestGeneration = useRef(0);
  const loadingMoreRef = useRef(false);
  const [live, setLive] = useState(initialRange !== 'all');
  const [siteSel, setSiteSel] = useState<SiteSelection>(() => readIDSelection(params.get('site')));
  const [severitySel, setSeveritySel] = useState<SeveritySelection>(() => readSeverities(params));
  const [serviceSel, setServiceSel] = useState<ServiceSelection>(() => readIDSelection(params.get('service')));
  const [environment, setEnvironment] = useState(params.get('environment') || 'all');
  const [search, setSearch] = useState(params.get('search') || '');
  const [searchIn, setSearchIn] = useState<SearchScope>(() => readSearchScope(params.get('search_in')));
  const [timeRange, setTimeRange] = useState<TimeRange>(initialRange);
  const [customFrom, setCustomFrom] = useState(params.get('from') || '');
  const [customTo, setCustomTo] = useState(params.get('to') || '');

  useEffect(() => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      setOrDelete(next, 'site', siteSel === 'all' ? '' : String(siteSel));
      setOrDelete(next, 'service', serviceSel === 'all' ? '' : String(serviceSel));
      setOrDelete(next, 'environment', environment === 'all' ? '' : environment);
      next.delete('severity');
      severitySel.forEach((severity) => next.append('severity', severity));
      setOrDelete(next, 'search', search.trim());
      setOrDelete(next, 'search_in', searchIn === 'both' ? '' : searchIn);
      setOrDelete(next, 'range', timeRange === '15m' ? '' : timeRange);
      setOrDelete(next, 'from', timeRange === 'custom' ? customFrom : '');
      setOrDelete(next, 'to', timeRange === 'custom' ? customTo : '');
      return next;
    }, { replace: true });
  }, [siteSel, serviceSel, environment, severitySel, search, searchIn, timeRange, customFrom, customTo, setParams]);

  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    const siteId = siteSel === 'all' ? null : siteSel;
    api.logOptions(siteId).then((options) => {
      setFilterOptions(options);
      setServiceSel((current) => current === 'all' || options.services.some((service) => service.id === current) ? current : 'all');
      setEnvironment((current) => current === 'all' || options.environments.includes(current) ? current : 'all');
    }).catch(() => setFilterOptions({ services: [], environments: [] }));
  }, [siteSel]);

  useEffect(() => {
    const initialWindow = resolveTimeWindow(timeRange, customFrom, customTo);
    if (!initialWindow.valid) {
      requestGeneration.current += 1;
      loadingMoreRef.current = false;
      setLogs([]);
      setStats(null);
      setHasMore(false);
      setLoadingMore(false);
      setLoading(false);
      return;
    }

    const generation = ++requestGeneration.current;
    let cancelled = false;
    let fetching = false;
    let firstRequest = true;

    loadingMoreRef.current = false;
    setLoadingMore(false);
    setHasMore(false);

    async function load() {
      if (fetching) return;
      fetching = true;
      const window = resolveTimeWindow(timeRange, customFrom, customTo);
      const siteId = siteSel === 'all' ? null : siteSel;
      const severity = severitySel.length > 0 ? severitySel : '';
      const serviceId = serviceSel === 'all' ? null : serviceSel;
      const environmentValue = environment === 'all' ? undefined : environment;
      try {
        const [rows, summary] = await Promise.all([
          api.listLogs({
            siteId,
            serviceId,
            environment: environmentValue,
            severity,
            search: search.trim(),
            searchIn,
            fromMs: window.fromMs,
            toMs: window.toMs,
            limit: LOG_PAGE_SIZE,
          }),
          api.logStats({ siteId, serviceId, environment: environmentValue, fromMs: window.fromMs, toMs: window.toMs }),
        ]);
        if (!cancelled && requestGeneration.current === generation) {
          const replace = firstRequest;
          setLogs((current) => {
            if (replace || current === null) return rows;
            const newestIDs = new Set(rows.map((row) => row.id));
            return [
              ...rows,
              ...current.filter((row) => {
                const timestamp = row.timestamp_ms || row.created_at * 1000;
                return !newestIDs.has(row.id)
                  && (!window.fromMs || timestamp >= window.fromMs)
                  && (!window.toMs || timestamp <= window.toMs);
              }),
            ];
          });
          if (replace) setHasMore(rows.length === LOG_PAGE_SIZE);
          setStats(summary);
          setError('');
          setLastUpdated(Date.now());
          firstRequest = false;
        }
      } catch {
        if (!cancelled && requestGeneration.current === generation) setError('Could not load logs.');
      } finally {
        if (!cancelled && requestGeneration.current === generation) {
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
  }, [siteSel, serviceSel, environment, severitySel, search, searchIn, timeRange, customFrom, customTo, live, refreshNonce]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !logs?.length) return;
    const window = resolveTimeWindow(timeRange, customFrom, customTo);
    if (!window.valid) return;

    const generation = requestGeneration.current;
    const beforeId = logs[logs.length - 1].id;
    const siteId = siteSel === 'all' ? null : siteSel;
    const severity = severitySel.length > 0 ? severitySel : '';
    const serviceId = serviceSel === 'all' ? null : serviceSel;
    const environmentValue = environment === 'all' ? undefined : environment;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await api.listLogs({
        siteId,
        serviceId,
        environment: environmentValue,
        severity,
        search: search.trim(),
        searchIn,
        fromMs: window.fromMs,
        toMs: window.toMs,
        beforeId,
        limit: LOG_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setLogs((current) => {
        if (!current) return page;
        const currentIDs = new Set(current.map((row) => row.id));
        return [...current, ...page.filter((row) => !currentIDs.has(row.id))];
      });
      setHasMore(page.length === LOG_PAGE_SIZE);
      setError('');
    } catch {
      if (requestGeneration.current === generation) {
        setHasMore(false);
        setError('Could not load older logs. Refresh to try again.');
      }
    } finally {
      if (requestGeneration.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [customFrom, customTo, environment, hasMore, logs, search, searchIn, serviceSel, severitySel, siteSel, timeRange]);

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
    loadingMore,
    hasMore,
    loadMore,
    setRefreshNonce,
    live,
    setLive,
    siteSel,
    setSiteSel,
    severitySel,
    setSeveritySel,
    serviceSel,
    setServiceSel,
    environment,
    setEnvironment,
    filterOptions,
    search,
    setSearch,
    searchIn,
    setSearchIn,
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

function readIDSelection(value: string | null): SiteSelection {
  const id = Number(value);
  return value && Number.isInteger(id) && id > 0 ? id : 'all';
}

function readSeverities(params: URLSearchParams): SeveritySelection {
  const valid = new Set(['debug', 'info', 'warn', 'error']);
  return [...new Set(params.getAll('severity').flatMap((value) => value.split(',')))]
    .filter((value): value is SeveritySelection[number] => valid.has(value));
}

function readSearchScope(value: string | null): SearchScope {
  return value === 'message' || value === 'extra' ? value : 'both';
}

function readTimeRange(value: string | null): TimeRange {
  return value === '1h' || value === '6h' || value === '24h' || value === '7d' || value === 'custom' || value === 'all'
    ? value
    : '15m';
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}
