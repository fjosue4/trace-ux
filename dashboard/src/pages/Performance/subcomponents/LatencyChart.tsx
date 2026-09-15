import { PerformanceEndpoint } from '../../../api';
import { chartTime, fmtLatency } from '../Performance.helpers';
import { TimeRange } from '../Performance.types';

type LatencyChartProps = { endpoint: PerformanceEndpoint; range: TimeRange };

export function LatencyChart({ endpoint, range }: LatencyChartProps) {
  const points = endpoint.series;
  if (points.length === 0) {
    return <div className="performance-chart__empty">No time-series points in this range.</div>;
  }

  const width = 820;
  const height = 260;
  const pad = { top: 18, right: 24, bottom: 36, left: 52 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((point) => point.p99_ms)) * 1.12;
  const x = (index: number) => pad.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;
  const line = (field: 'p50_ms' | 'p95_ms' | 'p99_ms') =>
    points.map((point, index) => `${x(index)},${y(point[field])}`).join(' ');
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const xLabels = points.length <= 4
    ? points.map((point, index) => ({ index, label: chartTime(point.bucket_start, range) }))
    : [0, Math.floor((points.length - 1) / 2), points.length - 1].map((index) => ({
        index,
        label: chartTime(points[index].bucket_start, range),
      }));

  return (
    <div className="performance-chart">
      <div className="performance-chart__legend" aria-hidden>
        <span><i className="performance-line performance-line--p50" />p50</span>
        <span><i className="performance-line performance-line--p95" />p95</span>
        <span><i className="performance-line performance-line--p99" />p99</span>
      </div>
      <svg className="performance-chart__svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Latency over time for ${endpoint.endpoint}`}>
        {grid.map((fraction) => {
          const value = max * fraction;
          const lineY = y(value);
          return (
            <g key={fraction}>
              <line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} className="performance-chart__grid" />
              <text x={pad.left - 10} y={lineY + 4} textAnchor="end" className="performance-chart__label">
                {fmtLatency(value)}
              </text>
            </g>
          );
        })}
        <polyline points={line('p50_ms')} className="performance-chart__path performance-chart__path--p50" />
        <polyline points={line('p95_ms')} className="performance-chart__path performance-chart__path--p95" />
        <polyline points={line('p99_ms')} className="performance-chart__path performance-chart__path--p99" />
        {xLabels.map(({ index, label }) => (
          <text key={`${index}-${label}`} x={x(index)} y={height - 10} textAnchor="middle" className="performance-chart__label">
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
}
