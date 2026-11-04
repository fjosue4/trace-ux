import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '../../../ui/Icon';

type BrowserTabProps = {
  title: string;
  /** Makes the × a real button; without it the × is drawn only. */
  onClose?: () => void;
  closeLabel?: string;
};

/** The recorded browser's active tab: the page title, swapped with a short
 *  fade on each navigation, and a × that can close the recording. */
export function BrowserTab({ title, onClose, closeLabel = 'Close' }: BrowserTabProps) {
  return (
    <div className="browser-tab">
      <span className="browser-tab__favicon" aria-hidden="true">
        <Icon name="globe" size={12} />
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={title}
          className="browser-tab__title"
          title={title}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.12 }}
        >
          {title}
        </motion.span>
      </AnimatePresence>
      {onClose ? (
        <button type="button" className="browser-tab__close" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
          <Icon name="x" size={10} />
        </button>
      ) : (
        <span className="browser-tab__close" aria-hidden="true">
          <Icon name="x" size={10} />
        </span>
      )}
    </div>
  );
}
