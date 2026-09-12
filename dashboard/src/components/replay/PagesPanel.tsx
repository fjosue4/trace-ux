import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { CustomEvent, Log, Session, SessionPage } from '../../api';
import { fmtClock, fmtDuration, fmtTime, stripProto, truncate } from '../../lib/format';
import { stagger } from '../../lib/motion';
import Badge from '../ui/Badge';
import Card from '../ui/Card';
import { Icon } from '../ui/Icon';
import Modal from '../ui/Modal';
import './replay.css';

type Props = {
  session: Pick<Session, 'started_at' | 'duration_ms'>;
  activity: CustomEvent[];
  logs: ReplayLog[];
  pages: SessionPage[];
  eventsReady: boolean;
  firstTs: number; // client-clock ms of the first rrweb event
  currentTimeMs: number; // playhead, for highlighting and auto-scroll
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
    }
  | {
      kind: 'page';
      key: string;
      ts: number;
      url: string;
      title: string;
      first: boolean;
      order: number;
    };

function formatReplayOffset(timestamp: number, firstTs: number): string {
  const totalSeconds = Math.max(0, Math.round((timestamp - firstTs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

// A URL is far more readable as its path than as an absolute address, and the
// hash matters: in-page anchors are the most common navigation on a marketing
// site and are otherwise indistinguishable from one another.
function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {
    return url;
  }
}

function customLabel(action: Extract<Action, { kind: 'custom' }>): string {
  const target = action.trackId || 'element';
  return action.name === 'click'
    ? `Clicked ${target}`
    : action.trackId
      ? `${action.name} · ${action.trackId}`
      : action.name;
}

// The row's visible text. Shared with the search index so a query always
// matches what is actually on screen.
function actionLabel(action: Action): string {
  if (action.kind === 'custom') return customLabel(action);
  if (action.kind === 'page') return `${action.first ? 'Opened' : 'Navigated to'} ${pagePath(action.url)}`;
  return action.message || 'Browser log';
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
export default function PagesPanel({
  session,
  activity,
  logs,
  pages,
  eventsReady,
  firstTs,
  currentTimeMs,
  onSeekMs,
}: Props) {
  const s = session;
  const [selectedLog, setSelectedLog] = useState<ReplayLog | null>(null);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLOListElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});
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
    // Every URL change is an action: the first page load opens the feed, and
    // each later entry (including in-page hash navigation) is its own row.
    const pageActions: Action[] = pages.map((page, index) => ({
      kind: 'page',
      key: `page-${page.idx}-${page.entered_at}`,
      ts: page.entered_at * 1000, // stored in seconds, same client clock
      url: page.url,
      title: page.title,
      first: index === 0,
      order: index,
    }));
    return [...customActions, ...logActions, ...pageActions].sort(
      (a, b) => a.ts - b.ts || a.order - b.order,
    );
  }, [activity, logs, pages]);

  // One searchable string per action. Kept alongside the row rather than
  // recomputed in the filter so the same text can back a server-side search
  // over actions and pages later.
  const searchable = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of actions) {
      const extra =
        a.kind === 'custom'
          ? `custom event ${a.name} ${a.trackId}`
          : a.kind === 'log'
            ? `log ${a.severity} ${a.url}`
            : `page navigation ${a.title} ${a.url}`;
      map[a.key] = `${actionLabel(a)} ${extra}`.toLowerCase();
    }
    return map;
  }, [actions]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => (needle ? actions.filter((a) => searchable[a.key].includes(needle)) : actions),
    [actions, needle, searchable],
  );

  // The row the playhead is currently inside: the last action at or before it.
  const activeKey = useMemo(() => {
    let key: string | null = null;
    for (const a of actions) {
      if (a.ts - firstTs <= currentTimeMs) key = a.key;
      else break; // actions are sorted, so the rest are in the future
    }
    return key;
  }, [actions, currentTimeMs, firstTs]);

  // Follow playback, but only scroll the feed itself — never the page — and
  // stay put while the viewer is reading a filtered list.
  useEffect(() => {
    if (!activeKey || needle) return;
    const row = rowRefs.current[activeKey];
    const list = listRef.current;
    if (!row || !list) return;
    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top >= listBox.top && rowBox.bottom <= listBox.bottom) return; // already visible
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({
      top: list.scrollTop + (rowBox.top - listBox.top) - listBox.height / 2 + rowBox.height / 2,
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [activeKey, needle]);

  return (
    <Card className="replay-side">
      <h3>{fmtDuration(s.duration_ms)} visit</h3>
      <p className="muted small">
        {fmtTime(s.started_at)} · {actions.length} {actions.length === 1 ? 'action' : 'actions'}
      </p>

      <div className="actions-head">
        <h4>Actions</h4>
        {actions.length > 0 && (
          <input
            type="search"
            className="actions-search"
            placeholder="Search actions and pages"
            aria-label="Search actions and pages"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>
      {!eventsReady ? (
        <p className="muted small actions-empty">Loading actions…</p>
      ) : actions.length === 0 ? (
        <p className="muted small actions-empty">No tracked actions in this recording.</p>
      ) : visible.length === 0 ? (
        <p className="muted small actions-empty">No actions match “{query.trim()}”.</p>
      ) : (
        <motion.ol
          ref={listRef}
          className="pages-list actions-list"
          variants={stagger}
          initial="hidden"
          animate="visible"
        >
          {visible.map((action) => {
            const label = truncate(actionLabel(action), 92);
            const title =
              action.kind === 'custom'
                ? `${action.name}${action.trackId ? ` · ${action.trackId}` : ''}`
                : action.kind === 'page'
                  ? `${action.title || 'Page'} — ${action.url}`
                  : action.message;
            const isActive = activeKey === action.key;
            const seek = () => onSeekMs(Math.max(0, action.ts - firstTs));
            return (
              <motion.li
                key={action.key}
                ref={(node: HTMLLIElement | null) => {
                  rowRefs.current[action.key] = node;
                }}
                variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
              >
                {/* The whole row seeks. It is a div with a button role rather
                    than a <button> because it contains its own detail button,
                    and nesting buttons is invalid. */}
                <motion.div
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? 'true' : undefined}
                  className={`page-row action-row action-row--${action.kind}${action.kind === 'log' ? ` action-row--log-${action.severity}` : ''}${isActive ? ' is-active' : ''}`}
                  title="Jump to this moment"
                  onClick={seek}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      seek();
                    }
                  }}
                  whileTap={{ scale: 0.995 }}
                >
                  <span
                    className={`page-row__num action-row__num${action.kind === 'log' ? ` action-row__num--${action.severity}` : ''}`}
                  >
                    <Icon
                      name={
                        action.kind === 'custom' ? 'bolt' : action.kind === 'page' ? 'globe' : logIcon(action.severity)
                      }
                      size={12}
                    />
                  </span>
                  <span className="page-row__body action-row__body">
                    <span className="page-row__url action-row__title" title={title}>
                      {action.kind === 'log' && (
                        <span className={`action-row__severity action-row__severity--${action.severity}`}>
                          {action.severity}
                        </span>
                      )}
                      {action.kind === 'page' && (
                        <span className="action-row__severity action-row__severity--page">page</span>
                      )}
                      <span className="action-row__message">{label}</span>
                    </span>
                    <span className="page-row__meta action-row__meta">
                      <span className="action-row__offset">{formatReplayOffset(action.ts, firstTs)}</span>
                      {action.kind === 'log' && action.url
                        ? ` · ${truncate(stripProto(action.url), 34)}`
                        : action.kind === 'custom'
                          ? ' · custom event'
                          : action.kind === 'page' && action.title
                            ? ` · ${truncate(action.title, 34)}`
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
                        title="Open log detail (does not move the player)"
                        // Detail only: the row's seek must not also fire.
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLog(action.log);
                        }}
                        whileTap={{ scale: 0.9 }}
                      >
                        <Icon name="code" size={12} />
                      </motion.button>
                    )}
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
