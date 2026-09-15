import { FormEvent, useEffect, useState } from 'react';
import { api, Site } from '../../../../api';

export function useAddSiteModal(open: boolean, onCreated: () => void | Promise<void>) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setUrl('');
      setSite(null);
      setError('');
      setSaving(false);
    }
  }, [open]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      setError('Site name and website URL are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await api.createSite(name.trim(), url.trim());
      setSite(created);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create site.');
    } finally {
      setSaving(false);
    }
  }

  return { name, setName, url, setUrl, site, error, saving, create };
}
