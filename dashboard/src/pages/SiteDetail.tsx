import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnnouncementAppearance, api, FeedbackTrigger, Log, LogSeverity, PerformanceKey, SiteDetail as SiteDetailData, SiteSettings, SurveyQuestion } from '../api';
import { fmtDuration, fmtTime, stripProto, truncate } from '../lib/format';
import { useUser } from '../App';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Switch from '../components/ui/Switch';
import { Icon } from '../components/ui/Icon';
import { Field, Input, Select } from '../components/ui/fields';
import SnippetCard from '../components/sites/SnippetCard';
import WidgetPreview from '../components/sites/WidgetPreview';
import { AnnouncementSettingsModal, FeedbackSettingsModal } from '../components/sites/WidgetSettingsModals';
import './SiteDetail.css';

type SiteTab = 'overview' | 'site' | 'recordings' | 'widget' | 'logs';

const siteTabs: { id: SiteTab; label: string; icon: 'activity' | 'settings' | 'film' | 'message' | 'megaphone' | 'code' }[] = [
  { id: 'overview', label: 'Overview', icon: 'activity' },
  { id: 'site', label: 'Site', icon: 'settings' },
  { id: 'recordings', label: 'Recordings', icon: 'film' },
  { id: 'widget', label: 'Widget', icon: 'settings' },
  { id: 'logs', label: 'Logs', icon: 'code' },
];
const announcementAccents = ['#2f7d4a', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2'];

// Site hub: recording toggle, overall feedback health, the latest recordings
// and feedback, and the widget/survey configuration — all managed here, all
// enforced server-side.
export default function SiteDetail() {
  const { siteId } = useParams();
  const { user } = useUser();
  const isAdmin = user.role === 'admin';
  const [detail, setDetail] = useState<SiteDetailData | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [urlSaving, setUrlSaving] = useState(false);
  const [performanceKeys, setPerformanceKeys] = useState<PerformanceKey[]>([]);
  const [newPerformanceKey, setNewPerformanceKey] = useState<{ id: number; value: string; hint: string } | null>(null);
  const [performanceKeySaving, setPerformanceKeySaving] = useState(false);
  const [performanceKeyCopied, setPerformanceKeyCopied] = useState(false);
  const [performanceExampleCopied, setPerformanceExampleCopied] = useState(false);
  const [latestLogs, setLatestLogs] = useState<Log[]>([]);
  const [activeTab, setActiveTab] = useState<SiteTab>('overview');
  const [widgetSettingsModal, setWidgetSettingsModal] = useState<'announcements' | 'feedback' | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);

  const id = Number(siteId);

  // Mirrors buildWidgetConfig on the server: with only one section switched on
  // the launcher names it rather than showing a generic label.
  const launcherPlaceholder = (() => {
    const on = [
      draft?.updates_enabled && "What's new",
      draft?.tickets_enabled && 'Support',
      draft?.feedback_enabled && 'Feedback',
    ].filter(Boolean) as string[];
    return on.length === 1 ? on[0] : 'Help & updates';
  })();

  // Re-read the site without touching `draft`. Anything that saves something
  // other than the settings — an icon, the URL, the recording switch — has to
  // use this: re-seeding the draft from the server would silently throw away
  // whatever unsaved widget styling the operator is in the middle of.
  const refreshDetail = useCallback(() => {
    api
      .getSiteDetail(id)
      .then((d) => {
        setDetail(d);
        setPerformanceKeys(d.performance_keys ?? []);
      })
      .catch(() => setError('Could not load this site.'));
  }, [id]);

  const load = useCallback(() => {
    api
      .getSiteDetail(id)
      .then((d) => {
        setDetail(d);
        setDraft(d.site.settings ?? null);
        setPerformanceKeys(d.performance_keys ?? []);
      })
      .catch(() => setError('Could not load this site.'));
    api.listLogs({ siteId: id, limit: 5 }).then(setLatestLogs).catch(() => setLatestLogs([]));
  }, [id]);

  useEffect(() => {
    if (id > 0) load();
  }, [id, load]);

  useEffect(() => {
    setActiveTab('overview');
    setNewPerformanceKey(null);
    setPerformanceKeyCopied(false);
    setPerformanceExampleCopied(false);
    setWidgetSettingsModal(null);
  }, [id]);

  async function uploadIcon(file: File) {
    setIconBusy(true);
    setIconError(null);
    try {
      await api.uploadWidgetIcon(id, file);
      refreshDetail();
    } catch (e) {
      setIconError(e instanceof Error ? e.message : 'Could not upload that image.');
    } finally {
      setIconBusy(false);
    }
  }

  async function removeIcon() {
    setIconBusy(true);
    setIconError(null);
    try {
      await api.deleteWidgetIcon(id);
      refreshDetail();
    } catch {
      setIconError('Could not remove the icon.');
    } finally {
      setIconBusy(false);
    }
  }

  async function toggleRecording(enabled: boolean) {
    try {
      await api.updateSiteRecording(id, enabled);
      refreshDetail();
    } catch {
      setError('Could not change the recording setting.');
    }
  }

  async function saveURL() {
    if (urlDraft === null) return;
    setUrlSaving(true);
    try {
      await api.updateSiteURL(id, urlDraft.trim());
      setUrlDraft(null);
      refreshDetail();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the site URL.');
    } finally {
      setUrlSaving(false);
    }
  }

  async function saveSettings() {
    if (!draft) return;
    setSaving(true);
    setSaved(false);
    try {
      const normalized: SiteSettings = {
        ...draft,
        questions: draft.questions?.map((q, i) => ({ ...q, id: q.id || `q${i + 1}` })),
      };
      await api.updateSiteSettings(id, normalized);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the configuration.');
    } finally {
      setSaving(false);
    }
  }

  async function createPerformanceKey() {
    setPerformanceKeySaving(true);
    try {
      const result = await api.createPerformanceKey(id);
      setNewPerformanceKey({ id: result.key_id, value: result.performance_key, hint: result.key_hint });
      setPerformanceKeys((keys) => [
        { id: result.key_id, key_hint: result.key_hint, created_at: result.created_at, last_used_at: 0 },
        ...keys,
      ]);
      setPerformanceKeyCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a performance key.');
    } finally {
      setPerformanceKeySaving(false);
    }
  }

  async function copyPerformanceKey() {
    if (!newPerformanceKey) return;
    try {
      await navigator.clipboard.writeText(newPerformanceKey.value);
      setPerformanceKeyCopied(true);
      setTimeout(() => setPerformanceKeyCopied(false), 1800);
    } catch {
      setError('Could not copy the performance key.');
    }
  }

  async function copyPerformanceExample(example: string) {
    try {
      await navigator.clipboard.writeText(example);
      setPerformanceExampleCopied(true);
      setTimeout(() => setPerformanceExampleCopied(false), 1800);
    } catch {
      setError('Could not copy the connection example.');
    }
  }

  async function removePerformanceKey(key: PerformanceKey) {
    if (!window.confirm(`Remove performance key ${key.key_hint}? Any backend using it will stop sending data.`)) return;
    try {
      await api.deletePerformanceKey(id, key.id);
      setPerformanceKeys((keys) => keys.filter((item) => item.id !== key.id));
      if (newPerformanceKey?.id === key.id) setNewPerformanceKey(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the performance key.');
    }
  }

  function patchDraft(patch: Partial<SiteSettings>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function patchQuestion(i: number, patch: Partial<SurveyQuestion>) {
    setDraft((d) => {
      if (!d) return d;
      const questions = (d.questions ?? []).map((q, qi) => (qi === i ? { ...q, ...patch } : q));
      return { ...d, questions };
    });
  }

  function patchAnnouncementAppearance(patch: Partial<AnnouncementAppearance>) {
    setDraft((d) => (d ? { ...d, updates_appearance: { ...d.updates_appearance, ...patch } } : d));
  }

  function patchWidgetPosition(position: string) {
    patchDraft({ widget_position: position, updates_position: position, feedback_position: position });
  }

  function patchTrigger(patch: Partial<FeedbackTrigger>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            feedback_trigger: {
              mode: 'always',
              ...(d.feedback_trigger ?? {}),
              ...patch,
            } as FeedbackTrigger,
          }
        : d,
    );
  }

  if (error) {
    return (
      <main className="page">
        <Notice tone="error">{error}</Notice>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="page">
        <Loading />
      </main>
    );
  }

  const { site, sessions, feedback, stats } = detail;
  const recordingOn = site.recording_enabled ?? true;
  const trigger = draft?.feedback_trigger ?? { mode: 'always' as const };
  const widgetAppearance = {
    theme: draft?.updates_appearance?.theme ?? 'light',
    accent: draft?.updates_appearance?.accent || draft?.appearance?.accent || draft?.appearance?.primary || '#2f7d4a',
    radius: draft?.updates_appearance?.radius || draft?.appearance?.radius || 18,
    max_width: draft?.updates_appearance?.max_width || 440,
    button_label: draft?.updates_appearance?.button_label ?? draft?.appearance?.button_label ?? '',
  };

  return (
    <main className="page">
      <PageHeader
        title={site.name}
        subtitle={`Site key ${site.site_key} · tracking since ${fmtTime(site.created_at)}`}
        actions={
          <>
            {isAdmin && (
              <Switch
                checked={recordingOn}
                onChange={toggleRecording}
                label={recordingOn ? 'Recording on' : 'Recording off'}
              />
            )}
            <Link to={`/sessions?site=${site.id}`} className="btn btn--secondary btn--sm">
              <Icon name="film" size={13} />
              All sessions
            </Link>
          </>
        }
      />

      {!recordingOn && (
        <Notice tone="info">
          Recording is <strong>off</strong> for this site — visitors' sessions are not captured,
          but the feedback section keeps working.
        </Notice>
      )}

      <nav className="site-tabs" aria-label="Site management sections">
        {siteTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`site-tab${activeTab === tab.id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <Icon name={tab.icon} size={14} />
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'site' && (
        <>
      <Card className="site-url">
        <form
          className="row row--between"
          onSubmit={(e) => {
            e.preventDefault();
            saveURL();
          }}
        >
          <div className="site-url__info">
            <strong>
              <Icon name="globe" size={13} /> Website URL
            </strong>
            <span className="muted small">
              Recordings are only accepted from this origin — update it if the site moves.
            </span>
          </div>
          {isAdmin ? (
            <div className="row">
              <Input
                value={urlDraft ?? site.url}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://your-site.com"
                inputMode="url"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={urlSaving || (urlDraft ?? site.url).trim() === site.url}
              >
                {urlSaving ? 'Saving…' : 'Save URL'}
              </Button>
            </div>
          ) : (
            <span className="small">{site.url || '—'}</span>
          )}
        </form>
      </Card>

      <Card className="site-performance-key">
        <div className="site-performance-key__head">
          <div className="site-url__info">
            <strong><Icon name="activity" size={13} /> Backend performance</strong>
            <span className="muted small">
              This connects your application server to TraceUX. It is not used by the browser
              tracker and does not instrument your backend automatically.
            </span>
          </div>
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={createPerformanceKey} disabled={performanceKeySaving}>
              <Icon name="plus" size={13} />
              {performanceKeySaving ? 'Creating…' : performanceKeys.length ? 'Create another key' : 'Create key'}
            </Button>
          )}
        </div>

        <div className="site-performance-key__steps">
          <strong>Connect your backend in 3 steps</strong>
          <ol>
            <li>Create a key and save the raw value as <code>TRACE_UX_PERFORMANCE_KEY</code> on your backend.</li>
            <li>Measure requests in your application and send observations to the endpoint below.</li>
            <li>Open <Link to="/performance">Performance</Link> to see the resulting percentiles.</li>
          </ol>
          <p className="muted small">
            The <strong>site key</strong> identifies this site in the URL. The <strong>performance key</strong> authenticates the request in the header. No Google authorization, OAuth, or Tag Manager is involved.
          </p>
          <pre className="site-performance-key__example">{`curl -X POST "${location.origin}/api/performance/ingest/${site.site_key}" \\
  -H "Content-Type: application/json" \\
  -H "X-TraceUX-Performance-Key: $TRACE_UX_PERFORMANCE_KEY" \\
  -d '{"observations":[
    {"environment":"production","service":"api","version":"1.4.0","endpoint":"GET /orders","duration_ms":184,"status_code":200}
  ]}'`}</pre>
          <div className="site-performance-key__actions">
            <Button variant="secondary" size="sm" onClick={() => copyPerformanceExample(`curl -X POST "${location.origin}/api/performance/ingest/${site.site_key}" \\
  -H "Content-Type: application/json" \\
  -H "X-TraceUX-Performance-Key: $TRACE_UX_PERFORMANCE_KEY" \\
  -d '{"observations":[
    {"environment":"production","service":"api","version":"1.4.0","endpoint":"GET /orders","duration_ms":184,"status_code":200}
  ]}'`)}>
              <Icon name={performanceExampleCopied ? 'check' : 'copy'} size={13} />
              {performanceExampleCopied ? 'Copied' : 'Copy curl example'}
            </Button>
            <Link to="/performance" className="btn btn--ghost btn--sm">Open Performance</Link>
          </div>
        </div>

        {newPerformanceKey && (
          <div className="site-performance-key__new">
            <div>
              <strong>Copy this new key now</strong>
              <span className="muted small">The full value is shown only after creation and will not be listed again.</span>
            </div>
            <div className="site-performance-key__value">
              <code>{newPerformanceKey.value}</code>
              <Button variant="ghost" size="sm" onClick={copyPerformanceKey}>
                <Icon name={performanceKeyCopied ? 'check' : 'copy'} size={13} />
                {performanceKeyCopied ? 'Copied' : 'Copy key'}
              </Button>
            </div>
          </div>
        )}

        <div className="site-performance-key__list">
          <div className="site-performance-key__list-head">
            <strong>Created keys</strong>
            <span className="muted small">Only the first and last 4 characters are listed.</span>
          </div>
          {performanceKeys.length > 0 ? (
            <div className="site-performance-key__rows">
              {performanceKeys.map((key) => (
                <div className="site-performance-key__row" key={key.id}>
                  <code>{key.key_hint}</code>
                  <span className="muted small">
                    Created {fmtTime(key.created_at)} · {key.last_used_at ? `Last used ${fmtTime(key.last_used_at)}` : 'Not used yet'}
                  </span>
                  {isAdmin && (
                    <Button variant="dangerGhost" size="sm" onClick={() => removePerformanceKey(key)}>
                      <Icon name="trash" size={13} />
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small site-performance-key__note">No backend keys have been created yet.</p>
          )}
        </div>
      </Card>

      <SnippetCard site={site} origin={location.origin} title="Installation snippet" />
        </>
      )}

      {activeTab === 'overview' && (
        <>
      <div className="hub-stats">
        <Card className="hub-stat">
          <span className="hub-stat__label">Recordings</span>
          <strong className="hub-stat__num">{site.session_count}</strong>
        </Card>
        <Card className="hub-stat">
          <span className="hub-stat__label">Feedback responses</span>
          <strong className="hub-stat__num">{stats.feedback_count}</strong>
        </Card>
        <Card className="hub-stat">
          <span className="hub-stat__label">Positive feedback</span>
          <strong className="hub-stat__num">{stats.feedback_count > 0 ? `${Math.round(stats.positive_pct)}%` : '—'}</strong>
          <span className="muted small">
            {stats.feedback_count > 0 ? `avg ${stats.avg_rating.toFixed(1)}` : 'no responses yet'}
          </span>
        </Card>
      </div>

      <div className="hub-grid">
        <div className="hub-col">
          <h2>Latest recordings</h2>
          {sessions.length === 0 ? (
            <EmptyState
              title="No recordings yet"
              description="Install the snippet on your site and visitors will appear here."
            />
          ) : (
            <div className="hub-list">
              {sessions.map((s) => (
                <Link to={`/replay/${s.id}`} key={s.id} className="hub-row">
                  <span className="hub-row__icon">
                    <Icon name="play" size={13} />
                  </span>
                  <span className="hub-row__body">
                    <span className="hub-row__title">{truncate(stripProto(s.initial_url), 46)}</span>
                    <span className="muted small">{fmtTime(s.started_at)}</span>
                  </span>
                  <span className="chip">{fmtDuration(s.duration_ms)}</span>
                </Link>
              ))}
            </div>
          )}
          <Link to={`/sessions?site=${site.id}`} className="muted small">All recordings →</Link>
        </div>

        <div className="hub-col">
          <h2>Latest logs</h2>
          {latestLogs.length === 0 ? (
            <EmptyState
              title="No logs yet"
              description="Enable browser logs in the Logs tab to see recent console output here."
            />
          ) : (
            <div className="hub-list">
              {latestLogs.map((log) => (
                <div key={log.id} className="hub-row">
                  <span className={`hub-row__icon hub-row__icon--log hub-row__icon--${log.severity}`}>{log.severity.slice(0, 3).toUpperCase()}</span>
                  <span className="hub-row__body">
                    <span className="hub-row__title">{truncate(log.message, 52)}</span>
                    <span className="muted small">{fmtTime(Math.floor(log.timestamp_ms / 1000))}</span>
                  </span>
                  <Link to={`/replay/${log.session_id}`} className="icon-btn" title="Open replay">
                    <Icon name="play" size={13} />
                  </Link>
                </div>
              ))}
            </div>
          )}
          <Link to={`/logs?site=${site.id}`} className="muted small">All logs →</Link>
        </div>

        <div className="hub-col">
          <h2>Latest feedback</h2>
          {feedback.length === 0 ? (
            <EmptyState
              title="No feedback yet"
              description="Enable the feedback section in the Widget tab to start collecting responses."
            />
          ) : (
            <div className="hub-list">
              {feedback.map((f) => (
                <div key={f.id} className="hub-row">
                  <span className="hub-row__icon hub-row__icon--rating">
                    {f.rating <= 5 ? `${f.rating}★` : f.rating}
                  </span>
                  <span className="hub-row__body">
                    <span className="hub-row__title">{f.comment || f.survey_id}</span>
                    <span className="muted small">
                      {(f.answers ?? []).map((a) => a.label || a.id).join(' · ') || f.browser || ''}
                      {f.created_at ? ` · ${fmtTime(f.created_at)}` : ''}
                    </span>
                  </span>
                  {f.session_id && (
                    <Link to={`/replay/${f.session_id}`} className="icon-btn" title="Open replay">
                      <Icon name="play" size={13} />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
          <Link to="/feedback" className="muted small">All feedback →</Link>
        </div>
      </div>
        </>
      )}

      {isAdmin && draft && activeTab !== 'overview' && activeTab !== 'site' && (
        <Card className="hub-config">
          <h2>Manage {activeTab}</h2>
          <p className="muted small">
            Served to the tracker automatically — the snippet never carries these settings.
          </p>

          {activeTab === 'recordings' && (
            <>
          <div className="hub-config__title">Recordings</div>
          <div className="hub-config__grid">
            <Field label="Max simultaneous recordings" hint="0 = no limit">
              <Input
                type="number"
                min={0}
                max={100000}
                value={draft.max_concurrent_sessions ?? 0}
                onChange={(e) => patchDraft({ max_concurrent_sessions: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Keep recordings for (days)" hint="0 = server default">
              <Input
                type="number"
                min={0}
                max={3650}
                value={draft.retention_sessions_days ?? 0}
                onChange={(e) => patchDraft({ retention_sessions_days: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Keep feedback for (days)" hint="0 = server default">
              <Input
                type="number"
                min={0}
                max={3650}
                value={draft.retention_feedback_days ?? 0}
                onChange={(e) => patchDraft({ retention_feedback_days: Number(e.target.value) || 0 })}
              />
            </Field>
          </div>
          <div className="hub-config__row">
            <Switch
              checked={draft.allow_delete_recordings ?? true}
              onChange={(v) => patchDraft({ allow_delete_recordings: v })}
              label="Allow deleting recordings manually"
            />
          </div>

            </>
          )}

          {activeTab === 'logs' && (
            <>
          <div className="hub-config__title">Logs</div>
          <div className="hub-config__row">
            <Switch
              checked={draft.logs.enabled}
              onChange={(enabled) => patchDraft({ logs: { ...draft.logs, enabled } })}
              label="Capture browser logs"
            />
          </div>
          <div className="hub-config__grid">
            <Field
              label="Minimum severity"
              hint="Only this level and more severe logs are stored. Errors are the most severe."
            >
              <Select
                value={draft.logs.minimum_severity}
                onChange={(value) =>
                  patchDraft({ logs: { ...draft.logs, minimum_severity: value as LogSeverity } })
                }
                options={[
                  { value: 'error', label: 'Errors only' },
                  { value: 'warn', label: 'Warnings and errors' },
                  { value: 'info', label: 'Info and above' },
                  { value: 'debug', label: 'All levels' },
                ]}
              />
            </Field>
            <Field label="Keep logs for (days)" hint="0 = no time limit · default 15 days">
              <Input
                type="number"
                min={0}
                max={3650}
                value={draft.logs.retention_days ?? 15}
                onChange={(e) =>
                  patchDraft({
                    logs: { ...draft.logs, retention_days: Number(e.target.value) || 0 },
                  })
                }
              />
            </Field>
            <Field label="Maximum stored logs" hint="0 = no row limit · default 1,000,000">
              <Input
                type="number"
                min={0}
                max={10000000}
                step={1000}
                value={draft.logs.max_rows ?? 1000000}
                onChange={(e) =>
                  patchDraft({
                    logs: { ...draft.logs, max_rows: Number(e.target.value) || 0 },
                  })
                }
              />
            </Field>
          </div>
          <p className="muted small">
            Logs are linked to recordings by session and are removed when the related recording is removed. The age and row caps are enforced during the server's retention sweep.
          </p>
            </>
          )}

          {activeTab === 'widget' && (
            <>
              <div className="hub-config__title">Widget</div>
              <div className="hub-config__row">
                <Switch
                  checked={draft.widget_enabled ?? (!!draft.updates_enabled || !!draft.tickets_enabled || !!draft.feedback_enabled)}
                  onChange={(v) => {
                    patchDraft({ widget_enabled: v });
                    if (!v) setWidgetSettingsModal(null);
                  }}
                  label="Show the widget on this site"
                />
              </div>
              <div className="widget-sections">
                <div className="widget-section">
                  <Switch
                    checked={!!draft.updates_enabled}
                    onChange={(v) => {
                      patchDraft({ updates_enabled: v });
                      if (!v && widgetSettingsModal === 'announcements') setWidgetSettingsModal(null);
                    }}
                    label="Announcements"
                  />
                  {draft.updates_enabled && (
                    <button
                      className="icon-btn widget-section__settings"
                      type="button"
                      aria-label="Configure Announcements"
                      title="Configure Announcements"
                      onClick={() => setWidgetSettingsModal('announcements')}
                    >
                      <Icon name="gear" size={15} />
                    </button>
                  )}
                </div>
                <div className="widget-section">
                  <Switch
                    checked={!!draft.feedback_enabled}
                    onChange={(v) => {
                      patchDraft({ feedback_enabled: v });
                      if (!v && widgetSettingsModal === 'feedback') setWidgetSettingsModal(null);
                    }}
                    label="Feedback"
                  />
                  {draft.feedback_enabled && (
                    <button
                      className="icon-btn widget-section__settings"
                      type="button"
                      aria-label="Configure Feedback"
                      title="Configure Feedback"
                      onClick={() => setWidgetSettingsModal('feedback')}
                    >
                      <Icon name="gear" size={15} />
                    </button>
                  )}
                </div>
                <div className="widget-section">
                  <Switch
                    checked={!!draft.tickets_enabled}
                    onChange={(v) => patchDraft({ tickets_enabled: v })}
                    label="Tickets"
                  />
                </div>
              </div>
              <Notice tone="info">
                One launcher, one panel. Each enabled section becomes a tab inside it. Use the gear beside a section to configure its settings.
              </Notice>
              <div className="announcement-customizer">
                <div className="announcement-customizer__controls">
                  <h3>Choose a look</h3>
                  <p className="muted small">Theme colors are paired automatically for accessible contrast.</p>
                  <Field label="Theme">
                    <div className="announcement-themes">
                      {(['light', 'dark'] as const).map((theme) => (
                        <button
                          key={theme}
                          type="button"
                          className={`announcement-theme${widgetAppearance.theme === theme ? ' is-selected' : ''}`}
                          aria-label={`Use ${theme} theme`}
                          onClick={() => patchAnnouncementAppearance({ theme })}
                        >
                          <span className={`announcement-theme__sample is-${theme}`}><i /><i /></span>
                          <strong>{theme[0].toUpperCase() + theme.slice(1)}</strong>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Accent color">
                    <div className="announcement-swatches">
                      {announcementAccents.map((color) => (
                        <button
                          type="button"
                          key={color}
                          aria-label={`Use ${color}`}
                          title={color}
                          className={widgetAppearance.accent === color ? 'is-selected' : ''}
                          style={{ background: color }}
                          onClick={() => patchAnnouncementAppearance({ accent: color })}
                        />
                      ))}
                    </div>
                    <div className="announcement-custom-color">
                      <input
                        type="color"
                        aria-label="Custom accent color"
                        value={widgetAppearance.accent}
                        onChange={(e) => patchAnnouncementAppearance({ accent: e.target.value })}
                      />
                      <Input
                        aria-label="Accent hex color"
                        value={widgetAppearance.accent}
                        maxLength={7}
                        onChange={(e) => patchAnnouncementAppearance({ accent: e.target.value })}
                      />
                    </div>
                  </Field>
                  <div className="hub-config__grid announcement-customizer__fields">
                    <Field label="Corner radius" hint="6–40 px">
                      <Input
                        type="number"
                        min={6}
                        max={40}
                        value={widgetAppearance.radius}
                        onChange={(e) => patchAnnouncementAppearance({ radius: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Launcher label" hint="Text on the button">
                      <Input
                        value={widgetAppearance.button_label}
                        placeholder={launcherPlaceholder}
                        maxLength={40}
                        onChange={(e) => patchAnnouncementAppearance({ button_label: e.target.value })}
                      />
                    </Field>
                    <Field label="Position" hint="Corner the launcher sits in">
                      <Select
                        value={draft.widget_position || 'right'}
                        ariaLabel="Widget position"
                        onChange={patchWidgetPosition}
                        options={[
                          { value: 'right', label: 'Bottom right' },
                          { value: 'left', label: 'Bottom left' },
                        ]}
                      />
                    </Field>
                    <Field label="Maximum width" hint="300–560 px">
                      <Input
                        type="number"
                        min={300}
                        max={560}
                        value={widgetAppearance.max_width}
                        onChange={(e) => patchAnnouncementAppearance({ max_width: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                  <Field label="Launcher icon" hint="PNG, JPEG or GIF · up to 256 KB · any size, rendered at 48×48">
                    <div className="widget-icon">
                      <div className="widget-icon__preview">
                        {detail.widget_icon_url ? <img src={detail.widget_icon_url} alt="" /> : <Icon name="megaphone" size={18} />}
                      </div>
                      <div className="widget-icon__actions">
                        <label className="widget-icon__pick">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/gif"
                            disabled={iconBusy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) void uploadIcon(file);
                            }}
                          />
                          <span>{detail.widget_icon_url ? 'Replace image' : 'Upload image'}</span>
                        </label>
                        {detail.widget_icon_url && (
                          <button type="button" className="widget-icon__remove" disabled={iconBusy} onClick={() => void removeIcon()}>
                            Remove
                          </button>
                        )}
                        <p className="muted small">
                          {detail.widget_icon
                            ? `${detail.widget_icon.width}×${detail.widget_icon.height} ${detail.widget_icon.mime.replace('image/', '').toUpperCase()} · replaces the text label on the launcher`
                            : 'Without an icon the launcher shows the label above.'}
                        </p>
                      </div>
                    </div>
                    {iconError && <Notice tone="error">{iconError}</Notice>}
                  </Field>
                  <button
                    className="announcement-reset"
                    type="button"
                    onClick={() => patchAnnouncementAppearance({ theme: 'light', button_label: '', accent: '#2f7d4a', radius: 18, max_width: 440 })}
                  >
                    <Icon name="x" size={13} /> Reset to defaults
                  </button>
                </div>
                <WidgetPreview
                  draft={draft}
                  iconUrl={detail.widget_icon_url || undefined}
                  launcherPlaceholder={launcherPlaceholder}
                />
              </div>
            </>
          )}

          {saved && <Notice tone="success">Configuration saved — live for new visitors immediately.</Notice>}

          <div className="hub-config__save">
            <Button onClick={saveSettings} disabled={saving}>
              {saving ? 'Saving…' : 'Save configuration'}
            </Button>
          </div>
        </Card>
      )}

      {isAdmin && draft && (
        <>
          <AnnouncementSettingsModal
            open={widgetSettingsModal === 'announcements'}
            onClose={() => setWidgetSettingsModal(null)}
          />
          <FeedbackSettingsModal
            open={widgetSettingsModal === 'feedback'}
            onClose={() => setWidgetSettingsModal(null)}
            draft={draft}
            trigger={trigger}
            onPatchDraft={patchDraft}
            onPatchTrigger={patchTrigger}
            onPatchQuestion={patchQuestion}
          />
        </>
      )}

      {!isAdmin && activeTab !== 'overview' && activeTab !== 'site' && (
        <Card className="hub-config card--static">
          <h2>Manage {activeTab}</h2>
          <Notice tone="info">Only administrators can change this site's configuration.</Notice>
        </Card>
      )}

    </main>
  );
}
