type SummaryItem = { label: string; value: number; severity: string };

type LogsSummaryProps = { summary: SummaryItem[] };

export function LogsSummary({ summary }: LogsSummaryProps) {
  return (
    <div className="logs-summary" aria-label="Log volume">
      {summary.map((item) => (
        <span key={item.label} className="logs-summary__item">
          <span className="logs-summary__label">{item.label}</span>
          <strong className={`logs-summary__num${item.severity ? ` logs-summary__num--${item.severity}` : ''}`}>
            {item.value.toLocaleString()}
          </strong>
        </span>
      ))}
    </div>
  );
}
