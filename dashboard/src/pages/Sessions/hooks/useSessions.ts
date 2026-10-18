import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Session, SessionFilter, Site } from '../../../api';
import { SESSION_PAGE_SIZE } from '../Sessions.constants';

type SiteSelection = number | 'all';

// Every filter lives in the URL, so a search survives opening a replay and
// coming back, a reload, or a link sent to a teammate. Keys match
// SessionFilter so the mapping stays obvious.
const TEXT_KEYS = ['browser', 'os', 'device', 'country', 'url', 'action', 'identity'] as const;
const MIN_LENGTH_KEY = 'min_duration_ms';

function filterFromParams(params: URLSearchParams): SessionFilter {
  const filter: SessionFilter = {};
  for (const key of TEXT_KEYS) {
    const value = params.get(key);
    if (value) filter[key] = value;
  }
  const minLength = Number(params.get(MIN_LENGTH_KEY));
  if (minLength > 0) filter.min_duration_ms = minLength;
  return filter;
}

function siteFromParams(params: URLSearchParams): SiteSelection {
  const site = Number(params.get('site'));
  return site > 0 ? site : 'all';
}

// The last results for each query, kept for the life of the tab. Coming back
// from a replay shows the same rows at once instead of searching again; a
// quiet refresh still picks up sessions recorded in the meantime.
type SessionCursor = { before: number; before_id: string };
type CachedSessions = { rows: Session[]; hasMore: boolean; cursor: SessionCursor | null };
const resultCache = new Map<string, CachedSessions>();
const MAX_CACHED_QUERIES = 20;

function remember(key: string, result: CachedSessions) {
  resultCache.delete(key);
  resultCache.set(key, result);
  if (resultCache.size > MAX_CACHED_QUERIES) resultCache.delete(resultCache.keys().next().value!);
}

// A deleted recording must not reappear from the cache on the way back.
export function forgetCachedSession(id: string) {
  for (const [key, result] of resultCache) {
    resultCache.set(key, { ...result, rows: result.rows.filter((row) => row.id !== id) });
  }
}

// The row is marked immediately before navigation so Back does not briefly
// restore it as unread while the refreshed server result is in flight.
export function markCachedSessionViewed(id: string) {
  for (const [key, result] of resultCache) {
    resultCache.set(key, { ...result, rows: result.rows.map((row) => row.id === id ? { ...row, viewed: true } : row) });
  }
}

export function useSessions() {
  const [params, setParams] = useSearchParams();
  const selected = siteFromParams(params);
  // Rebuilt only when the query string changes, so effects keyed on the
  // filter do not refire on unrelated renders.
  const queryString = params.toString();
  const filter = useMemo(() => filterFromParams(new URLSearchParams(queryString)), [queryString]);
  const queryKey = `${selected}|${JSON.stringify(filter)}`;

  const [sites, setSites] = useState<Site[] | null>(null);
  const [result, setResult] = useState<CachedSessions | null>(() => resultCache.get(queryKey) ?? null);
  const sessions = result?.rows ?? null;
  const [refreshing, setRefreshing] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const requestGeneration = useRef(0);
  const loadingMoreRef = useRef(false);
  const pageController = useRef<AbortController | null>(null);
  // Which query the rows on screen answer. Anything else on screen is stale,
  // and the page says so with a spinner rather than showing old rows as if
  // they were the result.
  const [shownKey, setShownKey] = useState<string | null>(() => (resultCache.has(queryKey) ? queryKey : null));
  const [countries, setCountries] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<{ active: number; completed: number } | null>(null);

  useEffect(() => {
    setCountries([]);
    api
      .listSessionCountries(selected === 'all' ? null : selected)
      .then(setCountries)
      .catch(() => setCountries([]));
  }, [selected]);

  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    const cached = resultCache.get(queryKey);
    setResult(cached ?? null);
    setShownKey(cached ? queryKey : null);
    setRefreshing(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setLoadMoreError('');
    setError('');

    async function load() {
      try {
        // Revalidate every previously loaded page when returning from replay.
        // Keep the cached list visible while rebuilding a continuous prefix;
        // refreshing just its first page can leave gaps when new sessions arrive.
        const target = Math.max(SESSION_PAGE_SIZE, cached?.rows.length ?? 0);
        const next: CachedSessions = { rows: [], hasMore: false, cursor: null };
        do {
          const rows = await api.listSessions(selected === 'all' ? null : selected, {
            ...filter,
            ...next.cursor,
            limit: SESSION_PAGE_SIZE,
          }, controller.signal);
          if (cancelled || requestGeneration.current !== generation) return;
          next.rows.push(...rows);
          next.hasMore = rows.length === SESSION_PAGE_SIZE;
          const last = rows[rows.length - 1];
          if (last) next.cursor = { before: last.started_at, before_id: last.id };
        } while (next.hasMore && next.rows.length < target);
        remember(queryKey, next);
        setResult(next);
        setShownKey(queryKey);
      } catch (cause) {
        if (cancelled || requestGeneration.current !== generation) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('Could not load sessions.');
        if (!cached) setResult({ rows: [], hasMore: false, cursor: null });
        setShownKey(queryKey);
      } finally {
        if (!cancelled && requestGeneration.current === generation) setRefreshing(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      pageController.current?.abort();
      requestGeneration.current += 1;
    };
    // queryKey already encodes selected and filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const hasMore = shownKey === queryKey && (result?.hasMore ?? false);
  const loadMore = useCallback(async () => {
    if (refreshing || loadingMoreRef.current || shownKey !== queryKey || !result?.hasMore || !result.cursor) return;
    const generation = requestGeneration.current;
    const controller = new AbortController();
    pageController.current = controller;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const rows = await api.listSessions(selected === 'all' ? null : selected, {
        ...filter,
        ...result.cursor,
        limit: SESSION_PAGE_SIZE,
      }, controller.signal);
      if (controller.signal.aborted || requestGeneration.current !== generation) return;
      const ids = new Set(result.rows.map((row) => row.id));
      const last = rows[rows.length - 1];
      const next: CachedSessions = {
        rows: [...result.rows, ...rows.filter((row) => !ids.has(row.id))],
        hasMore: rows.length === SESSION_PAGE_SIZE,
        cursor: last ? { before: last.started_at, before_id: last.id } : result.cursor,
      };
      remember(queryKey, next);
      setResult(next);
    } catch (cause) {
      if (controller.signal.aborted || requestGeneration.current !== generation) return;
      setLoadMoreError('Could not load older sessions.');
    } finally {
      if (requestGeneration.current === generation) {
        pageController.current = null;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [filter, selected, queryKey, shownKey, result, refreshing]);

  useEffect(() => {
    api
      .sessionStats(selected === 'all' ? null : selected)
      .then(setStats)
      .catch(() => setStats(null));
  }, [selected]);

  // replace: refining a search is not a new page, so Back leaves the list
  // instead of stepping through every keystroke.
  const set = useCallback(
    (patch: Partial<SessionFilter>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '' || value === 0) next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const setSelected = useCallback(
    (site: SiteSelection) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (site === 'all') next.delete('site');
          else next.set('site', String(site));
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const searching = shownKey !== queryKey;

  return { sites, sessions, countries, error, selected, setSelected, filter, set, stats, searching, hasMore, loadingMore, loadMore, loadMoreError };
}
