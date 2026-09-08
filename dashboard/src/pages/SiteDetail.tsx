import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, FeedbackTrigger, LogSeverity, SiteAppearance, SiteDetail as SiteDetailData, SiteSettings, SurveyQuestion } from '../api';
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

  const id = Number(siteId);

  const load = useCallback(() => {
    api
      .getSiteDetail(id)
      .then((d) => {
        setDetail(d);
        setDraft(d.site.settings ?? null);
      })
      .catch(() => setError('Could not load this site.'));
  }, [id]);

  useEffect(() => {
    if (id > 0) load();
  }, [id, load]);

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
        </div>

        <div className="hub-col">
          <h2>Latest feedback</h2>
          {feedback.length === 0 ? (
            <EmptyState
              title="No feedback yet"
              description="Enable the feedback widget below to start collecting responses."
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
          <Link to="/feedback" className="muted small">
            All feedback →
          </Link>
        </div>
      </div>

      {isAdmin && draft && (
        <Card className="hub-config">
          <h2>Configuration</h2>
          <p className="muted small">
            Served to the tracker automatically — the snippet never carries these settings.
          </p>

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

              <h4>Appearance</h4>
              <div className="hub-config__grid">
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
                className="icon-btn"
                title="Reset appearance to defaults"
                onClick={() => patchAppearance({
                  button_bg: '#1a1d29', button_text: '#ffffff', button_label: 'Feedback',
                  panel_bg: '#ffffff', panel_text: '#1a1d29', accent: '#f5a623',
                  primary: '#1a1d29', primary_text: '#ffffff', radius: 14, spacing: 16,
                })}
              >
                <Icon name="x" size={13} />
              </button>
              <span className="muted small"> Reset appearance</span>
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

      <SnippetCard site={site} origin={location.origin} title="Installation snippet" />
    </main>
  );
}
