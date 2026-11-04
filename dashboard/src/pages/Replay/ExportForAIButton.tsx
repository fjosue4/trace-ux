import { motion, useReducedMotion } from 'motion/react';
import classNames from 'classnames';
import { InlineSpinner } from '../../components/ui/Loading';
import { Icon } from '../../components/ui/Icon';

export type ExportForAIState = 'idle' | 'preparing' | 'saving';

type Props = {
  state: ExportForAIState;
  disabled: boolean;
  onExport: () => void;
};

const LABELS: Record<ExportForAIState, string> = {
  idle: 'Export for AI',
  preparing: 'Preparing export…',
  saving: 'Saving export…',
};

/** The Replay header's export action, styled apart from the plain buttons
 *  beside it because it hands the recording to an AI assistant. */
export default function ExportForAIButton({ state, disabled, onExport }: Props) {
  const reduceMotion = useReducedMotion();
  const busy = state !== 'idle';
  return (
    // A motion.button with the shared .btn classes rather than <Button>, which
    // takes no motion props: hover has to reach the sheen as a variant. Like
    // the buttons beside it, the button itself does not move.
    <motion.button
      type="button"
      className={classNames('btn btn--secondary btn--sm export-ai-button', { 'is-busy': busy })}
      disabled={disabled}
      aria-busy={busy}
      title="Download recording, actions, and logs as JSON for AI-assisted debugging"
      onClick={onExport}
      // Hover only: a focus-driven variant would hold the hover look on the
      // button after every click. Keyboard focus gets the same fill in CSS.
      initial="rest"
      animate="rest"
      whileHover={disabled ? undefined : 'hover'}
    >
      {!reduceMotion && (
        <motion.span
          aria-hidden="true"
          className="export-ai-button__sheen"
          // Motion owns this element's transform, so the slant is set here;
          // a CSS transform would be overwritten when x animates.
          style={{ skewX: -20 }}
          // Every hover plays the full sweep from the left edge: the hover
          // keyframes name their start, and leaving resets instantly. Easing
          // back on leave instead meant a quick re-hover began mid-path and
          // showed part of the sweep or none of it.
          variants={{
            rest: { x: '-180%', opacity: 0, transition: { duration: 0 } },
            hover: { x: ['-180%', '280%'], opacity: [0, 1, 0], transition: { duration: 0.7, ease: 'easeOut' } },
          }}
        />
      )}
      {busy ? <InlineSpinner /> : <Icon name="fileSparkles" size={13} />}
      <span>{LABELS[state]}</span>
    </motion.button>
  );
}
