import { Link } from 'react-router-dom';
import { AnalyzeReport } from '../../../api';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import { InlineSpinner } from '../../../components/ui/Loading';
import { Icon } from '../../../components/ui/Icon';
import { fmtTime } from '../../../lib/format';
import { SOURCE_LABELS } from '../Analyze.constants';
import { definitionWindow, matchSummary, windowLabel } from '../Analyze.helpers';
import { SummaryState } from '../hooks/useAnalyzeLibrary';
import { AnimatedNumber, formatCountValue, Sparkline } from './DailyChart';

type ReportCardProps = {
  report: AnalyzeReport;
  summary?: SummaryState;
  busy: boolean;
  onDuplicate: (report: AnalyzeReport) => void;
  onDelete: (report: AnalyzeReport) => void;
};

export function ReportCard({ report, summary, busy, onDuplicate, onDelete }: ReportCardProps) {
  const def = report.definition;
  return (
    <Card className="analyze-card">
      <div className="analyze-card__top">
        <span className="analyze-kicker">
          {SOURCE_LABELS[def.source]} · {report.site_name || 'All sites'}
        </span>
        <Badge tone={report.visibility === 'team' ? 'info' : 'quiet'}>{report.visibility === 'team' ? 'Team' : 'Private'}</Badge>
      </div>
      <h2 className="analyze-card__name">
        <Link to={`/analyze/${report.id}`}>{report.name}</Link>
      </h2>
      <p className="analyze-card__rule" title={def.source === 'log' ? def.match.message : undefined}>{matchSummary(def)}</p>

      <div className="analyze-card__figure">
        <div>
          <strong className="analyze-card__total">
            {summary?.status === 'ready' ? <AnimatedNumber value={summary.result.total} format={formatCountValue} /> : summary?.status === 'error' ? '—' : <InlineSpinner />}
          </strong>
          <span className="muted small">{windowLabel(definitionWindow(def))}</span>
        </div>
        {summary?.status === 'ready' && <Sparkline result={summary.result} />}
      </div>
      {summary?.status === 'error' && <p className="analyze-card__error small">{summary.message}</p>}

      <p className="analyze-card__owner muted small">
        {report.can_edit ? 'You' : report.owner.username} · Updated {fmtTime(report.updated_at)}
      </p>

      <div className="analyze-card__foot">
        <Link to={`/analyze/${report.id}`} className="btn btn--secondary btn--sm">Open</Link>
        {report.can_edit && <Link to={`/analyze/${report.id}/edit`} className="btn btn--ghost btn--sm">Edit</Link>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDuplicate(report)}>Duplicate</Button>
        {report.can_edit && (
          <button
            type="button"
            className="icon-btn analyze-card__delete"
            disabled={busy}
            onClick={() => onDelete(report)}
            aria-label={`Delete ${report.name}`}
            title="Delete report"
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    </Card>
  );
}
