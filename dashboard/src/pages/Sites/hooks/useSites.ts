import { useEffect, useState } from 'react';
import { api, Site } from '../../../api';

export type SiteActivity = { active: number; completed: number };

export function useSites() {
  const [sites, setSites] = useState<Site[] | null>(null);
  // In-progress / completed counts per site id. Loaded after the list so the
  // rows render immediately; a site whose stats fail simply shows none.
  const [activity, setActivity] = useState<Record<number, SiteActivity>>({});
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Site | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      const list = await api.listSites();
      setSites(list);
      const results = await Promise.allSettled(list.map((s) => api.sessionStats(s.id)));
      const next: Record<number, SiteActivity> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[list[i].id] = r.value;
      });
      setActivity(next);
    } catch {
      setError('Could not load sites.');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteSite(pendingDelete.id);
      setPendingDelete(null);
      load();
    } catch {
      setError('Could not delete site.');
    } finally {
      setDeleting(false);
    }
  }

  return { sites, activity, error, load, pendingDelete, setPendingDelete, deleting, confirmDelete };
}
