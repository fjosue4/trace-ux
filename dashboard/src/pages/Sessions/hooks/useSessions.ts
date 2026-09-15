import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Session, SessionFilter, Site } from '../../../api';

type SiteSelection = number | 'all';

export function useSessions() {
  const [params] = useSearchParams();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SiteSelection>(
    params.get('site') ? Number(params.get('site')) : 'all',
  );
  const [filter, setFilter] = useState<SessionFilter>({});
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
    const site = params.get('site');
    if (site) setSelected(Number(site));
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    api
      .listSessions(selected === 'all' ? null : selected, filter)
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load sessions.');
      });
    return () => {
      cancelled = true;
    };
  }, [selected, filter]);

  useEffect(() => {
    api
      .sessionStats(selected === 'all' ? null : selected)
      .then(setStats)
      .catch(() => setStats(null));
  }, [selected]);

  const set = (patch: Partial<SessionFilter>) => setFilter((f) => ({ ...f, ...patch }));

  return { sites, sessions, countries, error, selected, setSelected, filter, set, stats };
}
