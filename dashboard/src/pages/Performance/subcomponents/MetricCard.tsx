import classNames from 'classnames';
import Card from '../../../components/ui/Card';

type MetricCardProps = { label: string; value: string; detail?: string; tone?: string };

export function MetricCard({ label, value, detail, tone = '' }: MetricCardProps) {
  return (
    <Card className={classNames('performance-metric', { [`performance-metric--${tone}`]: tone })}>
      <span className="performance-metric__label">{label}</span>
      <strong className="performance-metric__value">{value}</strong>
      {detail && <span className="muted small">{detail}</span>}
    </Card>
  );
}
