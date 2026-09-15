import { motion } from 'motion/react';
import { fmtDuration, fmtTime } from '../../../lib/format';
import { stagger } from '../../../lib/motion';
import Card from '../../ui/Card';
import DebouncedTextInput from '../../ui/DebouncedTextInput';
import { usePagesPanel } from './hooks/usePagesPanel';
import { ActionRow } from './subcomponents/ActionRow';
import { ActionDetailModal } from './subcomponents/ActionDetailModal';
import { PagesPanelProps } from './PagesPanel.types';
import '../replay.scss';

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
}: PagesPanelProps) {
  const { selectedLog, setSelectedLog, query, setQuery, listRef, setRowRef, actions, visible, activeKey } =
    usePagesPanel({ activity, logs, pages, firstTs, currentTimeMs });

  return (
    <Card className="replay-side">
      <h3>{fmtDuration(session.duration_ms)} visit</h3>
      <p className="muted small">
        {fmtTime(session.started_at)} · {actions.length} {actions.length === 1 ? 'action' : 'actions'}
      </p>

      <div className="actions-head">
        <h4>Actions</h4>
        {actions.length > 0 && (
          <DebouncedTextInput
            type="search"
            className="actions-search"
            placeholder="Search actions and pages"
            aria-label="Search actions and pages"
            value={query}
            onDebouncedChange={setQuery}
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
          {visible.map((action) => (
            <ActionRow
              key={action.key}
              action={action}
              isActive={activeKey === action.key}
              firstTs={firstTs}
              setRowRef={setRowRef}
              onSeek={(a) => onSeekMs(Math.max(0, a.ts - firstTs))}
              onOpenLogDetail={(a) => setSelectedLog(a.log)}
            />
          ))}
        </motion.ol>
      )}
      <ActionDetailModal log={selectedLog} firstTs={firstTs} onClose={() => setSelectedLog(null)} />
    </Card>
  );
}
