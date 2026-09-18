import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { fadeUp } from '../../../lib/motion';
import { Icon } from '../Icon';
import { NoticeProps } from './Notice.types';
import './Notice.scss';

export default function Notice({ tone = 'info', floating = tone === 'error', children }: NoticeProps) {
  const [dismissed, setDismissed] = useState(false);
  const [notificationHost, setNotificationHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setDismissed(false);
  }, [children]);

  useEffect(() => {
    if (!floating) {
      setNotificationHost(null);
      return;
    }
    setNotificationHost(document.getElementById('floating-notifications'));
  }, [floating]);

  if (floating && dismissed) return null;

  // The host is owned by App and is created in the same React commit. Wait for
  // the effect to discover it instead of briefly rendering a floating error in
  // its page position.
  if (floating && !notificationHost) return null;

  const notice = (
    <motion.div
      className={`notice notice--${tone}`}
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div className="notice__message">{children}</div>
      {floating && (
        <button
          type="button"
          className="notice__close"
          aria-label="Dismiss notification"
          onClick={() => setDismissed(true)}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </motion.div>
  );

  if (!floating) return notice;

  const host = notificationHost;
  if (!host) return null;

  return createPortal(<div className="floating-notice">{notice}</div>, host);
}
