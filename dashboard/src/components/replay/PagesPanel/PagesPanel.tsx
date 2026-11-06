import { motion } from 'motion/react';
import classNames from 'classnames';
import { fmtDuration, fmtTime } from '../../../lib/format';
import Card from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import DebouncedTextInput from '../../ui/DebouncedTextInput';
import { InlineSpinner } from '../../ui/Loading';
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
  actions: recordingActions,
  activity,
  logs,
  pages,
  tickets,
  feedback,
  eventsReady,
  firstTs,
  currentTimeMs,
  onSeekMs,
  initialQuery,
}: PagesPanelProps) {
  const { selectedLog, setSelectedLog, query, setQuery, searchPending, setSearchPending, listRef, setRowRef, actions, visible, activeKey } =
    usePagesPanel({ activity, logs, pages, tickets, feedback, firstTs, currentTimeMs, initialQuery });

  return (
    <Card className="replay-side">
      <header className="replay-side__header">
        <h3>{fmtDuration(session.duration_ms)} visit</h3>
        <p className="muted small">
          {fmtTime(session.started_at)} · {actions.length} {actions.length === 1 ? 'action' : 'actions'}
        </p>
        {recordingActions && <div className="replay-side__toolbar">{recordingActions}</div>}
      </header>

      <div className="actions-head">
        <h4>Actions</h4>
        {actions.length > 0 && (
          <span className="actions-head__count">
            {query.trim() && !searchPending ? `${visible.length} of ${actions.length}` : actions.length}
          </span>
        )}
      </div>
      {actions.length > 0 && (
        <div className={classNames('actions-search', { 'is-pending': searchPending })}>
          <span className="actions-search__icon" aria-hidden="true">
            <Icon name="search" size={13} />
          </span>
          <DebouncedTextInput
            type="search"
            className="actions-search__input"
            placeholder="Search actions and pages"
            aria-label="Search actions and pages"
            value={query}
            onDebouncedChange={setQuery}
            onPendingChange={setSearchPending}
          />
          {/* One slot at the field's right edge: the spinner while the typed
              text is on its way to the filter, then a clear button. */}
          {searchPending ? (
            <span className="actions-search__status" role="status" aria-label="Searching actions">
              <InlineSpinner />
            </span>
          ) : query && (
            <button type="button" className="actions-search__clear" aria-label="Clear search" title="Clear search" onClick={() => setQuery('')}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      )}
      {!eventsReady ? (
        <p className="muted small actions-empty actions-loading" role="status">
          <InlineSpinner />
          Loading actions…
        </p>
      ) : actions.length === 0 ? (
        <p className="muted small actions-empty">No tracked actions in this recording.</p>
      ) : visible.length === 0 ? (
        // The search box carries the pending spinner; here only the result.
        <p className={classNames('muted small actions-empty', { 'is-stale': searchPending })}>
          No actions match “{query.trim()}”.
        </p>
      ) : (
        // While a search is on its way the current rows stay in place, dimmed:
        // swapping them for a spinner on every keystroke made the list
        // flicker and threw away its scroll position.
        <motion.ol
          ref={listRef}
          className={classNames('pages-list actions-list', { 'is-searching': searchPending })}
          aria-busy={searchPending}
          // Long recordings must not stagger hundreds of rows before showing a match.
          initial={false}
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
