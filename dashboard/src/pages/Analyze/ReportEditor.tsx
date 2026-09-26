import { useNavigate, useParams, Link } from 'react-router-dom';
import { AnalyzeEventOption, AnalyzeLogOption, AnalyzeMessageMode, AnalyzeSource, AnalyzeVisibility, AnalyzeVisualization, api, LogSeverity } from '../../api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Loading, { InlineSpinner } from '../../components/ui/Loading';
import Notice from '../../components/ui/Notice';
import { Icon } from '../../components/ui/Icon';
import { Field, Input, Select } from '../../components/ui/fields';
import { LIMITS, SOURCE_LABELS, WINDOW_OPTIONS } from './Analyze.constants';
import { fmtCount, intervalFor, intervalUnit, parseWindowKey, timezoneOptions, truncateText, windowKey, windowLabel } from './Analyze.helpers';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import { useReportDefinition } from './hooks/useReportDefinition';
import { AnimatedNumber, DailyChart, formatAverageValue, formatCountValue, RetentionNote } from './subcomponents/DailyChart';
import { Segmented } from './subcomponents/Segmented';
import { SuggestionInput } from './subcomponents/SuggestionInput';
import './Analyze.scss';

const SEVERITIES: LogSeverity[] = ['error', 'warn', 'info', 'debug'];

export default function ReportEditor() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const id = reportId ? Number(reportId) : null;
  const b = useReportDefinition(id);
  const { form, patch, errors } = b;
  const cancelTo = id ? `/analyze/${id}` : '/analyze';
  const crumbs = (
    <Breadcrumbs
      items={id
        ? [{ label: 'Analyze', to: '/analyze' }, { label: b.original?.name ?? 'Report', to: cancelTo }, { label: 'Edit' }]
        : [{ label: 'Analyze', to: '/analyze' }, { label: 'New report' }]}
    />
  );

  if (b.loadState === 'loading') {
    return <main className="page analyze-page">{crumbs}<Loading /></main>;
  }
  if (b.loadState === 'not-found') {
    return (
      <main className="page analyze-page">
        {crumbs}
        <Card className="card--static">
          <EmptyState
            icon={<Icon name="eye" size={20} />}
            title="Report not available"
            description="It may have been deleted, or it is a private report that only its owner can open."
          />
        </Card>
      </main>
    );
  }
  if (b.loadState === 'read-only' && b.original) {
    return (
      <main className="page analyze-page">
        {crumbs}
        <PageHeader title={b.original.name} />
        <Notice tone="info">
          Only {b.original.owner.username} can edit this team report. Duplicate it to make a copy of your own that you can change.
        </Notice>
        <div className="analyze-actions">
          <Button onClick={async () => {
            const copy = await api.duplicateAnalyzeReport(b.original!.id);
            navigate(`/analyze/${copy.id}/edit`);
          }}>Duplicate report</Button>
        </div>
      </main>
    );
  }

  async function save() {
    const saved = await b.save();
    if (saved) navigate(`/analyze/${saved.id}`);
  }

  const siteOptions = [{ value: 'all', label: 'All sites' }, ...b.sites.map((site) => ({ value: String(site.id), label: site.name }))];
  const siteName = form.siteId ? b.siteNames.get(form.siteId) : 'All sites';
  const zones = timezoneOptions();
  // A window saved through the API that the menu does not list stays selectable.
  const currentKey = windowKey(form.window);
  const windowOptions = WINDOW_OPTIONS.some((w) => windowKey(w) === currentKey) ? WINDOW_OPTIONS : [...WINDOW_OPTIONS, form.window];
  const previewInterval = b.preview?.interval ?? intervalFor(form.window);
  const saveHint = !b.definitionValid
    ? 'Complete the rule to preview it.'
    : b.previewing || !b.previewCurrent
      ? 'Waiting for the preview of these settings…'
      : Object.keys(errors).length > 0
        ? 'Fix the highlighted fields to save.'
        : '';

  return (
    <main className="page page--wide analyze-page">
      {crumbs}
      <PageHeader
        title={id ? 'Edit report' : 'New report'}
        subtitle="Count one action, or the logs matching a message, over time. The rule is saved, never the numbers, so the report stays current."
      />

      <div className="analyze-editor">
        <form id="analyze-editor-form" className="analyze-editor__form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
          <Card className="analyze-editor__section card--static">
            <h2>Basics</h2>
            <Field label="Name" hint={b.showError('name') ? errors.name : undefined}>
              <Input
                value={form.name}
                maxLength={LIMITS.name}
                placeholder="e.g. Checkout submit clicks"
                aria-invalid={b.showError('name') && Boolean(errors.name)}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>
            <Field label="Description (optional)" hint={errors.description}>
              <textarea
                className="field-control analyze-editor__textarea"
                rows={2}
                maxLength={LIMITS.description}
                value={form.description}
                placeholder="What should someone reading this report know?"
                onChange={(e) => patch({ description: e.target.value })}
              />
            </Field>
            <div className="analyze-editor__choice">
              <span className="field-label" id="visibility-label">Visibility</span>
              <Segmented<AnalyzeVisibility>
                ariaLabel="Visibility"
                value={form.visibility}
                onChange={(visibility) => patch({ visibility })}
                options={[{ value: 'team', label: 'Team' }, { value: 'private', label: 'Private' }]}
              />
              <span className="field-hint">
                {form.visibility === 'team'
                  ? 'Everyone signed in to TraceUX can open and duplicate it. Only you can change it.'
                  : 'Only you can see it, including in lists and search.'}
              </span>
            </div>
          </Card>

          <Card className="analyze-editor__section card--static">
            <h2>Data</h2>
            <div className="analyze-editor__row">
              <div className="analyze-editor__choice">
                <span className="field-label">Site</span>
                <Select ariaLabel="Site" value={form.siteId ? String(form.siteId) : 'all'} onChange={(v) => b.changeSite(v === 'all' ? null : Number(v))} options={siteOptions} />
              </div>
              <div className="analyze-editor__choice">
                <span className="field-label">Source</span>
                <Segmented<AnalyzeSource>
                  ariaLabel="Source"
                  value={b.pendingSource ?? form.source}
                  onChange={b.requestSource}
                  options={[{ value: 'event', label: 'Action' }, { value: 'log', label: 'Log' }]}
                />
              </div>
            </div>

            {b.pendingSource && (
              <div className="analyze-editor__confirm" role="alertdialog" aria-label="Switch source">
                <p>
                  Switch to {SOURCE_LABELS[b.pendingSource].toLowerCase()} reports? The {form.source === 'event' ? 'action and track ID' : 'message, severity, service and environment'} you entered will be cleared.
                </p>
                <div className="analyze-actions">
                  <Button size="sm" onClick={b.confirmSource}>Switch and clear</Button>
                  <Button size="sm" variant="ghost" onClick={b.cancelSource}>Keep {SOURCE_LABELS[form.source].toLowerCase()}</Button>
                </div>
              </div>
            )}

            {form.source === 'event' ? (
              <>
                <div className="analyze-editor__choice">
                  <span className="field-label">Action name</span>
                  <SuggestionInput<AnalyzeEventOption>
                    key="event-name"
                    ariaLabel="Action name"
                    value={form.eventName}
                    onChange={(eventName) => patch({ eventName })}
                    onPick={(o) => patch({ eventName: o.name, trackId: o.track_id })}
                    load={(search) => api.analyzeEventOptions(form.siteId, search).then((r) => r.events)}
                    scopeKey={String(form.siteId)}
                    optionKey={(o) => `${o.name}\u0000${o.track_id}`}
                    renderOption={(o) => (
                      <>
                        <span className="analyze-suggest__value mono">{o.name}{o.track_id && <span className="muted"> · #{o.track_id}</span>}</span>
                        <span className="analyze-suggest__count">{fmtCount(o.count)}</span>
                      </>
                    )}
                    placeholder="click"
                    invalid={b.showError('match') && Boolean(errors.match)}
                  />
                  <span className="field-hint">
                    {b.showError('match') && errors.match ? errors.match : 'Pick from actions seen in the last 30 days, or type the exact name.'}
                  </span>
                </div>
                <Field label="Track ID (optional)" hint={errors.trackId ?? 'Leave empty to count the action on every element.'}>
                  <Input value={form.trackId} maxLength={LIMITS.eventField} placeholder="checkout-submit" className="mono" onChange={(e) => patch({ trackId: e.target.value })} />
                </Field>
              </>
            ) : (
              <>
                <div className="analyze-editor__choice">
                  <div className="analyze-editor__label-row">
                    <span className="field-label">Log message</span>
                    <Segmented<AnalyzeMessageMode>
                      ariaLabel="Message match"
                      value={form.messageMode}
                      onChange={(messageMode) => patch({ messageMode })}
                      options={[{ value: 'contains', label: 'Contains' }, { value: 'exact', label: 'Exact' }]}
                    />
                  </div>
                  <SuggestionInput<AnalyzeLogOption>
                    key="log-message"
                    ariaLabel="Log message"
                    multiline
                    value={form.message}
                    onChange={(message) => patch({ message })}
                    onPick={(o) => patch({ message: o.message, severity: o.severity })}
                    // A shortened suggestion can never equal the full log, so
                    // exact mode only offers messages that fit whole.
                    load={(search) => api.analyzeLogOptions(form.siteId, search)
                      .then((r) => (form.messageMode === 'exact' ? r.logs.filter((o) => !o.truncated) : r.logs))}
                    scopeKey={`${form.siteId}:${form.messageMode}`}
                    optionKey={(o) => `${o.severity}\u0000${o.truncated ? 1 : 0}\u0000${o.message}`}
                    renderOption={(o) => (
                      <>
                        <span className="analyze-suggest__value mono" title={o.truncated ? `${o.message}…` : o.message}>
                          {truncateText(o.message, 120)}
                        </span>
                        {o.truncated && <span className="analyze-suggest__tag">Long</span>}
                        <Badge tone={o.severity === 'error' ? 'danger' : o.severity === 'warn' ? 'warn' : 'neutral'}>{o.severity}</Badge>
                        <span className="analyze-suggest__count">{fmtCount(o.count)}</span>
                      </>
                    )}
                    placeholder={form.messageMode === 'contains' ? 'payment declined' : 'CheckoutError: payment declined'}
                    invalid={b.showError('match') && Boolean(errors.match)}
                  />
                  <span className="field-hint">
                    {b.showError('match') && errors.match
                      ? errors.match
                      : form.messageMode === 'contains'
                        ? 'Counts every log whose message includes this text, ignoring case. After picking a suggestion, trim it to the part that stays the same, such as the error name.'
                        : 'The whole message must match exactly, including case.'}
                  </span>
                </div>
                <div className="analyze-editor__row analyze-editor__row--three">
                  <div className="analyze-editor__choice">
                    <span className="field-label">Severity</span>
                    <Select
                      ariaLabel="Severity"
                      value={form.severity || 'any'}
                      onChange={(v) => patch({ severity: v === 'any' ? '' : (v as LogSeverity) })}
                      options={[{ value: 'any', label: 'Any severity' }, ...SEVERITIES.map((s) => ({ value: s, label: s }))]}
                    />
                  </div>
                  <div className="analyze-editor__choice">
                    <span className="field-label">Service</span>
                    <Select
                      ariaLabel="Service"
                      value={form.serviceId ? String(form.serviceId) : 'any'}
                      onChange={(v) => patch({ serviceId: v === 'any' ? null : Number(v) })}
                      options={[
                        { value: 'any', label: 'Any service' },
                        ...(form.serviceId && !b.services.some((s) => s.id === form.serviceId)
                          ? [{ value: String(form.serviceId), label: `Service #${form.serviceId}` }] : []),
                        ...b.services.map((s) => ({ value: String(s.id), label: s.name })),
                      ]}
                    />
                  </div>
                  <div className="analyze-editor__choice">
                    <span className="field-label">Environment</span>
                    <Select
                      ariaLabel="Environment"
                      value={form.environment || 'any'}
                      onChange={(v) => patch({ environment: v === 'any' ? '' : v })}
                      options={[
                        { value: 'any', label: 'Any environment' },
                        ...[...new Set([...(form.environment ? [form.environment] : []), ...b.environments])].map((e) => ({ value: e, label: e })),
                      ]}
                    />
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card className="analyze-editor__section card--static">
            <h2>Presentation</h2>
            <div className="analyze-editor__row analyze-editor__row--three">
              <div className="analyze-editor__choice">
                <span className="field-label">Default window</span>
                <Select
                  ariaLabel="Default window"
                  value={currentKey}
                  onChange={(v) => { const window = parseWindowKey(v); if (window) patch({ window }); }}
                  options={windowOptions.map((w) => ({ value: windowKey(w), label: windowLabel(w) }))}
                />
                <span className="field-hint">
                  {intervalFor(form.window) === 'day' ? 'Drawn one bar per day.' : intervalFor(form.window) === 'hour' ? 'Drawn one bar per hour.' : 'Drawn in 5-minute bars.'}
                </span>
              </div>
              <Field label="Timezone" hint={errors.timezone ?? 'Sets where each day starts, for everyone.'}>
                <Input
                  value={form.timezone}
                  list="analyze-timezones"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.timezone)}
                  onChange={(e) => patch({ timezone: e.target.value.trim() })}
                />
                <datalist id="analyze-timezones">
                  {zones.map((zone) => <option key={zone} value={zone} />)}
                </datalist>
              </Field>
              <div className="analyze-editor__choice">
                <span className="field-label">Chart</span>
                <Segmented<AnalyzeVisualization>
                  ariaLabel="Chart type"
                  value={form.visualization}
                  onChange={(visualization) => patch({ visualization })}
                  options={[{ value: 'bar', label: 'Bars' }, { value: 'line', label: 'Line' }]}
                />
              </div>
            </div>
          </Card>

        </form>

        <aside className="analyze-editor__preview" aria-label="Preview">
          <Card className="card--static">
            <div className="analyze-section-head">
              <div>
                <span className="analyze-kicker">Preview · {windowLabel(form.window)}</span>
                <h2>{form.name.trim() || 'Untitled report'}</h2>
                <p className="muted small">{SOURCE_LABELS[form.source]} · {siteName ?? 'Site'} · {form.timezone}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={b.runPreview} disabled={!b.definitionValid || b.previewing}>
                {b.previewing ? <InlineSpinner /> : null}Refresh
              </Button>
            </div>
            {b.previewError && <Notice tone="error">{b.previewError}</Notice>}
            {!b.definitionValid ? (
              <p className="analyze-editor__placeholder muted small">
                {form.source === 'event' ? 'Choose an action' : 'Choose a log message'} to see how often it happens each day.
              </p>
            ) : !b.preview ? (
              <Loading label="Running preview…" />
            ) : (
              <div className={b.previewCurrent ? '' : 'is-stale'}>
                <div className="analyze-editor__figures">
                  <span><strong><AnimatedNumber value={b.preview.total} format={formatCountValue} /></strong><small>Total</small></span>
                  <span><strong><AnimatedNumber value={b.preview.average} format={formatAverageValue} /></strong><small>Per {intervalUnit(previewInterval)}</small></span>
                </div>
                {b.preview.warnings.map((w) => <Notice key={w.code} tone="warn">{w.message}</Notice>)}
                <DailyChart result={b.preview} visualization={form.visualization} label="Preview" compact />
                <RetentionNote result={b.preview} />
                {b.preview.total === 0 && (
                  <p className="muted small">Nothing matched in this window yet. The report can still be saved, and it will count future matches.</p>
                )}
              </div>
            )}
          </Card>
        </aside>

        <div className="analyze-editor__footer">
          {b.saveError && <Notice tone="error">{b.saveError}</Notice>}
          <div className="analyze-editor__submit">
            <Button type="submit" form="analyze-editor-form" disabled={!b.canSave}>{b.saving ? 'Saving…' : id ? 'Save changes' : 'Save report'}</Button>
            <Link to={cancelTo} className="btn btn--ghost btn--md">Cancel</Link>
            {saveHint && <span className="muted small">{saveHint}</span>}
          </div>
        </div>
      </div>
    </main>
  );
}
