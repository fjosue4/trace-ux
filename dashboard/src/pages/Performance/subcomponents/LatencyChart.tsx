import { KeyboardEvent, PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PerformanceEndpoint } from '../../../api';
import { softSpring, spring } from '../../../lib/motion';
import { chartTime, fmtLatency, fmtNumber } from '../Performance.helpers';
import { TimeRange } from '../Performance.types';

type LatencyChartProps = { endpoint: PerformanceEndpoint; range: TimeRange };
const percentiles = ['p50', 'p95', 'p99'] as const;

export function LatencyChart({ endpoint, range }: LatencyChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const points = endpoint.series;

  // Draw at the container's actual width, as Analyze does, so the SVG never
  // adds aspect-ratio gutters or clips a fixed-width plot on small screens.
  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setActive(null), [endpoint, range]);

  const height = 260;
  const pad = { top: 18, right: 24, bottom: 36, left: 52 };
  const plotWidth = Math.max(0, width - pad.left - pad.right);
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.flatMap((point) => percentiles.map((p) => point[`${p}_ms`]))) * 1.12;
  const x = (index: number) => pad.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;
  const line = (field: 'p50_ms' | 'p95_ms' | 'p99_ms') =>
    points.map((point, index) => `${x(index)},${y(point[field])}`).join(' ');
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const labelLimit = Math.max(2, Math.min(4, Math.floor(plotWidth / 110)));
  const labelIndexes = points.length <= labelLimit
    ? points.map((_, index) => index)
    : labelLimit === 2 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const xLabels = labelIndexes.map((index) => ({ index, label: chartTime(points[index].bucket_start, range) }));
  const activePoint = active !== null ? points[active] : null;
  const tooltipWidth = Math.min(224, Math.max(0, width - 16));
  const tooltipLeft = active !== null
    ? Math.min(Math.max(x(active), tooltipWidth / 2 + 8), width - tooltipWidth / 2 - 8)
    : 0;
  const activeTime = activePoint ? new Date(activePoint.bucket_start * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '';

  function indexAt(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(points.length - 1, Math.max(0, Math.round(((event.clientX - rect.left) / rect.width) * (points.length - 1))));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (points.length === 0) return;
    const current = active ?? points.length - 1;
    const next = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(points.length - 1, current + 1),
      Home: 0,
      End: points.length - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  }

  return (
    <div
      ref={wrapRef}
      className="performance-chart"
      role="group"
      aria-label={`Latency over time for ${endpoint.endpoint}. Use the left and right arrow keys to read each value.`}
      tabIndex={points.length > 0 ? 0 : undefined}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((current) => current ?? (points.length > 0 ? points.length - 1 : null))}
      onBlur={() => setActive(null)}
    >
      {points.length === 0 ? (
        <div className="performance-chart__empty">No time-series points in this range.</div>
      ) : (
        <>
          <div className="performance-chart__legend" aria-hidden>
            {percentiles.map((p) => <span key={p}><i className={`performance-line performance-line--${p}`} />{p}</span>)}
          </div>
          {width > 0 && (
            <svg className="performance-chart__svg" width={width} height={height} role="img" aria-label={`Latency over time for ${endpoint.endpoint}`}>
              {grid.map((fraction) => {
                const value = max * fraction;
                const lineY = y(value);
                return (
                  <g key={fraction}>
                    <line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} className="performance-chart__grid" />
                    <text x={pad.left - 10} y={lineY + 4} textAnchor="end" className="performance-chart__label">{fmtLatency(value)}</text>
                  </g>
                );
              })}
              {percentiles.map((p) => points.length === 1 ? (
                <circle key={p} cx={x(0)} cy={y(points[0][`${p}_ms`])} r={4} className={`performance-chart__dot performance-chart__dot--${p}`} />
              ) : (
                <polyline key={p} points={line(`${p}_ms`)} className={`performance-chart__path performance-chart__path--${p}`} />
              ))}
              {activePoint && active !== null && (
                <>
                  <motion.line
                    initial={false}
                    animate={{ x1: x(active), x2: x(active) }}
                    transition={spring}
                    y1={pad.top}
                    y2={pad.top + plotHeight}
                    className="performance-chart__crosshair"
                  />
                  {percentiles.map((p) => (
                    <motion.circle
                      key={p}
                      initial={false}
                      animate={{ cx: x(active), cy: y(activePoint[`${p}_ms`]) }}
                      transition={spring}
                      r={4.5}
                      className={`performance-chart__dot performance-chart__dot--${p}`}
                    />
                  ))}
                </>
              )}
              {xLabels.map(({ index, label }) => (
                <text key={`${index}-${label}`} x={x(index)} y={height - 10} textAnchor={points.length === 1 ? 'middle' : index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} className="performance-chart__label">{label}</text>
              ))}
              <rect
                x={pad.left}
                y={pad.top}
                width={plotWidth}
                height={plotHeight}
                className="performance-chart__hit"
                onPointerMove={(event) => setActive(indexAt(event))}
                onPointerLeave={() => setActive(null)}
              />
            </svg>
          )}
          <AnimatePresence>
            {activePoint && (
              <motion.div
                key="tooltip"
                className="performance-chart__tooltip"
                style={{ x: '-50%', width: tooltipWidth }}
                initial={{ opacity: 0, y: 4, left: tooltipLeft }}
                animate={{ opacity: 1, y: 0, left: tooltipLeft }}
                exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
                transition={softSpring}
                aria-hidden="true"
              >
                <span className="muted">{activeTime}</span>
                {percentiles.map((p) => (
                  <div key={p} className="performance-chart__tooltip-value">
                    <span><i className={`performance-line performance-line--${p}`} />{p}</span>
                    <strong>{fmtLatency(activePoint[`${p}_ms`])}</strong>
                  </div>
                ))}
                <small className="muted">{fmtNumber(activePoint.requests)} requests</small>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="visually-hidden" aria-live="polite">
            {activePoint ? `${activeTime}: ${percentiles.map((p) => `${p} ${fmtLatency(activePoint[`${p}_ms`])}`).join(', ')}, ${fmtNumber(activePoint.requests)} requests` : ''}
          </div>
        </>
      )}
    </div>
  );
}
