import { motion } from 'motion/react';
import { fmtClock, stripProto, truncate } from '../../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { actionLabel, formatReplayOffset, logIcon } from '../actionHelpers';
import { Action } from '../PagesPanel.types';

type ActionRowProps = {
  action: Action;
  isActive: boolean;
  firstTs: number;
  setRowRef: (key: string, node: HTMLLIElement | null) => void;
  onSeek: (action: Action) => void;
  onOpenLogDetail: (action: Extract<Action, { kind: 'log' }>) => void;
};

export function ActionRow({ action, isActive, firstTs, setRowRef, onSeek, onOpenLogDetail }: ActionRowProps) {
  const label = truncate(actionLabel(action), 92);
  const title =
    action.kind === 'custom'
      ? `${action.name}${action.trackId ? ` · ${action.trackId}` : ''}`
      : action.kind === 'page'
        ? `${action.title || 'Page'} — ${action.url}`
        : action.message;
  const seek = () => onSeek(action);

  return (
    <motion.li
      ref={(node: HTMLLIElement | null) => setRowRef(action.key, node)}
      variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
    >
      {/* The whole row seeks. It is a div with a button role rather than a
          <button> because it contains its own detail button, and nesting
          buttons is invalid. */}
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
            name={action.kind === 'custom' ? 'bolt' : action.kind === 'page' ? 'globe' : logIcon(action.severity)}
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
                onOpenLogDetail(action);
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
}
