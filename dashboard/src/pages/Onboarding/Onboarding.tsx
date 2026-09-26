import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { api, Session } from '../../api';
import { useUser } from '../../App';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import Switch from '../../components/ui/Switch';
import { Icon } from '../../components/ui/Icon';
import { Field, Input } from '../../components/ui/fields';
import SnippetCard from '../../components/sites/SnippetCard';
import AnnouncementSettingsModal from '../../components/sites/AnnouncementSettingsModal';
import FeedbackSettingsModal from '../../components/sites/FeedbackSettingsModal';
import UserManager from '../../components/users/UserManager';
import { useSiteDetail } from '../SiteDetail/hooks/useSiteDetail';
import { RecordingsTab } from '../SiteDetail/tabs/RecordingsTab';
import { WidgetTab } from '../SiteDetail/tabs/WidgetTab';
import { LogsTab } from '../SiteDetail/tabs/LogsTab';
import { ServicesTab } from '../SiteDetail/tabs/ServicesTab';
import { IntegrationsTab } from '../SiteDetail/tabs/IntegrationsTab';
import { fmtTime, stripProto } from '../../lib/format';
import { ONBOARDING_STEPS, OnboardingStep, StepStatus } from './Onboarding.steps';
import '../SiteDetail/SiteDetail.scss';
import './Onboarding.scss';

// Guided setup for a site, one concern per step. Every step after creating
// the site can be skipped, and each one embeds the same controls the site hub
// uses, so nothing here is a second implementation of a setting. The site and
// step live in the URL, so leaving and coming back resumes where it stopped.
export default function Onboarding() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const siteId = Number(params.get('site')) || 0;
  const first = params.get('first') === '1';
  const [statuses, setStatuses] = useState<Partial<Record<OnboardingStep, StepStatus>>>({});
  const [offerTeam, setOfferTeam] = useState(false);
  const teamChecked = useRef(false);
  const hub = useSiteDetail(siteId);
  const install = useInstallCheck(siteId, hub.detail?.site.url ?? '');

  // The team step belongs to the very first setup, and only while the admin
  // is alone. Decided once, so adding someone mid-flow does not remove it.
  useEffect(() => {
    if (!first || teamChecked.current || user.role !== 'admin') return;
    teamChecked.current = true;
    api.listUsers().then((users) => setOfferTeam(users.length <= 1)).catch(() => setOfferTeam(false));
  }, [first, user.role]);

  const steps = ONBOARDING_STEPS.filter((step) => step.id !== 'team' || offerTeam);
  const requested = params.get('step') as OnboardingStep | null;
  const current: OnboardingStep = !siteId
    ? 'site'
    : requested && requested !== 'site' && steps.some((step) => step.id === requested)
      ? requested
      : 'install';
  const index = steps.findIndex((step) => step.id === current);
  const meta = steps[index];

  function goTo(step: OnboardingStep, site = siteId) {
    const next = new URLSearchParams();
    if (site) next.set('site', String(site));
    if (first) next.set('first', '1');
    next.set('step', step);
    setParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function advance(status: StepStatus) {
    setStatuses((all) => ({ ...all, [current]: status }));
    const next = steps[index + 1];
    if (next) goTo(next.id);
  }

  // Skipping a settings step drops its unsaved edits; otherwise a later
  // step's save would quietly apply them.
  function skip() {
    if (meta.savesDraft) hub.load();
    advance('skipped');
  }

  async function saveAndContinue() {
    if (await hub.saveSettings()) advance('done');
  }

  if (user.role !== 'admin') {
    return (
      <main className="page">
        <Breadcrumbs items={[{ label: 'Sites', to: '/sites' }, { label: 'Set up a site' }]} />
        <PageHeader title="Set up a site" />
        <Notice tone="info">Only administrators can add and configure sites. Ask an admin to set one up.</Notice>
      </main>
    );
  }

  const site = hub.detail?.site;
  const title = first ? 'Set up your first site' : site ? `Set up ${site.name}` : 'Add a site';

  return (
    <main className="page onboarding">
      <Breadcrumbs
        items={site
          ? [{ label: 'Sites', to: '/sites' }, { label: site.name, to: `/sites/site/${site.id}` }, { label: 'Setup' }]
          : [{ label: 'Sites', to: '/sites' }, { label: title }]}
      />
      <PageHeader
        title={title}
        subtitle="Go step by step. Every step can be skipped and changed later from the site's page."
        actions={
          <Link to={siteId ? `/sites/site/${siteId}` : '/sites'} className="btn btn--ghost btn--sm">
            Exit setup
          </Link>
        }
      />

      <div className="onboarding__layout">
        <nav className="onboarding__rail" aria-label="Setup steps">
          <ol>
            {steps.map((step, i) => {
              const status = statuses[step.id];
              const reachable = step.id === 'site' ? !siteId : Boolean(siteId);
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    className={`onboarding__rail-step${step.id === current ? ' is-current' : ''}${status ? ` is-${status}` : ''}`}
                    onClick={() => goTo(step.id)}
                    disabled={!reachable || step.id === current}
                    aria-current={step.id === current ? 'step' : undefined}
                  >
                    <span className="onboarding__rail-mark" aria-hidden="true">
                      {status === 'done' ? (
                        <Icon name="check" size={12} />
                      ) : (
                        <span className="onboarding__rail-num">{status === 'skipped' ? '–' : i + 1}</span>
                      )}
                    </span>
                    <span className="onboarding__rail-label">
                      {step.label}
                      {status === 'skipped' && <small>Skipped</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <Card className="onboarding__card card--static">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current}
              className="onboarding__step"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <header className="onboarding__head">
                <span className="onboarding__eyebrow">
                  <Icon name={meta.icon} size={13} /> Step {index + 1} of {steps.length}
                </span>
                <h2>{meta.title}</h2>
                <p className="muted">{meta.description}</p>
              </header>

              {hub.error && current !== 'site' && <Notice tone="error">{hub.error}</Notice>}

              {current === 'site' ? (
                <CreateSiteStep
                  onCreated={(id, isFirst) => {
                    setStatuses({ site: 'done' });
                    const next = new URLSearchParams({ site: String(id), step: 'install' });
                    if (isFirst) next.set('first', '1');
                    setParams(next);
                  }}
                  onManual={(id) => navigate(`/sites/site/${id}?tab=site`)}
                  onCancel={() => navigate('/sites')}
                />
              ) : !hub.detail || !hub.draft || !site ? (
                hub.error ? null : <Loading />
              ) : (
                <>
                  <div className="onboarding__body">
                    {current === 'install' && (
                      <>
                        <SnippetCard site={site} origin={location.origin} embedded />
                        <InstallStatus check={install} siteUrl={site.url} />
                      </>
                    )}

                    {current === 'recordings' && (
                      <div className="hub-config onboarding__embed">
                        <div className="hub-config__row">
                          <Switch
                            checked={site.recording_enabled ?? true}
                            onChange={hub.toggleRecording}
                            label={(site.recording_enabled ?? true) ? 'Recording on' : 'Recording off'}
                          />
                        </div>
                        <RecordingsTab draft={hub.draft} onPatchDraft={hub.patchDraft} />
                      </div>
                    )}

                    {current === 'widget' && (
                      <div className="hub-config onboarding__embed">
                        <WidgetTab
                          id={siteId}
                          draft={hub.draft}
                          detail={hub.detail}
                          launcherPlaceholder={hub.launcherPlaceholder}
                          widgetSettingsModal={hub.widgetSettingsModal}
                          onOpenWidgetSettingsModal={hub.setWidgetSettingsModal}
                          onPatchDraft={hub.patchDraft}
                          onPatchAnnouncementAppearance={hub.patchAnnouncementAppearance}
                          onPatchWidgetPosition={hub.patchWidgetPosition}
                          onDetailChanged={hub.refreshDetail}
                        />
                        <AnnouncementSettingsModal
                          open={hub.widgetSettingsModal === 'announcements'}
                          onClose={() => hub.setWidgetSettingsModal(null)}
                        />
                        <FeedbackSettingsModal
                          open={hub.widgetSettingsModal === 'feedback'}
                          onClose={() => hub.setWidgetSettingsModal(null)}
                          draft={hub.draft}
                          trigger={hub.draft.feedback_trigger ?? { mode: 'always' }}
                          onPatchDraft={hub.patchDraft}
                          onPatchTrigger={hub.patchTrigger}
                          onPatchQuestion={hub.patchQuestion}
                        />
                      </div>
                    )}

                    {current === 'logs' && (
                      <div className="hub-config onboarding__embed">
                        <LogsTab draft={hub.draft} onPatchDraft={hub.patchDraft} />
                      </div>
                    )}

                    {current === 'services' && (
                      <ServicesTab
                        siteId={siteId}
                        isAdmin
                        legacyPerformanceKeys={hub.detail.performance_keys}
                        siteSeverities={(hub.draft.logs.severities ?? [hub.draft.logs.minimum_severity ?? 'error']).filter(Boolean)}
                      />
                    )}

                    {current === 'slack' && <IntegrationsTab siteId={siteId} isAdmin />}

                    {current === 'team' && <UserManager currentUsername={user.username} />}

                    {current === 'done' && (
                      <DoneStep
                        steps={steps.filter((step) => step.id !== 'site' && step.id !== 'done')}
                        statuses={statuses}
                        onRevisit={goTo}
                      />
                    )}
                  </div>

                  <StepFooter>
                    {current === 'done' ? (
                      <>
                        <Link to={`/sessions?site=${siteId}`} className="btn btn--secondary btn--md">
                          <Icon name="film" size={14} /> View sessions
                        </Link>
                        <Link to={`/sites/site/${siteId}`} className="btn btn--primary btn--md">
                          Open {site.name} <Icon name="play" size={12} />
                        </Link>
                      </>
                    ) : (
                      <>
                        {meta.note && <span className="muted small onboarding__note">{meta.note}</span>}
                        <Button variant="ghost" onClick={skip} disabled={hub.saving}>
                          Skip this step
                        </Button>
                        {current === 'install' && install.state.kind !== 'verified' ? (
                          <Button onClick={install.verify} disabled={install.state.kind === 'checking'}>
                            {install.state.kind === 'checking'
                              ? 'Verifying…'
                              : install.state.kind === 'idle'
                                ? 'Verify installation'
                                : 'Verify again'}
                          </Button>
                        ) : meta.savesDraft ? (
                          <Button onClick={saveAndContinue} disabled={hub.saving}>
                            {hub.saving ? 'Saving…' : 'Save and continue'}
                          </Button>
                        ) : (
                          <Button onClick={() => advance('done')}>
                            {meta.continueLabel ?? 'Continue'}
                          </Button>
                        )}
                      </>
                    )}
                  </StepFooter>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </Card>
      </div>
    </main>
  );
}

type InstallState =
  | { kind: 'idle' }
  | { kind: 'checking'; phase: 'opening' | 'waiting' }
  | { kind: 'verified'; count: number; latest: Session | null }
  | { kind: 'missing' }
  | { kind: 'blocked'; url: string }
  | { kind: 'error'; message: string };

// The verification window stays open long enough for the tracker's first
// 5-second flush; closing it then fires the tracker's pagehide beacon, and the
// check keeps polling briefly for that last batch before giving up.
const VERIFY_WINDOW_MS = 6500;
const VERIFY_GIVE_UP_MS = 11000;
const VERIFY_POLL_MS = 1000;

/** The site URL with a marker, so the verification visit is recognisable in
 *  the site's own sessions. */
function verificationUrl(siteUrl: string) {
  try {
    const url = new URL(siteUrl);
    url.searchParams.set('traceux_verify', '1');
    return url.toString();
  } catch {
    return siteUrl;
  }
}

/** A small window near the top right of the dashboard, like other analytics
 *  tools use to verify a snippet. Must be called directly from the click, or
 *  the browser treats it as an unrequested pop-up. It starts blank and is cut
 *  off from this page before loading the site, so the site cannot reach back
 *  into the dashboard through window.opener. */
function openVerificationWindow(url: string): Window | null {
  const width = 440;
  const height = 340;
  const left = Math.max(0, window.screenX + window.outerWidth - width - 40);
  const top = Math.max(0, window.screenY + 80);
  const popup = window.open('about:blank', 'traceux-verify', `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) return null;
  popup.opener = null;
  popup.location.href = url;
  return popup;
}

/** Whether the tracker is live on the site. Ingest only accepts events from
 *  the site's registered origin, and the first accepted batch creates a
 *  session, so any session for the site proves the snippet is installed on
 *  the right origin and sending. Verifying opens the site itself in a small
 *  window, waits for that visit's events, and closes the window. */
function useInstallCheck(siteId: number, siteUrl: string) {
  const [state, setState] = useState<InstallState>({ kind: 'idle' });
  const popup = useRef<Window | null>(null);
  const timer = useRef<number | undefined>(undefined);

  function closePopup() {
    try {
      popup.current?.close();
    } catch {
      // Already closed by the visitor.
    }
    popup.current = null;
  }

  async function sessionsNow() {
    const detail = await api.getSiteDetail(siteId);
    return { count: detail.site.session_count, latest: detail.sessions[0] ?? null };
  }

  function verify() {
    if (!siteId || !siteUrl) return;
    window.clearTimeout(timer.current);
    closePopup();
    const url = verificationUrl(siteUrl);
    const opened = openVerificationWindow(url);
    if (!opened) {
      setState({ kind: 'blocked', url });
      return;
    }
    popup.current = opened;
    setState({ kind: 'checking', phase: 'opening' });
    const started = Date.now();

    const poll = async () => {
      const elapsed = Date.now() - started;
      try {
        const { count, latest } = await sessionsNow();
        if (count > 0) {
          closePopup();
          setState({ kind: 'verified', count, latest });
          return;
        }
      } catch (e) {
        closePopup();
        setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not check the installation.' });
        return;
      }
      if (elapsed >= VERIFY_WINDOW_MS) closePopup();
      if (elapsed >= VERIFY_GIVE_UP_MS) {
        setState({ kind: 'missing' });
        return;
      }
      setState({ kind: 'checking', phase: 'waiting' });
      timer.current = window.setTimeout(poll, VERIFY_POLL_MS);
    };
    timer.current = window.setTimeout(poll, VERIFY_POLL_MS * 1.5);
  }

  // A site that is already sending (resumed setup, or installed before
  // opening this step) shows as verified without a click.
  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    sessionsNow()
      .then(({ count, latest }) => {
        if (!cancelled && count > 0) setState({ kind: 'verified', count, latest });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // sessionsNow only reads siteId, which is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // Leaving the step mid-check must not leave the window or the poll behind.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    closePopup();
  }, []);

  return { state, verify };
}

function InstallStatus({ check, siteUrl }: { check: ReturnType<typeof useInstallCheck>; siteUrl: string }) {
  const { state } = check;
  if (state.kind === 'verified') {
    const latest = state.latest;
    return (
      <Notice tone="success">
        <strong>Installation verified.</strong> {state.count.toLocaleString()} {state.count === 1 ? 'session' : 'sessions'} received
        {latest && (
          <>
            {' '}· latest on <code>{stripProto(latest.initial_url || siteUrl)}</code>
            {latest.browser && ` in ${latest.browser}`}, {fmtTime(latest.last_seen)}
          </>
        )}
        .
      </Notice>
    );
  }
  if (state.kind === 'checking') {
    return (
      <p className="muted small onboarding__install-hint onboarding__install-hint--live">
        <span className="onboarding__spinner" aria-hidden="true" />
        {state.phase === 'opening'
          ? `Opening ${stripProto(siteUrl)} in a small window…`
          : 'Waiting for its first events. The window closes by itself in a few seconds.'}
      </p>
    );
  }
  if (state.kind === 'missing') {
    return (
      <Notice tone="warn">
        <strong>No events from {stripProto(siteUrl)} yet.</strong> The verification window loaded the site but
        TraceUX received nothing. Check that the snippet is on that page, that it is served from exactly{' '}
        <code>{siteUrl}</code>, and that no ad or tracker blocker stopped it, then verify again.
      </Notice>
    );
  }
  if (state.kind === 'blocked') {
    return (
      <Notice tone="warn">
        <strong>Your browser blocked the verification window.</strong> Allow pop-ups for this dashboard and verify
        again, or{' '}
        <a href={state.url} target="_blank" rel="noopener noreferrer">open {stripProto(siteUrl)} yourself</a>, then
        verify again.
      </Notice>
    );
  }
  if (state.kind === 'error') return <Notice tone="error">{state.message}</Notice>;
  return (
    <p className="muted small onboarding__install-hint">
      Verify installation opens {stripProto(siteUrl)} in a small window for a few seconds and closes it once
      TraceUX receives its first events.
    </p>
  );
}

function StepFooter({ children }: { children: ReactNode }) {
  return <footer className="onboarding__footer">{children}</footer>;
}

/** Step 1. Creating the site is the one step that cannot be skipped, but the
 *  rest of the guide can: "set up later" creates it and opens its page. */
function CreateSiteStep({
  onCreated,
  onManual,
  onCancel,
}: {
  onCreated: (id: number, first: boolean) => void;
  onManual: (id: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<'guided' | 'manual' | null>(null);

  async function create(mode: 'guided' | 'manual', event?: FormEvent) {
    event?.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setSaving(mode);
    setError('');
    try {
      // Checked before creating: this decides whether the team step is offered.
      const isFirst = (await api.listSites()).length === 0;
      const site = await api.createSite(name.trim(), url.trim());
      if (mode === 'manual') onManual(site.id);
      else onCreated(site.id, isFirst);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the site.');
      setSaving(null);
    }
  }

  const ready = Boolean(name.trim() && url.trim());

  return (
    <form className="onboarding__create" onSubmit={(event) => create('guided', event)}>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="onboarding__create-fields">
        <Field label="Site name">
          <Input placeholder="Acme Shop" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Website URL" hint="The exact origin where the snippet will run, including https://. Recordings are only accepted from it.">
          <Input placeholder="https://your-site.com" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        </Field>
      </div>
      <StepFooter>
        <Button variant="ghost" type="button" onClick={onCancel} disabled={saving !== null}>
          Cancel
        </Button>
        <Button variant="secondary" type="button" onClick={() => create('manual')} disabled={!ready || saving !== null}>
          {saving === 'manual' ? 'Creating…' : 'Create and set up later'}
        </Button>
        <Button type="submit" disabled={!ready || saving !== null}>
          {saving === 'guided' ? 'Creating…' : 'Create and continue'}
        </Button>
      </StepFooter>
    </form>
  );
}

/** Summary: what was configured, what was skipped, and a way back to either. */
function DoneStep({
  steps,
  statuses,
  onRevisit,
}: {
  steps: typeof ONBOARDING_STEPS;
  statuses: Partial<Record<OnboardingStep, StepStatus>>;
  onRevisit: (step: OnboardingStep) => void;
}) {
  return (
    <ul className="onboarding__summary">
      {steps.map((step) => {
        const status = statuses[step.id];
        return (
          <li key={step.id} className={status ? `is-${status}` : undefined}>
            <span className="onboarding__summary-mark" aria-hidden="true">
              {status === 'done' ? <Icon name="check" size={12} /> : <Icon name={step.icon} size={12} />}
            </span>
            <span className="onboarding__summary-label">
              <strong>{step.label}</strong>
              <small>{status === 'done' ? 'Configured' : status === 'skipped' ? 'Skipped' : 'Not visited'}</small>
            </span>
            <Button variant="ghost" size="sm" onClick={() => onRevisit(step.id)}>
              {status === 'done' ? 'Review' : 'Set up'}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
