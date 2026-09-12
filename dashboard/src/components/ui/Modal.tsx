import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { softSpring } from '../../lib/motion';
import { Icon } from './Icon';
import './Modal.css';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
};

// Dialog rendered in a portal above everything; closes on Escape or backdrop
// click and locks page scroll while open.
export default function Modal({ open, onClose, title, className = '', children, footer }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className={`modal ${className}`.trim()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={softSpring}
          >
            <div className="modal__head">
              <h3>{title}</h3>
              <motion.button className="modal__close" onClick={onClose} aria-label="Close dialog" whileHover={{ rotate: 8, scale: 1.08 }} whileTap={{ scale: 0.92 }}>
                <Icon name="x" size={16} />
              </motion.button>
            </div>
            <div className="modal__body">{children}</div>
            {footer && <div className="modal__footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
