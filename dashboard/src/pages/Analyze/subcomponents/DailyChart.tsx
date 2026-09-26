import { KeyboardEvent, PointerEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { animate, AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AnalyzeResult, AnalyzeVisualization } from '../../../api';
import Table from '../../../components/ui/Table';
import { chartTween, softSpring, spring } from '../../../lib/motion';
import { bucketCount, fmtAverage, fmtCount, formatBucket, formatDateTime, intervalUnit } from '../Analyze.helpers';

type DailyChartProps = {
  result: AnalyzeResult;
  visualization: AnalyzeVisualization;
  /** What is being counted, for the accessible name. */
  label: string;
  compact?: boolean;
};

// Width follows the container, so the chart is drawn at its real size rather
// than scaled from a fixed viewBox: strokes, bar caps and labels stay crisp.
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round the axis up to 1, 2 or 5 × 10ⁿ so ticks land on clean integers. */
function niceScale(max: number, ticks: number) {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw);
  return { top: step * ticks, step };
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

// A column with a 4px rounded data end and a square foot on the baseline. The
// command sequence never varies -- a zero-height bar just has a zero radius --
// so Motion can interpolate any bar into any other.
function barPath(x: number, y: number, w: number, base: number): string {
  const r = Math.min(4, w / 2, base - y);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

function linePath(coords: [number, number][]): string {
  return coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join('');
}

export function DailyChart({ result, visualization, label, compact = false }: DailyChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const hatchId = useId().replace(/:/g, '');
  const points = result.series;
  const zone = result.timezone;
  const interval = result.interval;
  const n = points.length;
  // A different set of days (new range) draws in fresh; the same days with new
  // counts (refresh, filter, resize) morph from where they were.
  const seriesKey = `${n}:${points[0]?.bucket_start ?? 0}`;

  useEffect(() => setActive((current) => (current !== null && current >= n ? null : current)), [n]);

  const height = compact ? 170 : 260;
  const maxCount = Math.max(0, ...points.map((p) => p.count));
  const { top, step } = niceScale(maxCount, compact ? 3 : 4);
  const tickValues = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelChars = Math.max(...tickValues.map((v) => compactNumber(v).length));
  const pad = { top: 14, right: 10, bottom: 26, left: Math.max(26, labelChars * 7 + 12) };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const band = n > 0 ? plotW / n : 0;
  const base = pad.top + plotH;
  const y = (value: number) => pad.top + plotH - (value / top) * plotH;
  const cx = (i: number) => pad.left + band * i + band / 2;
  // Capped at 24px; below that a 2px surface gap separates neighbours until
  // the bands are too thin to afford one.
  const barW = band >= 4 ? Math.min(24, band - 2) : Math.max(1, band * 0.8);
  // Keep the whole entrance under ~0.35s however many days there are.
  const barDelay = (i: number) => Math.min(i * 0.012, 0.35 * (i / Math.max(1, n)));

  const firstComplete = points.findIndex((p) => !p.incomplete);
  const shadedBands = firstComplete === -1 ? n : firstComplete;

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 74))));
  const xLabels = points
    .map((p, i) => ({ i, text: formatBucket(p.bucket_start, zone, interval) }))
    .filter(({ i }) => i % labelEvery === 0);

  function indexAt(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const i = Math.floor(((event.clientX - rect.left) / rect.width) * n);
    return Math.min(n - 1, Math.max(0, i));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (n === 0) return;
    const current = active ?? n - 1;
    const next = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(n - 1, current + 1),
      Home: 0,
      End: n - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  }

  const activePoint = active !== null ? points[active] : null;
  const describe = (i: number) => {
    const p = points[i];
    return `${formatBucket(p.bucket_start, zone, interval, 'long')}: ${fmtCount(p.count)} ${p.count === 1 ? 'occurrence' : 'occurrences'}${p.incomplete ? ', may be incomplete because of retention' : ''}`;
  };

  const coords = points.map((p, i) => [cx(i), y(p.count)] as [number, number]);
  const line = linePath(coords);
  const area = n > 0 ? `${line}L${cx(n - 1)},${base}L${cx(0)},${base}Z` : '';
  const flatArea = n > 0 ? `${linePath(coords.map(([x]) => [x, base]))}L${cx(n - 1)},${base}L${cx(0)},${base}Z` : '';
  const tooltipLeft = active !== null ? Math.min(Math.max(cx(active), 90), Math.max(90, width - 90)) : 0;

  return (
    <div
      ref={wrapRef}
      className={`analyze-chart${compact ? ' analyze-chart--compact' : ''}`}
      role="group"
      aria-label={`${label}: occurrences per ${intervalUnit(interval)}, ${bucketCount(n, interval)}. Use the left and right arrow keys to read each value.`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((current) => current ?? (n > 0 ? n - 1 : null))}
      onBlur={() => setActive(null)}
    >
      {width > 0 && n > 0 && (
        <svg className="analyze-chart__svg" width={width} height={height} aria-hidden="true">
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="analyze-chart__hatch" />
            </pattern>
          </defs>

          <AnimatePresence>
            {shadedBands > 0 && (
              <motion.g key="retention" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={chartTween}>
                <motion.rect
                  x={pad.left}
                  y={pad.top}
                  height={plotH}
                  initial={{ width: 0 }}
                  animate={{ width: band * shadedBands }}
                  transition={chartTween}
                  fill={`url(#${hatchId})`}
                  className="analyze-chart__retention"
                />
                {band * shadedBands > 110 && !compact && (
                  <text x={pad.left + 8} y={pad.top + 14} className="analyze-chart__note">Before retention</text>
                )}
              </motion.g>
            )}
          </AnimatePresence>

          {/* Gridlines ride to their new height when the scale changes; ticks
              that appear or disappear fade rather than pop. */}
          <AnimatePresence initial={false}>
            {tickValues.map((value) => (
              <motion.g
                key={value}
                initial={{ opacity: 0, y: y(value) }}
                animate={{ opacity: 1, y: y(value) }}
                exit={{ opacity: 0 }}
                transition={chartTween}
              >
                <line x1={pad.left} x2={width - pad.right} y1={0} y2={0} className="analyze-chart__grid" />
                <text x={pad.left - 8} y={3.5} textAnchor="end" className="analyze-chart__label">{compactNumber(value)}</text>
              </motion.g>
            ))}
          </AnimatePresence>

          {visualization === 'bar' ? (
            <g key={`bars-${seriesKey}`}>
              {points.map((p, i) => {
                const x = cx(i) - barW / 2;
                return (
                  <motion.path
                    key={p.bucket_start}
                    initial={{ d: barPath(x, base, barW, base) }}
                    animate={{ d: barPath(x, y(p.count), barW, base) }}
                    transition={{ ...chartTween, delay: barDelay(i) }}
                    className={`analyze-chart__bar${p.incomplete ? ' is-incomplete' : ''}${i === active ? ' is-active' : ''}`}
                  />
                );
              })}
            </g>
          ) : (
            <g key={`line-${seriesKey}`}>
              <motion.path
                initial={{ d: flatArea, opacity: 0 }}
                animate={{ d: area, opacity: 1 }}
                transition={chartTween}
                className="analyze-chart__area"
              />
              {n > 1 ? (
                <motion.path
                  initial={{ d: line, pathLength: 0 }}
                  animate={{ d: line, pathLength: 1 }}
                  transition={{ d: chartTween, pathLength: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } }}
                  className="analyze-chart__line"
                />
              ) : (
                <motion.circle
                  cx={cx(0)}
                  initial={{ cy: base }}
                  animate={{ cy: y(points[0].count) }}
                  transition={chartTween}
                  r={4}
                  className="analyze-chart__dot"
                />
              )}
            </g>
          )}

          {visualization === 'line' && active !== null && (
            <>
              <motion.line
                initial={false}
                animate={{ x1: cx(active), x2: cx(active) }}
                transition={spring}
                y1={pad.top}
                y2={base}
                className="analyze-chart__crosshair"
              />
              <motion.circle
                initial={false}
                animate={{ cx: cx(active), cy: y(points[active].count) }}
                transition={spring}
                r={4.5}
                className="analyze-chart__dot"
              />
            </>
          )}

          <line x1={pad.left} x2={width - pad.right} y1={base} y2={base} className="analyze-chart__axis" />
          {xLabels.map(({ i, text }) => (
            <text key={`${seriesKey}-${i}`} x={cx(i)} y={height - 8} textAnchor="middle" className="analyze-chart__label">{text}</text>
          ))}

          {/* One hit target per bucket, the full column band -- bigger than the mark. */}
          <rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={plotH}
            className="analyze-chart__hit"
            onPointerMove={(event) => setActive(indexAt(event))}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}

      <AnimatePresence>
        {activePoint && (
          <motion.div
            key="tooltip"
            className="analyze-chart__tooltip"
            style={{ x: '-50%' }}
            initial={{ opacity: 0, y: 4, left: tooltipLeft }}
            animate={{ opacity: 1, y: 0, left: tooltipLeft }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
            transition={softSpring}
            aria-hidden="true"
          >
            <span>{formatBucket(activePoint.bucket_start, zone, interval, 'long')}</span>
            <strong>{fmtCount(activePoint.count)}</strong>
            {activePoint.incomplete && <small>May be incomplete (retention)</small>}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="visually-hidden" aria-live="polite">{active !== null ? describe(active) : ''}</div>
    </div>
  );
}

// Module-level so AnimatedNumber's effect sees a stable formatter.
export const formatCountValue = (value: number) => fmtCount(Math.round(value));
export const formatAverageValue = (value: number) => fmtAverage(Math.round(value * 10) / 10);

/** A figure that counts from its previous value to the new one. Honors the
 *  reduced-motion setting by jumping straight to the value. */
export function AnimatedNumber({ value, format }: { value: number; format: (value: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const reduced = useReducedMotion();
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduced || from === value) {
      if (ref.current) ref.current.textContent = format(value);
      return;
    }
    const controls = animate(from, value, {
      ...chartTween,
      onUpdate: (latest) => { if (ref.current) ref.current.textContent = format(latest); },
    });
    return () => controls.stop();
  }, [value, format, reduced]);
  return <span ref={ref}>{format(value)}</span>;
}

/** Explains the hatched days: data before retention may be missing, so
 *  those counts are lower bounds rather than known values. */
export function RetentionNote({ result }: { result: AnalyzeResult }) {
  if (result.available_from <= result.from) return null;
  const days = result.series.filter((p) => p.incomplete).length;
  return (
    <p className="analyze-retention-note">
      <span className="analyze-retention-note__swatch" aria-hidden="true" />
      Data before {formatDateTime(result.available_from, result.timezone)} was removed by retention, so the
      {days === 1 ? ' shaded day' : ` ${days} shaded days`} may be undercounted.
    </p>
  );
}

/** The chart's values as a table: the non-visual equivalent, and the place
 *  to read exact numbers. Newest first. */
export function DailyTable({ result }: { result: AnalyzeResult }) {
  const rows = [...result.series].reverse();
  return (
    <Table className="analyze-daily-table" fixed headers={[result.interval === 'day' ? 'Day' : 'Time', 'Occurrences']} widths={['60%', '40%']}>
      {rows.map((p) => (
        <tr key={p.bucket_start}>
          <td className="analyze-daily-table__day">{formatBucket(p.bucket_start, result.timezone, result.interval, 'long')}</td>
          <td className="analyze-daily-table__count">
            {fmtCount(p.count)}
            {p.incomplete && <span className="analyze-daily-table__flag" title="Data before retention may be missing">Partial</span>}
          </td>
        </tr>
      ))}
    </Table>
  );
}

/** Tiny trend for library cards; decorative, the total beside it carries the value. */
export function Sparkline({ result }: { result: AnalyzeResult }) {
  const points = result.series;
  const max = Math.max(1, ...points.map((p) => p.count));
  const w = 120;
  const h = 32;
  const coords = points.map((p, i) => [
    points.length === 1 ? w / 2 : (i / (points.length - 1)) * w,
    // 25% headroom keeps a steady series from reading as a solid block.
    h - 1 - (p.count / (max * 1.25)) * (h - 2),
  ] as [number, number]);
  const line = linePath(coords);
  return (
    <svg className="analyze-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <motion.path
        key={points.length}
        initial={{ d: `${linePath(coords.map(([x]) => [x, h]))}L${w},${h}L0,${h}Z`, opacity: 0 }}
        animate={{ d: `${line}L${w},${h}L0,${h}Z`, opacity: 1 }}
        transition={chartTween}
        className="analyze-sparkline__area"
      />
      <motion.path
        key={`line-${points.length}`}
        initial={{ d: line, pathLength: 0 }}
        animate={{ d: line, pathLength: 1 }}
        transition={{ d: chartTween, pathLength: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } }}
        className="analyze-sparkline__line"
      />
    </svg>
  );
}
