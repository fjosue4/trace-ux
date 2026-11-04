import { AnimatePresence, motion } from 'motion/react';
import { useClipboardCopy } from '../../../../hooks/useClipboardCopy';
import { Icon } from '../../../ui/Icon';
import { DisplayURL } from '../BrowserBar.types';

/** The recorded browser's address bar: the URL on screen at this point of
 *  the recording, laid out like Chrome's, with a button to copy it. */
export function AddressBar({ url }: { url: DisplayURL | null }) {
  const { status, copy } = useClipboardCopy();
  const copyLabel = status === 'copied' ? 'Copied' : status === 'failed' ? 'Could not copy URL. Try again.' : 'Copy page URL';

  return (
    <div className="browser-address">
      {url?.host && (
        <span
          className={`browser-address__security${url.secure ? '' : ' is-insecure'}`}
          title={url.secure ? 'Served over https' : 'Not secure: served over http'}
        >
          <Icon name={url.secure ? 'lock' : 'warn'} size={12} />
          {!url.secure && <span className="browser-address__insecure">Not secure</span>}
        </span>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={url?.full ?? ''}
          className="browser-address__url"
          title={url?.full}
          aria-label={url ? `Page URL at this point of the recording: ${url.full}` : undefined}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          // Same timing as the tab title, so the two never disagree mid-swap.
          transition={{ duration: 0.12 }}
        >
          {url ? (
            <>
              <span className="browser-address__host">{url.host}</span>
              <span className="browser-address__rest">{url.rest}</span>
            </>
          ) : (
            <span className="browser-address__rest">Waiting for the first page…</span>
          )}
        </motion.span>
      </AnimatePresence>
      {url && (
        <button
          type="button"
          className={`browser-address__copy${status === 'copied' ? ' is-success' : ''}`}
          aria-label={copyLabel}
          title={copyLabel}
          onClick={() => copy(url.full)}
        >
          <Icon name={status === 'copied' ? 'check' : 'copy'} size={12} />
        </button>
      )}
    </div>
  );
}
