import { useEffect, useMemo, useState } from 'react';
import { Announcement, api, Site } from '../../../api';

type AnnouncementHeaderRow = { key: string; value: string };

type AnnouncementForm = {
  title: string;
  summary: string;
  body: string;
  release_label: string;
  link_url: string;
  internal_headers: AnnouncementHeaderRow[];
};

const emptyHeader = (): AnnouncementHeaderRow => ({ key: '', value: '' });

const blank: AnnouncementForm = {
  title: '',
  summary: '',
  body: '',
  release_label: '',
  link_url: '',
  internal_headers: [emptyHeader()],
};

function headerRows(headers?: Record<string, string>): AnnouncementHeaderRow[] {
  const rows = Object.entries(headers || {}).map(([key, value]) => ({ key, value }));
  return rows.length ? rows : [emptyHeader()];
}

function headerMap(rows: AnnouncementHeaderRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((out, row) => {
    const key = row.key.trim();
    if (key) out[key] = row.value;
    return out;
  }, {});
}

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
        ? {
            title: item.title,
            summary: item.summary,
            body: item.body,
            release_label: item.release_label,
            link_url: item.link_url,
            internal_headers: headerRows(item.internal_headers),
          }
        : { ...blank, internal_headers: [emptyHeader()] },
    );
  }

  async function save() {
    if (!siteId || !form.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const payload = { ...form, internal_headers: headerMap(form.internal_headers) };
      if (editing === 'new') await api.createAnnouncement({ site_id: siteId, ...payload });
      else if (editing) await api.updateAnnouncement(editing.id, payload);
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

  function patchHeader(index: number, patch: Partial<AnnouncementHeaderRow>) {
    setForm((current) => ({
      ...current,
      internal_headers: current.internal_headers.map((header, i) => (i === index ? { ...header, ...patch } : header)),
    }));
  }

  function addHeader() {
    setForm((current) => ({ ...current, internal_headers: [...current.internal_headers, emptyHeader()] }));
  }

  function removeHeader(index: number) {
    setForm((current) => {
      const next = current.internal_headers.filter((_, i) => i !== index);
      return { ...current, internal_headers: next.length ? next : [emptyHeader()] };
    });
  }

  return {
    sites,
    siteId,
    setSiteId,
    items,
    filter,
    setFilter,
    editing,
    setEditing,
    form,
    setForm,
    error,
    busy,
    shown,
    open,
    save,
    action,
    patchHeader,
    addHeader,
    removeHeader,
  };
}
