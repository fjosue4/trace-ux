import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, LogFilterOptions } from '../../api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import Loading, { InlineSpinner } from '../../components/ui/Loading';
import Notice from '../../components/ui/Notice';
import { Icon } from '../../components/ui/Icon';
import { Input, Select } from '../../components/ui/fields';
import { fmtTime } from '../../lib/format';
import { SOURCE_LABELS, WINDOW_OPTIONS } from './Analyze.constants';
import {
  bucketCount,
  definitionWindow,
  drillDownLink,
  formatSpan,
  intervalFor,
  intervalUnit,
  matchSummary,
  windowKey,
  windowLabel,
} from './Analyze.helpers';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import { RangeChoice } from './Analyze.types';
import { useReportResult } from './hooks/useReportResult';
import { AnimatedNumber, DailyChart, DailyTable, formatAverageValue, formatCountValue, RetentionNote } from './subcomponents/DailyChart';
import './Analyze.scss';

export default function ReportView() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const {
    report,
    notFound,
    result,
    loading,
    error,
    setError,
    choice,
    setChoice,
    customFrom,
    customTo,
    setCustom,
    customError,
    refresh,
  } = useReportResult(Number(reportId));
  const [services, setServices] = useState<LogFilterOptions['services']>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const def = report?.definition;
  useEffect(() => {
    if (def?.source !== 'log' || !def.match.service_id) return;
    api.logOptions(def.site_id).then((options) => setServices(options.services)).catch(() => {});
  }, [def?.source, def?.site_id, def?.match.service_id]);

  const crumbs = (current: string) => <Breadcrumbs items={[{ label: 'Analyze', to: '/analyze' }, { label: current }]} />;

  if (notFound) {
    return (
      <main className="page analyze-page">
        {crumbs('Report')}
        <Card className="card--static">
          <EmptyState
            icon={<Icon name="eye" size={20} />}
            title="Report not available"
            description="It may have been deleted, or it is a private report that only its owner can open."
            action={<Link to="/analyze" className="btn btn--primary btn--md">Back to Analyze</Link>}
          />
        </Card>
      </main>
    );
  }
  if (!report || !def) {
    return (
      <main className="page analyze-page">
        {crumbs('Report')}
        {error ? <Notice tone="error">{error}</Notice> : <Loading />}
      </main>
    );
  }

  const serviceName = services.find((s) => s.id === def.match.service_id)?.name;
  const drill = drillDownLink(def, result);
  const savedWindow = definitionWindow(def);
  const savedKey = windowKey(savedWindow);
  const rangeOptions = [
    { value: 'default', label: `${windowLabel(savedWindow)} (saved)` },
    ...WINDOW_OPTIONS.filter((w) => windowKey(w) !== savedKey).map((w) => ({ value: windowKey(w), label: windowLabel(w) })),
    { value: 'custom', label: 'Custom dates' },
  ];
  const interval = result?.interval ?? intervalFor(savedWindow);
  const unit = intervalUnit(interval);

  async function duplicate() {
    setBusy(true);
    try {
      const copy = await api.duplicateAnalyzeReport(report!.id);
      navigate(`/analyze/${copy.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate the report.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteAnalyzeReport(report!.id);
      navigate('/analyze');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the report.');
      setConfirmingDelete(false);
      setBusy(false);
    }
  }

  return (
    <main className="page analyze-page">
      {crumbs(report.name)}
      <PageHeader
        title={report.name}
        subtitle={report.description || undefined}
        actions={
          <div className="analyze-actions">
            <Button variant="secondary" size="sm" disabled={busy} onClick={duplicate}><Icon name="copy" size={13} />Duplicate</Button>
            {report.can_edit && (
              <>
                <Link to={`/analyze/${report.id}/edit`} className="btn btn--primary btn--sm">Edit</Link>
                <Button variant="dangerGhost" size="sm" disabled={busy} onClick={() => setConfirmingDelete(true)} aria-label="Delete report">
                  <Icon name="trash" size={13} />
                </Button>
              </>
            )}
          </div>
        }
      />

      <Card className="analyze-toolbar card--static">
        <dl className="analyze-facts">
          <div>
            <dt>Visibility</dt>
            <dd><Badge tone={report.visibility === 'team' ? 'info' : 'quiet'}>{report.visibility === 'team' ? 'Team' : 'Private'}</Badge></dd>
          </div>
          <div><dt>Source</dt><dd>{SOURCE_LABELS[def.source]}</dd></div>
          <div className="analyze-facts__shrink"><dt>Site</dt><dd title={report.site_name || 'All sites'}>{report.site_name || 'All sites'}</dd></div>
          <div className="analyze-facts__shrink"><dt>Owner</dt><dd title={report.owner.username}>{report.can_edit ? 'You' : report.owner.username}</dd></div>
          <div className="analyze-facts__rule">
            <dt>Matches</dt>
            <dd className="mono" title={def.source === 'log' ? def.match.message : undefined}>{matchSummary(def, serviceName)}</dd>
          </div>
        </dl>
        <div className="analyze-toolbar__range">
          <Select ariaLabel="Date range" value={choice} onChange={(value) => setChoice(value as RangeChoice)} options={rangeOptions} />
          {choice === 'custom' && (
            <div className="analyze-toolbar__dates">
              <label>
                <span className="visually-hidden">Start date</span>
                <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustom('from', e.target.value)} />
              </label>
              <span className="muted small" aria-hidden>–</span>
              <label>
                <span className="visually-hidden">End date</span>
                <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustom('to', e.target.value)} />
              </label>
            </div>
          )}
          <Button variant="secondary" onClick={refresh} disabled={loading} aria-label="Refresh results">
            {loading ? <InlineSpinner /> : null}Refresh
          </Button>
        </div>
      </Card>
      {choice !== 'default' && (
        <p className="analyze-toolbar__note muted small">
          Showing a temporary range. The saved report still opens on {windowLabel(savedWindow).toLowerCase()}.
        </p>
      )}

      {customError && <Notice tone="warn">{customError}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {result?.warnings.map((w) => <Notice key={w.code} tone="warn">{w.message}</Notice>)}

      {!result ? (
        <Loading label="Calculating…" />
      ) : (
        <>
          <div className="analyze-figures" aria-live="polite">
            <Card className="analyze-figure card--static">
              <span className="analyze-figure__label">Total occurrences</span>
              <strong className="analyze-figure__value"><AnimatedNumber value={result.total} format={formatCountValue} /></strong>
              <span className="muted small">{formatSpan(result.from, result.to, def.timezone, result.interval)} · {def.timezone}</span>
            </Card>
            <Card className="analyze-figure card--static">
              <span className="analyze-figure__label">Average per {unit}</span>
              <strong className="analyze-figure__value"><AnimatedNumber value={result.average} format={formatAverageValue} /></strong>
              <span className="muted small">Over {bucketCount(result.buckets, result.interval)}</span>
            </Card>
          </div>

          <Card className={`analyze-chart-card card--static${loading ? ' is-stale' : ''}`}>
            <div className="analyze-section-head">
              <h2>Occurrences per {unit}</h2>
              <Link to={drill.to} className="analyze-drill">{drill.label} →</Link>
            </div>
            {result.total === 0 && (
              <p className="muted small analyze-chart-card__empty">
                Nothing matched in this range. If the {def.source === 'event' ? 'action was renamed or removed' : 'message wording changed'}, edit the rule to match the new value.
              </p>
            )}
            <DailyChart result={result} visualization={def.visualization} label={report.name} />
            <RetentionNote result={result} />
          </Card>

          <div className="analyze-detail-grid">
            <Card className="analyze-rule card--static">
              <h2>Matching rule</h2>
              <dl>
                <dt>Source</dt><dd>{def.source === 'event' ? 'Tracked action' : 'Log'}</dd>
                <dt>Site</dt><dd>{report.site_name || 'All sites'}</dd>
                {def.source === 'event' ? (
                  <>
                    <dt>Action name</dt><dd className="mono">{def.match.name}</dd>
                    <dt>Track ID</dt><dd className={def.match.track_id ? 'mono' : 'muted'}>{def.match.track_id || 'Any'}</dd>
                  </>
                ) : (
                  <>
                    <dt>{def.match.message_mode === 'contains' ? 'Message contains' : 'Message is'}</dt>
                    <dd className="mono analyze-rule__message">{def.match.message}</dd>
                    <dt>Severity</dt><dd className={def.match.severity ? '' : 'muted'}>{def.match.severity || 'Any'}</dd>
                    <dt>Service</dt><dd className={def.match.service_id ? '' : 'muted'}>{def.match.service_id ? (serviceName ?? `#${def.match.service_id}`) : 'Any'}</dd>
                    <dt>Environment</dt><dd className={def.match.environment ? 'mono' : 'muted'}>{def.match.environment || 'Any'}</dd>
                  </>
                )}
                <dt>Counts</dt>
                <dd>
                  {def.source === 'log' && def.match.message_mode === 'contains'
                    ? 'Logs containing the text, ignoring case, by event time'
                    : 'Exact matches, by event time'}
                </dd>
                <dt>Saved window</dt><dd>{windowLabel(savedWindow)}</dd>
                <dt>Timezone</dt><dd>{def.timezone}</dd>
                <dt>Updated</dt><dd>{fmtTime(report.updated_at)}</dd>
              </dl>
            </Card>
            <Card className="analyze-values card--static">
              <h2>Values per {unit}</h2>
              <DailyTable result={result} />
            </Card>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this report?"
        description={report.visibility === 'team'
          ? 'This report is shared with your team. Deleting it removes it for everyone. The data it counts is not affected.'
          : 'This removes the saved report. The data it counts is not affected.'}
        confirmLabel="Delete report"
        busy={busy}
        onConfirm={remove}
        onClose={() => setConfirmingDelete(false)}
      />
    </main>
  );
}
