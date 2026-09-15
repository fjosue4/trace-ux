export const pctLabel = (pct: number) => (pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`);
export const clampPct = (v: number) => Math.max(0, Math.min(100, v));
