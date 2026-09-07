import { useCallback, useEffect, useState } from 'react';
import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { api, SystemHealth as Health } from '../api';
import { fmtBytes, fmtClock, fmtDuration } from '../lib/format';
import { fadeUp, softSpring } from '../lib/motion';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import Badge from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import './SystemHealth.css';

const pctLabel = (pct: number) => (pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`);
const clampPct = (v: number) => Math.max(0, Math.min(100, v));

// Bar showing how much of the resource is in use; the leading accent segment
// is the part TraceUX itself accounts for.
function Meter({ usedPct, shotPct, hot }: { usedPct: number; shotPct?: number; hot?: boolean }) {
  const shot = Math.max(0, Math.min(shotPct ?? 0, usedPct));
  return (
    <motion.div className="meter" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {shot > 0 && <motion.div className="meter__fill meter__fill--shot" initial={{ width: 0 }} animate={{ width: `${clampPct(shot)}%` }} transition={softSpring} />}
      <motion.div className={`meter__fill${hot ? ' is-hot' : ''}`} initial={{ width: 0 }} animate={{ width: `${clampPct(usedPct - shot)}%` }} transition={softSpring} />
    </motion.div>
  );
}

function Row({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <motion.div className="health-row" variants={fadeUp} initial="hidden" animate="visible">
      <span className="muted small">{label}</span>
      <span className={`small${mono ? ' mono' : ''}`}>{value}</span>
    </motion.div>
  );
}

export default function SystemHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [stamp, setStamp] = useState(0);

  const load = useCallback(() => {
    api
      .getSystemHealth()
      .then((h) => {
        setHealth(h);
        setStamp(Date.now() / 1000);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load system health.'));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  if (error) {
    return (
      <main className="page">
        <PageHeader title="System health" />
        <Notice tone="error">{error}</Notice>
      </main>
    );
  }
  if (!health) {
    return (
      <main className="page">
        <PageHeader title="System health" />
        <Loading />
      </main>
    );
  }

  const { ram, cpu, disk, store } = health;
  const ramUsedPct = ram.total_bytes > 0 ? (ram.used_bytes / ram.total_bytes) * 100 : 0;
  const ramShotPct = ram.total_bytes > 0 ? (ram.trace_ux_bytes / ram.total_bytes) * 100 : 0;
  const diskUsed = disk.total_bytes > 0 ? disk.total_bytes - disk.free_bytes : 0;
  const diskUsedPct = disk.total_bytes > 0 ? (diskUsed / disk.total_bytes) * 100 : 0;
  const diskShotPct = disk.total_bytes > 0 ? (disk.trace_ux_bytes / disk.total_bytes) * 100 : 0;
  const noOS = ram.total_bytes === 0 && disk.total_bytes === 0;

  return (
    <main className="page">
      <PageHeader
        title="System health"
        subtitle="Live view of the server resources and the share TraceUX accounts for"
        actions={<Badge tone="neutral">Live · {fmtClock(stamp)}</Badge>}
      />

      {noOS && (
        <Notice tone="info">
          OS metrics are only collected on Linux (the VPS) — this environment reports no figures.
        </Notice>
      )}

      <div className="health-grid">
        <Card className="health-card">
          <div className="health-card__head">
            <Icon name="bolt" size={14} />
            <h3>Memory</h3>
            <span className="health-card__big">{ram.total_bytes > 0 ? pctLabel(ramUsedPct) : '—'}</span>
          </div>
          <Meter usedPct={ramUsedPct} shotPct={ramShotPct} hot={ramUsedPct >= 80} />
          <Row label="Total" value={ram.total_bytes > 0 ? fmtBytes(ram.total_bytes) : 'n/a'} />
          <Row label="In use" value={ram.total_bytes > 0 ? fmtBytes(ram.used_bytes) : 'n/a'} />
          <Row label="Available" value={ram.total_bytes > 0 ? fmtBytes(ram.available_bytes) : 'n/a'} />
          <div className="health-row">
            <span className="muted small">TraceUX (RSS)</span>
            <Badge tone="accent">{fmtBytes(ram.trace_ux_bytes)}</Badge>
          </div>
          {ram.mem_limit_bytes > 0 && (
            <Row label="Soft memory cap" value={fmtBytes(ram.mem_limit_bytes)} />
          )}
        </Card>

        <Card className="health-card">
          <div className="health-card__head">
            <Icon name="clock" size={14} />
            <h3>CPU</h3>
            <span className="health-card__big">{pctLabel(cpu.trace_ux_pct)}</span>
          </div>
          <Meter usedPct={cpu.trace_ux_pct} hot={cpu.trace_ux_pct >= 80} />
          <Row label="Cores" value={String(cpu.cores)} />
          <Row label="Load (1m)" value={cpu.load1.toFixed(2)} />
          <Row label="Load (5m)" value={cpu.load5.toFixed(2)} />
          <Row label="Load (15m)" value={cpu.load15.toFixed(2)} />
          <Row label="TraceUX uptime" value={fmtDuration(cpu.uptime_seconds * 1000)} />
        </Card>

        <Card className="health-card">
          <div className="health-card__head">
            <Icon name="code" size={14} />
            <h3>Disk</h3>
            <span className="health-card__big">{disk.total_bytes > 0 ? pctLabel(diskUsedPct) : '—'}</span>
          </div>
          <Meter usedPct={diskUsedPct} shotPct={diskShotPct} hot={diskUsedPct >= 80} />
          <Row label="Volume" value={disk.total_bytes > 0 ? fmtBytes(disk.total_bytes) : 'n/a'} />
          <Row label="Free" value={disk.total_bytes > 0 ? fmtBytes(disk.free_bytes) : 'n/a'} />
          <div className="health-row">
            <span className="muted small">TraceUX data</span>
            <Badge tone="accent">{fmtBytes(disk.trace_ux_bytes)}</Badge>
          </div>
          <Row label="Data dir" value={disk.data_dir} mono={false} />
        </Card>
      </div>

      <Card className="health-store">
        <div className="health-store__row">
          <div>
            <strong>What TraceUX stores</strong>
            <p className="muted small">
              Everything lives in the SQLite database inside <code>{disk.data_dir}</code> — recordings,
              feedback and user accounts. Per-site retention deletes old recordings and feedback
              automatically, so the disk share stays bounded.
            </p>
          </div>
          <div className="health-store__counts">
            <div className="health-store__count">
              <strong>{store.sites}</strong>
              <span className="muted small">sites</span>
            </div>
            <div className="health-store__count">
              <strong>{store.sessions}</strong>
              <span className="muted small">recordings</span>
            </div>
            <div className="health-store__count">
              <strong>{store.feedback}</strong>
              <span className="muted small">feedback</span>
            </div>
          </div>
        </div>
      </Card>
    </main>
  );
}
