import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CustomEvent, Log, Session } from '../../api';
import { fmtClock, fmtDuration, fmtTime, stripProto, truncate } from '../../lib/format';
import { spring, stagger } from '../../lib/motion';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import { Icon } from '../ui/Icon';
import Modal from '../ui/Modal';
import './replay.css';

type Props = {
  session: Pick<Session, 'started_at' | 'duration_ms'>;
  activity: CustomEvent[];
  logs: ReplayLog[];
  eventsReady: boolean;
  firstTs: number; // client-clock ms of the first rrweb event
  onSeekMs: (offsetMs: number) => void;
};

type ReplayLog = Pick<Log, 'id' | 'timestamp_ms' | 'severity' | 'message' | 'url'>;

type Action =
  | {
      kind: 'custom';
      key: string;
      ts: number;
      name: string;
      trackId: string;
      order: number;
    }
  | {
      kind: 'log';
      key: string;
      ts: number;
      severity: ReplayLog['severity'];
      message: string;
      url: string;
      log: ReplayLog;
      order: number;
    };

function formatReplayOffset(timestamp: number, firstTs: number): string {
  const totalSeconds = Math.max(0, Math.round((timestamp - firstTs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function customLabel(action: Extract<Action, { kind: 'custom' }>): string {
  const target = action.trackId || 'element';
  return action.name === 'click'
    ? `Clicked ${target}`
    : action.trackId
      ? `${action.name} · ${action.trackId}`
      : action.name;
}

function logIcon(severity: ReplayLog['severity']): 'code' | 'warn' | 'x' {
  return severity === 'error' ? 'x' : severity === 'warn' ? 'warn' : 'code';
}

function logTone(severity: ReplayLog['severity']): 'accent' | 'neutral' | 'danger' {
  return severity === 'error' ? 'danger' : severity === 'warn' ? 'accent' : 'neutral';
}

// Sidebar: the visit summary followed by one chronological activity feed.
// Every action is stamped against the same client clock as the rrweb stream,
// so selecting it seeks the player to the matching moment.
export default function PagesPanel({ session, activity, logs, eventsReady, firstTs, onSeekMs }: Props) {
  const s = session;
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<ReplayLog | null>(null);
  const actions = useMemo<Action[]>(() => {
    const customActions: Action[] = activity.map((item, index) => ({
      kind: 'custom',
      key: `custom-${item.ts}-${index}`,
      ts: item.ts,
      name: item.name,
      trackId: item.track_id,
      order: index,
    }));
    const logActions: Action[] = logs.map((item, index) => ({
      kind: 'log',
      key: `log-${item.id}`,
      ts: item.timestamp_ms,
      severity: item.severity,
      message: item.message,
      url: item.url,
      log: item,
      order: index,
    }));
    return [...customActions, ...logActions].sort((a, b) => a.ts - b.ts || a.order - b.order);
  }, [activity, logs]);

  return (
    <Card className="replay-side">
      <h3>{fmtDuration(s.duration_ms)} visit</h3>
      <p className="muted small">
        {fmtTime(s.started_at)} · {actions.length} {actions.length === 1 ? 'action' : 'actions'}
      </p>

      <h4>Actions</h4>
      {!eventsReady ? (
        <p className="muted small actions-empty">Loading actions…</p>
      ) : actions.length === 0 ? (
        <p className="muted small actions-empty">No tracked actions in this recording.</p>
      ) : (
        <motion.ol className="pages-list actions-list" variants={stagger} initial="hidden" animate="visible">
          {actions.map((action) => {
            const label = action.kind === 'custom' ? customLabel(action) : truncate(action.message || 'Browser log', 92);
            const title = action.kind === 'custom'
              ? `${action.name}${action.trackId ? ` · ${action.trackId}` : ''}`
              : action.message;
            return (
              <motion.li key={action.key} variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}>
                <motion.div
                  className={`page-row action-row action-row--${action.kind}${action.kind === 'log' ? ` action-row--log-${action.severity}` : ''}${activeAction === action.key ? ' is-active' : ''}`}
                >
                  <span
                    className={`page-row__num action-row__num${action.kind === 'log' ? ` action-row__num--${action.severity}` : ''}`}
                  >
                    <Icon name={action.kind === 'custom' ? 'bolt' : logIcon(action.severity)} size={12} />
                  </span>
                  <span className="page-row__body action-row__body">
                    <span className="page-row__url action-row__title" title={title}>
                      {action.kind === 'log' && (
                        <span className={`action-row__severity action-row__severity--${action.severity}`}>
                          {action.severity}
                        </span>
                      )}
                      <span className="action-row__message">{label}</span>
                    </span>
                    <span className="page-row__meta action-row__meta">
                      <span className="action-row__offset">{formatReplayOffset(action.ts, firstTs)}</span>
                      {action.kind === 'log' && action.url
                        ? ` · ${truncate(stripProto(action.url), 34)}`
                        : action.kind === 'custom'
                          ? ' · custom event'
                          : ''}
                      {action.kind === 'log' && <span> · {fmtClock(Math.floor(action.ts / 1000))}</span>}
                    </span>
                  </span>
                  <span className="action-row__actions">
                    {action.kind === 'log' && (
                      <motion.button
                        type="button"
                        className="action-row__button"
                        aria-label="Open log detail"
                        title="Open log detail"
                        onClick={() => setSelectedLog(action.log)}
                        whileTap={{ scale: 0.9 }}
                      >
                        <Icon name="code" size={12} />
                      </motion.button>
                    )}
                    <motion.button
                      type="button"
                      className="action-row__button action-row__button--seek"
                      aria-label="Jump to recording time"
                      title="Jump to recording time"
                      onClick={() => {
                        setActiveAction(action.key);
                        onSeekMs(action.ts - firstTs);
                      }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Icon name="clock" size={12} />
                    </motion.button>
                  </span>
                </motion.div>
              </motion.li>
            );
          })}
        </motion.ol>
      )}
      <Modal
        open={selectedLog !== null}
        onClose={() => setSelectedLog(null)}
        title="Log detail"
      >
        {selectedLog && (
          <div className="action-log-detail">
            <div className="action-log-detail__meta">
              <Badge tone={logTone(selectedLog.severity)}>{selectedLog.severity}</Badge>
              <span className="muted small">
                {formatReplayOffset(selectedLog.timestamp_ms, firstTs)} · {fmtClock(Math.floor(selectedLog.timestamp_ms / 1000))}
              </span>
            </div>
            <pre className="action-log-detail__message">{selectedLog.message || '—'}</pre>
            {selectedLog.url && (
              <a className="action-log-detail__url" href={selectedLog.url} target="_blank" rel="noreferrer">
                {selectedLog.url}
              </a>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
