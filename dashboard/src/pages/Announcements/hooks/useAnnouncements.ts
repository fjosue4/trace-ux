import { useEffect, useMemo, useState } from 'react';
import { Announcement, api, Site } from '../../../api';

const blank = { title: '', summary: '', body: '', release_label: '', link_url: '' };

export function useAnnouncements() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Announcement | null | 'new'>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.listAnnouncements(siteId).then(setItems).catch(() => setError('Could not load announcements.'));

  useEffect(() => {
    api.listSites().then((s) => {
      setSites(s);
      if (s[0]) setSiteId(s[0].id);
    });
  }, []);

  useEffect(() => {
    setItems(null);
    load();
  }, [siteId]);

  const shown = useMemo(() => (items || []).filter((a) => filter === 'all' || a.status === filter), [items, filter]);

  function open(item?: Announcement) {
    setEditing(item || 'new');
    setForm(
      item
        ? { title: item.title, summary: item.summary, body: item.body, release_label: item.release_label, link_url: item.link_url }
        : blank,
    );
  }

  async function save() {
    if (!siteId || !form.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (editing === 'new') await api.createAnnouncement({ site_id: siteId, ...form });
      else if (editing) await api.updateAnnouncement(editing.id, form);
      setEditing(null);
      await load();
    } catch {
      setError('Could not save the announcement.');
    } finally {
      setBusy(false);
    }
  }

  async function action(a: Announcement, kind: 'publish' | 'archive' | 'delete') {
    setBusy(true);
    try {
      if (kind === 'publish') await api.publishAnnouncement(a.id);
      else if (kind === 'archive') await api.archiveAnnouncement(a.id);
      else await api.deleteAnnouncement(a.id);
      await load();
    } catch {
      setError(`Could not ${kind} the announcement.`);
    } finally {
      setBusy(false);
    }
  }

  return { sites, siteId, setSiteId, items, filter, setFilter, editing, setEditing, form, setForm, error, busy, shown, open, save, action };
}
