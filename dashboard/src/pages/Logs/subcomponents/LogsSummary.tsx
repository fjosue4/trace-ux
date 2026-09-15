import Card from '../../../components/ui/Card';
import { rangeLabels } from '../Logs.constants';
import { TimeRange } from '../Logs.types';

type SummaryItem = { label: string; value: number; severity: string };

type LogsSummaryProps = { summary: SummaryItem[]; timeRange: TimeRange };

export function LogsSummary({ summary, timeRange }: LogsSummaryProps) {
  return (
    <Card className="logs-summary">
      <div className="logs-summary__head">
        <strong>Log volume</strong>
        <span className="muted small">{rangeLabels[timeRange]}</span>
      </div>
      <div className="logs-summary__items">
        {summary.map((item) => (
          <div key={item.label} className="logs-summary__item">
            <span className="logs-summary__label">{item.label}</span>
            <strong className={`logs-summary__num${item.severity ? ` logs-summary__num--${item.severity}` : ''}`}>
              {item.value.toLocaleString()}
            </strong>
          </div>
        ))}
      </div>
    </Card>
  );
}
