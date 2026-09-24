import { useState } from 'react';
import { Announcement } from '../../api';
import { useUser } from '../../App';
import { fmtTime } from '../../lib/format';
import { markdownToPlainText, renderMarkdownHTML } from '../../lib/markdown';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import Loading from '../../components/ui/Loading';
import Modal from '../../components/ui/Modal';
import Notice from '../../components/ui/Notice';
import FilterPanel from '../../components/ui/FilterPanel';
import { Input, Select } from '../../components/ui/fields';
import EngagementModal from './subcomponents/EngagementModal';
import { useAnnouncements } from './hooks/useAnnouncements';
import './Announcements.scss';

export default function Announcements() {
  const { user } = useUser();
  const [engaging, setEngaging] = useState<Announcement | null>(null);
  const [previewing, setPreviewing] = useState<Announcement | null>(null);
  const {
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
  } = useAnnouncements();

  return (
    <main className="page announcements-page">
      <PageHeader
        title="Announcements"
        subtitle="Publish feature releases, maintenance notices, and product news to your visitors."
        actions={user.role === 'admin' ? <Button onClick={() => open()} disabled={!siteId}>New announcement</Button> : undefined}
      />
      <FilterPanel title="Filter announcements">
        <Select
          ariaLabel="Site"
          value={String(siteId || '')}
          onChange={(v) => setSiteId(Number(v))}
          options={sites.map((s) => ({ value: String(s.id), label: s.name }))}
        />
        <Select
          ariaLabel="Status"
          value={filter}
          onChange={setFilter}
          options={['all', 'draft', 'published', 'archived'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
        />
      </FilterPanel>
      {error && <Notice tone="error">{error}</Notice>}
      {items === null ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing announced yet" description="Create a draft, preview the message, then publish it when you're ready." />
      ) : (
        <div className="announcement-grid">
          {shown.map((a) => (
            <Card key={a.id} className="announcement-card">
              <button
                type="button"
                className="announcement-card__preview"
                onClick={() => setPreviewing(a)}
                aria-label={`Preview ${a.title}`}
              >
                <div className="announcement-card__top">
                  <div>
                    <span className="announcement-kicker">{a.release_label || 'Announcement'}</span>
                    <h2>{a.title}</h2>
                  </div>
                  <Badge tone={a.status === 'published' ? 'accent' : 'neutral'}>{a.status}</Badge>
                </div>
                <p className="announcement-card__excerpt">{a.summary || markdownToPlainText(a.body) || 'No announcement details yet.'}</p>
                <span className="announcement-card__preview-label">Open formatted preview →</span>
              </button>
              <button type="button" className="announcement-stats" onClick={() => setEngaging(a)}>
                <span>{a.reads} reads</span>
                <span>{a.reactions} likes</span>
                <span>{a.comments} comments</span>
                <span>{a.published_at ? fmtTime(a.published_at) : `Updated ${fmtTime(a.updated_at)}`}</span>
              </button>
              {user.role === 'admin' && (
                <div className="announcement-actions">
                  <Button size="sm" variant="secondary" onClick={() => open(a)}>Edit</Button>
                  {a.status !== 'published' && (
                    <Button size="sm" onClick={() => action(a, 'publish')} disabled={busy}>Publish</Button>
                  )}
                  {a.status === 'published' && (
                    <Button size="sm" variant="secondary" onClick={() => action(a, 'archive')} disabled={busy}>Archive</Button>
                  )}
                  <Button size="sm" variant="dangerGhost" onClick={() => action(a, 'delete')} disabled={busy}>Delete</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <EngagementModal announcement={engaging} onClose={() => setEngaging(null)} />
      <Modal
        className="announcement-preview-modal"
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        title="Announcement preview"
        footer={<Button variant="secondary" onClick={() => setPreviewing(null)}>Close</Button>}
      >
        {previewing && (
          <div className="announcement-full-preview">
            <div className="announcement-full-preview__meta">
              <span>Visitor view</span>
              <Badge tone={previewing.status === 'published' ? 'accent' : 'neutral'}>{previewing.status}</Badge>
            </div>
            <article className="announcement-preview__card">
              <small>{previewing.release_label || 'Announcement'}</small>
              <strong>{previewing.title}</strong>
              {(previewing.body || previewing.summary) ? (
                <div
                  className="announcement-preview__body announcement-preview__markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownHTML(previewing.body || previewing.summary) }}
                />
              ) : (
                <p>No announcement details yet.</p>
              )}
              {previewing.link_url && (
                <a className="announcement-preview__link" href={previewing.link_url} target="_blank" rel="noopener noreferrer">
                  Learn more ↗
                </a>
              )}
            </article>
          </div>
        )}
      </Modal>

      <Modal
        className="announcement-editor-modal"
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New announcement' : 'Edit announcement'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !form.title.trim()}>{busy ? 'Saving…' : 'Save draft'}</Button>
          </>
        }
      >
        <div className="announcement-editor">
          <div className="announcement-form">
            <label>
              Title
              <Input value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.currentTarget.value })} placeholder="What’s new?" />
            </label>
            <div className="announcement-form__row">
              <label>
                Release label
                <Input value={form.release_label} maxLength={60} onChange={(e) => setForm({ ...form, release_label: e.currentTarget.value })} placeholder="v2.4 · Maintenance" />
              </label>
              <label>
                Optional link
                <Input value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.currentTarget.value })} placeholder="https://…" />
              </label>
            </div>
            <label>
              Short summary
              <textarea className="field-control" value={form.summary} maxLength={300} onChange={(e) => setForm({ ...form, summary: e.currentTarget.value })} placeholder="A concise overview for the feed." />
            </label>
            <label>
              <span className="announcement-form__label-row">
                <span>Details</span>
                <span className="announcement-form__markdown-hint">Markdown supported</span>
              </span>
              <textarea className="field-control announcement-form__body" value={form.body} maxLength={10000} onChange={(e) => setForm({ ...form, body: e.currentTarget.value })} placeholder="Explain the update with **bold text**, lists, links, or code." />
            </label>
            <div className="announcement-form__internal">
              <div className="announcement-form__section-head">
                <div>
                  <strong>Internal headers</strong>
                  <p className="announcement-form__help">Key/value metadata delivered to npm/React’s <code>onAnnouncement</code> callback. It is not shown in the visitor widget. Do not store secrets here.</p>
                </div>
                <Button size="sm" variant="secondary" onClick={addHeader}>Add key</Button>
              </div>
              {form.internal_headers.map((header, index) => (
                <div className="announcement-form__header-row" key={index}>
                  <Input
                    aria-label={`Internal header ${index + 1} key`}
                    value={header.key}
                    onChange={(e) => patchHeader(index, { key: e.currentTarget.value })}
                    placeholder="Key (e.g. current_version)"
                  />
                  <Input
                    aria-label={`Internal header ${index + 1} value`}
                    value={header.value}
                    onChange={(e) => patchHeader(index, { value: e.currentTarget.value })}
                    placeholder="Value (e.g. 0.1.1)"
                  />
                  {form.internal_headers.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => removeHeader(index)} aria-label={`Remove internal header ${index + 1}`}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <aside className="announcement-preview">
            <span>Visitor preview</span>
            <div className="announcement-preview__card">
              <small>{form.release_label || 'Announcement'}</small>
              <strong>{form.title || 'Announcement title'}</strong>
              {form.summary ? <p>{form.summary}</p> : !form.body && <p>Your summary will appear here.</p>}
              {form.body && (
                <div
                  className="announcement-preview__body announcement-preview__markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownHTML(form.body) }}
                />
              )}
              {form.link_url && <span className="announcement-preview__link">Learn more ↗</span>}
            </div>
          </aside>
        </div>
      </Modal>
    </main>
  );
}
