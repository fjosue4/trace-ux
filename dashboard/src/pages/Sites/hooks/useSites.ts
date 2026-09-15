import { useEffect, useState } from 'react';
import { api, Site } from '../../../api';

export function useSites() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Site | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      setSites(await api.listSites());
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

  return { sites, error, load, pendingDelete, setPendingDelete, deleting, confirmDelete };
}
