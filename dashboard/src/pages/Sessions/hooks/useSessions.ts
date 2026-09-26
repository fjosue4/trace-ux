import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Session, SessionFilter, Site } from '../../../api';

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
const resultCache = new Map<string, Session[]>();
const MAX_CACHED_QUERIES = 20;

function remember(key: string, rows: Session[]) {
  resultCache.delete(key);
  resultCache.set(key, rows);
  if (resultCache.size > MAX_CACHED_QUERIES) resultCache.delete(resultCache.keys().next().value!);
}

// A deleted recording must not reappear from the cache on the way back.
export function forgetCachedSession(id: string) {
  for (const [key, rows] of resultCache) {
    resultCache.set(key, rows.filter((row) => row.id !== id));
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
  const [sessions, setSessions] = useState<Session[] | null>(() => resultCache.get(queryKey) ?? null);
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
    const controller = new AbortController();
    const cached = resultCache.get(queryKey);
    if (cached) {
      setSessions(cached);
      setShownKey(queryKey);
    }
    setError('');
    api
      .listSessions(selected === 'all' ? null : selected, filter, controller.signal)
      .then((rows) => {
        remember(queryKey, rows);
        if (cancelled) return;
        setSessions(rows);
        setShownKey(queryKey);
      })
      .catch((cause) => {
        if (cancelled) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('Could not load sessions.');
        setShownKey(queryKey);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // queryKey already encodes selected and filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

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

  return { sites, sessions, countries, error, selected, setSelected, filter, set, stats, searching };
}
