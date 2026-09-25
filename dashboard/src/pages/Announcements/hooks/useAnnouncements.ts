import { useEffect, useMemo, useState } from 'react';
import { Announcement, api, Site } from '../../../api';

type AnnouncementHeaderRow = { key: string; value: string };

type AnnouncementForm = {
  site_id: number | null;
  title: string;
  summary: string;
  body: string;
  release_label: string;
  link_url: string;
  internal_headers: AnnouncementHeaderRow[];
};

const emptyHeader = (): AnnouncementHeaderRow => ({ key: '', value: '' });

const blank: AnnouncementForm = {
  site_id: null,
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
    api.listSites().then(setSites).catch(() => setError('Could not load sites.'));
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
            site_id: item.site_id,
            title: item.title,
            summary: item.summary,
            body: item.body,
            release_label: item.release_label,
            link_url: item.link_url,
            internal_headers: headerRows(item.internal_headers),
          }
        : { ...blank, site_id: siteId, internal_headers: [emptyHeader()] },
    );
  }

  async function save() {
    if (!form.site_id || !form.title.trim()) return;
    const destinationSiteId = form.site_id;
    setBusy(true);
    setError('');
    try {
      const payload = {
        title: form.title,
        summary: form.summary,
        body: form.body,
        release_label: form.release_label,
        link_url: form.link_url,
        internal_headers: headerMap(form.internal_headers),
      };
      if (editing === 'new') await api.createAnnouncement({ ...payload, site_id: destinationSiteId });
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
