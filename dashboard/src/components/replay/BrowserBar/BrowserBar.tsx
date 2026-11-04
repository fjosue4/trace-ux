import { AnimatePresence, motion } from 'motion/react';
import { Icon, IconName } from '../../ui/Icon';
import { displayURL } from './BrowserBar.helpers';
import { BrowserBarProps } from './BrowserBar.types';
import { AddressBar } from './subcomponents/AddressBar';
import { BrowserTab } from './subcomponents/BrowserTab';
import '../replay.scss';

/** A Chrome-style window top for the replay: the tab and the recorded page's
 *  address, with back, forward and reload stepping through the visit's pages,
 *  and macOS window lights whose red one closes the recording. */
export default function BrowserBar({ page, title, onClose, closeLabel = 'Close', onBack, onForward, onReload }: BrowserBarProps) {
  const url = page ? displayURL(page.url) : null;
  const tabTitle = title || page?.title || url?.host || 'New Tab';

  return (
    <div className="browser-bar" role="group" aria-label="Recorded browser">
      <div className="browser-bar__strip">
        <span className="browser-bar__lights">
          {/* As on macOS, the red light closes the window and shows its ×
              on hover; the other two are decoration. */}
          {onClose ? (
            <button
              type="button"
              className="browser-bar__light browser-bar__light--close"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={onClose}
            >
              <Icon name="x" size={8} />
            </button>
          ) : (
            <i className="browser-bar__light browser-bar__light--close" aria-hidden="true" />
          )}
          <i className="browser-bar__light browser-bar__light--minimize" aria-hidden="true" />
          <i className="browser-bar__light browser-bar__light--zoom" aria-hidden="true" />
        </span>
        <BrowserTab title={tabTitle} onClose={onClose} closeLabel={closeLabel} />
        <span className="browser-bar__new-tab" aria-hidden="true">
          <Icon name="plus" size={13} />
        </span>
      </div>
      <div className="browser-bar__toolbar">
        <NavButton icon="arrowLeft" label="Go to the previous page in this recording" onClick={onBack} />
        <NavButton icon="arrowRight" label="Go to the next page in this recording" onClick={onForward} />
        <NavButton icon="rotateCw" label="Go to the start of this page" onClick={onReload} />
        <AddressBar url={url} />
      </div>
      {/* Chrome's loading line, once per navigation. Not on first render:
          opening a recording is not a navigation inside it. */}
      <AnimatePresence initial={false}>
        {page && (
          <motion.span
            key={page.url}
            className="browser-bar__progress"
            aria-hidden="true"
            initial={{ scaleX: 0, opacity: 1 }}
            animate={{ scaleX: [0, 0.75, 1], opacity: [1, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, times: [0, 0.6, 1], ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ icon, label, onClick }: { icon: IconName; label: string; onClick?: () => void }) {
  return (
    <button type="button" className="browser-bar__nav" aria-label={label} title={label} disabled={!onClick} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  );
}
