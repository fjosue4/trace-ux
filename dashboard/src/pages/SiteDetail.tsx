import { CSSProperties, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnnouncementAppearance, api, FeedbackTrigger, Log, LogSeverity, PerformanceKey, SiteAppearance, SiteDetail as SiteDetailData, SiteSettings, SurveyQuestion } from '../api';
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
import './SiteDetail.css';

type SiteTab = 'overview' | 'site' | 'recordings' | 'feedback' | 'announcements' | 'styles' | 'logs';

const siteTabs: { id: SiteTab; label: string; icon: 'activity' | 'settings' | 'film' | 'message' | 'megaphone' | 'code' }[] = [
  { id: 'overview', label: 'Overview', icon: 'activity' },
  { id: 'site', label: 'Site', icon: 'settings' },
  { id: 'recordings', label: 'Recordings', icon: 'film' },
  { id: 'feedback', label: 'Feedback', icon: 'message' },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone' },
  { id: 'styles', label: 'Styles', icon: 'settings' },
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

  const id = Number(siteId);

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
  }, [id]);

  async function toggleRecording(enabled: boolean) {
    try {
      await api.updateSiteRecording(id, enabled);
      load();
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
      load();
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

  function patchAppearance(patch: Partial<SiteAppearance>) {
    setDraft((d) => (d ? { ...d, appearance: { ...d.appearance, ...patch } } : d));
  }

  function patchAnnouncementAppearance(patch: Partial<AnnouncementAppearance>) {
    setDraft((d) => (d ? { ...d, updates_appearance: { ...d.updates_appearance, ...patch } } : d));
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
          but the feedback widget keeps working.
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
              description="Enable the feedback widget in the Feedback tab to start collecting responses."
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

          {activeTab === 'announcements' && (
            <>
              <div className="hub-config__title">Announcements widget</div>
              <div className="hub-config__row"><Switch checked={draft.updates_enabled ?? true} onChange={(v) => patchDraft({ updates_enabled: v })} label="Show announcements widget" /></div>
              <div className="hub-config__grid">
                <Field label="Widget position"><Select value={draft.updates_position || 'right'} onChange={(v) => patchDraft({ updates_position: v })} options={[{value:'right',label:'Bottom right'},{value:'left',label:'Bottom left'}]} /></Field>
                <Field label="Button label"><Input value={draft.updates_appearance?.button_label ?? 'Announcements'} maxLength={40} onChange={(e) => patchAnnouncementAppearance({button_label:e.target.value})}/></Field>
                <Field label="Maximum width" hint="300–560 px"><Input type="number" min={300} max={560} value={draft.updates_appearance?.max_width ?? 440} onChange={(e)=>patchAnnouncementAppearance({max_width:Number(e.target.value)})}/></Field>
              </div>
              <Notice tone="info">Theme, accent, and shape are shared with Feedback. Manage them in the Styles tab.</Notice>
            </>
          )}

          {activeTab === 'styles' && (
            <>
              <div className="hub-config__title">Shared widget styles</div>
                <div className="announcement-customizer">
                  <div className="announcement-customizer__controls">
                    <h3>Choose a look</h3><p className="muted small">Theme colors are paired automatically for accessible contrast.</p>
                    <Field label="Theme"><div className="announcement-themes">{(['light','dark'] as const).map(theme=><button key={theme} type="button" className={`announcement-theme${(draft.updates_appearance?.theme||'light')===theme?' is-selected':''}`} onClick={()=>patchAnnouncementAppearance({theme})}><span className={`announcement-theme__sample is-${theme}`}><i/><i/></span><strong>{theme[0].toUpperCase()+theme.slice(1)}</strong></button>)}</div></Field>
                    <Field label="Accent color"><div className="announcement-swatches">{announcementAccents.map(color=><button type="button" key={color} aria-label={`Use ${color}`} title={color} className={(draft.updates_appearance?.accent||'#2f7d4a')===color?'is-selected':''} style={{background:color}} onClick={()=>patchAnnouncementAppearance({accent:color})}/>)}</div><div className="announcement-custom-color"><input type="color" aria-label="Custom accent color" value={draft.updates_appearance?.accent||'#2f7d4a'} onChange={(e)=>patchAnnouncementAppearance({accent:e.target.value})}/><Input aria-label="Accent hex color" value={draft.updates_appearance?.accent||'#2f7d4a'} maxLength={7} onChange={(e)=>patchAnnouncementAppearance({accent:e.target.value})}/></div></Field>
                    <div className="hub-config__grid announcement-customizer__fields">
                      <Field label="Corner radius" hint="6–40 px"><Input type="number" min={6} max={40} value={draft.updates_appearance?.radius ?? 18} onChange={(e)=>patchAnnouncementAppearance({radius:Number(e.target.value)})}/></Field>
                    </div>
                    <button className="announcement-reset" type="button" onClick={()=>patchAnnouncementAppearance({theme:'light',button_label:'Announcements',accent:'#2f7d4a',radius:18,max_width:440})}><Icon name="x" size={13}/> Reset to defaults</button>
                  </div>
                  <div className={`announcement-live-preview is-${draft.updates_appearance?.theme||'light'}`} style={{'--preview-accent':draft.updates_appearance?.accent||'#2f7d4a','--preview-radius':`${draft.updates_appearance?.radius??18}px`} as CSSProperties}>
                    <div className="announcement-live-preview__label">Live preview</div><div className="announcement-live-preview__panel"><header><strong>Announcements</strong><button type="button" aria-label="Close"><Icon name="x" size={14}/></button></header><main><span>NEW RELEASE</span><h3>Everything you need, closer at hand</h3><p>We refreshed the workspace with faster navigation and a clearer way to discover what’s new.</p><div><button type="button"><svg aria-hidden viewBox="0 0 1024 1024"><path d="M923 283.6a260 260 0 0 0-56.9-82.8 264.4 264.4 0 0 0-84-55.5A265.3 265.3 0 0 0 679.7 125c-49.3 0-97.4 13.5-139.2 39q-15 9.15-28.5 20.1-13.5-10.95-28.5-20.1c-41.8-25.5-89.9-39-139.2-39-35.5 0-69.9 6.8-102.4 20.3-31.4 13-59.7 31.7-84 55.5a258.4 258.4 0 0 0-56.9 82.8c-13.9 32.3-21 66.6-21 101.9 0 33.3 6.8 68 20.3 103.3 11.3 29.5 27.5 60.1 48.2 91 32.8 48.9 77.9 99.9 133.9 151.6 92.8 85.7 184.7 144.9 188.6 147.3l23.7 15.2c10.5 6.7 24 6.7 34.5 0l23.7-15.2c3.9-2.5 95.7-61.6 188.6-147.3 56-51.7 101.1-102.7 133.9-151.6 20.7-30.9 37-61.5 48.2-91 13.5-35.3 20.3-70 20.3-103.3.1-35.3-7-68.6-20.9-101.9M512 814.8S156 586.7 156 385.5C156 283.6 240.3 201 344.3 201c73.1 0 136.5 40.8 167.7 100.4C543.2 241.8 606.6 201 679.7 201c104 0 188.3 82.6 188.3 184.5 0 201.2-356 429.3-356 429.3" fill="currentColor"/></svg> Like · 12</button></div></main></div><div className="announcement-live-preview__launcher">{draft.updates_appearance?.button_label||'Announcements'} <b>1</b></div>
                  </div>
                </div>
            </>
          )}

          {activeTab === 'feedback' && (
            <>
          <div className="hub-config__title">Feedback widget</div>
          <div className="hub-config__row">
            <Switch
              checked={draft.feedback_enabled}
              onChange={(v) => patchDraft({ feedback_enabled: v })}
              label="Feedback widget"
            />
          </div>

          {draft.feedback_enabled && (
            <>
              <div className="hub-config__grid">
                <Field label="Widget position">
                  <Select
                    value={draft.feedback_position}
                    onChange={(v) => patchDraft({ feedback_position: v })}
                    options={[
                      { value: 'right', label: 'Bottom right' },
                      { value: 'left', label: 'Bottom left' },
                    ]}
                  />
                </Field>
                <Field label="Survey id" hint="Groups responses together">
                  <Input value={draft.survey_id} onChange={(e) => patchDraft({ survey_id: e.target.value })} />
                </Field>
                <Field label="Survey title">
                  <Input
                    value={draft.survey_title}
                    onChange={(e) => patchDraft({ survey_title: e.target.value })}
                  />
                </Field>
                <Field label="Question set">
                  <Select
                    value={draft.survey_type}
                    onChange={(v) => patchDraft({ survey_type: v })}
                    options={[
                      { value: 'stars', label: 'Stars (1–5) + comment' },
                      { value: 'nps', label: 'NPS (0–10) + comment' },
                      { value: 'custom', label: 'Custom questions' },
                    ]}
                  />
                </Field>
                <Field label="Show widget">
                  <Select
                    value={trigger.mode}
                    onChange={(v) => patchTrigger({ mode: v as FeedbackTrigger['mode'] })}
                    options={[
                      { value: 'always', label: 'Always' },
                      { value: 'page', label: 'On specific pages' },
                      { value: 'action', label: 'After a tracked action' },
                    ]}
                  />
                </Field>
              </div>

              {trigger.mode === 'page' && (
                <Field
                  label="Page patterns"
                  hint="Comma separated, * wildcards — e.g. /checkout*, /pricing. The widget appears only on matching pages."
                >
                  <Input
                    value={(trigger.pages ?? []).join(', ')}
                    onChange={(e) =>
                      patchTrigger({ pages: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                    }
                  />
                </Field>
              )}
              {trigger.mode === 'action' && (
                <Field
                  label="Tracked actions"
                  hint="Comma separated trace-ux-track-id names — the widget opens when the visitor clicks one."
                >
                  <Input
                    value={(trigger.actions ?? []).join(', ')}
                    onChange={(e) =>
                      patchTrigger({ actions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                    }
                  />
                </Field>
              )}

              {draft.survey_type === 'custom' && (
                <div className="hub-questions">
                  {(draft.questions ?? []).map((q, i) => (
                    <div key={i} className="hub-question">
                      <Input
                        placeholder="Question text"
                        value={q.label}
                        onChange={(e) => patchQuestion(i, { label: e.target.value })}
                      />
                      <Select
                        value={q.type}
                        onChange={(v) =>
                          patchQuestion(i, {
                            type: v as SurveyQuestion['type'],
                            max: v === 'rating' ? 5 : undefined,
                            options: v === 'choice' ? ['Yes', 'No'] : undefined,
                          })
                        }
                        options={[
                          { value: 'rating', label: 'Rating' },
                          { value: 'choice', label: 'Choice' },
                          { value: 'text', label: 'Text' },
                        ]}
                      />
                      {q.type === 'rating' && (
                        <Select
                          value={String(q.max || 5)}
                          onChange={(v) => patchQuestion(i, { max: Number(v) })}
                          options={[
                            { value: '5', label: '1–5 stars' },
                            { value: '10', label: '0–10 NPS' },
                          ]}
                        />
                      )}
                      {q.type === 'choice' && (
                        <Input
                          placeholder="Options, comma separated"
                          value={(q.options ?? []).join(', ')}
                          onChange={(e) =>
                            patchQuestion(i, {
                              options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean),
                            })
                          }
                        />
                      )}
                      <label className="hub-question__optional">
                        <input
                          type="checkbox"
                          checked={!!q.optional}
                          onChange={(e) => patchQuestion(i, { optional: e.target.checked })}
                        />
                        Optional
                      </label>
                      <button
                        className="icon-btn"
                        title="Remove question"
                        aria-label="Remove question"
                        onClick={() =>
                          patchDraft({ questions: (draft.questions ?? []).filter((_, qi) => qi !== i) })
                        }
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      patchDraft({
                        questions: [
                          ...(draft.questions ?? []),
                          { id: `q${(draft.questions?.length ?? 0) + 1}`, label: '', type: 'rating', max: 5 },
                        ],
                      })
                    }
                  >
                    <Icon name="plus" size={13} />
                    Add question
                  </Button>
                </div>
              )}

              <h4>Shared appearance</h4>
              <Notice tone="info">Theme, accent, and shape are shared with Announcements. Manage them in the Styles tab.</Notice>
              <div className="hub-config__grid feedback-legacy-appearance">
                <Field label="Button label">
                  <Input
                    value={draft.appearance?.button_label ?? 'Feedback'}
                    maxLength={40}
                    onChange={(e) => patchAppearance({ button_label: e.target.value })}
                  />
                </Field>
                <Field label="Button color">
                  <input
                    type="color"
                    className="color-input"
                    value={draft.appearance?.button_bg || '#1a1d29'}
                    onChange={(e) => patchAppearance({ button_bg: e.target.value })}
                  />
                </Field>
                <Field label="Button text">
                  <input
                    type="color"
                    className="color-input"
                    value={draft.appearance?.button_text || '#ffffff'}
                    onChange={(e) => patchAppearance({ button_text: e.target.value })}
                  />
                </Field>
                <Field label="Panel color">
                  <input
                    type="color"
                    className="color-input"
                    value={draft.appearance?.panel_bg || '#ffffff'}
                    onChange={(e) => patchAppearance({ panel_bg: e.target.value })}
                  />
                </Field>
                <Field label="Panel text">
                  <input
                    type="color"
                    className="color-input"
                    value={draft.appearance?.panel_text || '#1a1d29'}
                    onChange={(e) => patchAppearance({ panel_text: e.target.value })}
                  />
                </Field>
                <Field label="Accent (stars)">
                  <input
                    type="color"
                    className="color-input"
                    value={draft.appearance?.accent || '#f5a623'}
                    onChange={(e) => patchAppearance({ accent: e.target.value })}
                  />
                </Field>
                <Field label="Submit button">
                  <input
                    type="color"
                    className="color-input"
                    value={draft.appearance?.primary || '#1a1d29'}
                    onChange={(e) => patchAppearance({ primary: e.target.value })}
                  />
                </Field>
                <Field label="Corner radius" hint="0–40 px">
                  <Input
                    type="number"
                    min={0}
                    max={40}
                    value={draft.appearance?.radius ?? 14}
                    onChange={(e) => patchAppearance({ radius: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Spacing" hint="6–48 px">
                  <Input
                    type="number"
                    min={6}
                    max={48}
                    value={draft.appearance?.spacing ?? 16}
                    onChange={(e) => patchAppearance({ spacing: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <button
                className="icon-btn feedback-legacy-appearance"
                title="Reset appearance to defaults"
                onClick={() => patchAppearance({
                  button_bg: '#1a1d29', button_text: '#ffffff', button_label: 'Feedback',
                  panel_bg: '#ffffff', panel_text: '#1a1d29', accent: '#f5a623',
                  primary: '#1a1d29', primary_text: '#ffffff', radius: 14, spacing: 16,
                })}
              >
                <Icon name="x" size={13} />
              </button>
              <span className="muted small feedback-legacy-appearance"> Reset appearance</span>
            </>
          )}

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

      {!isAdmin && activeTab !== 'overview' && activeTab !== 'site' && (
        <Card className="hub-config card--static">
          <h2>Manage {activeTab}</h2>
          <Notice tone="info">Only administrators can change this site's configuration.</Notice>
        </Card>
      )}

    </main>
  );
}
