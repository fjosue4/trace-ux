import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import Button from '../Button';
import { spring } from '../../../lib/motion';
import { FloatingSaveProps } from './FloatingSave.types';
import './FloatingSave.scss';

// The page-wide save action. It floats at the bottom of the viewport so it is
// reachable wherever the operator scrolled to, and only appears once there is
// something to save. Saves that belong to a modal or to one item (a service
// card, a user row) keep their own inline button instead.
//
// Rendered into the page body: cards animate with transforms, and a transformed
// ancestor would turn position: fixed into "fixed to the card".
export default function FloatingSave({
  visible,
  busy = false,
  label = 'Save changes',
  busyLabel = 'Saving…',
  disabled = false,
  onSave,
  form,
}: FloatingSaveProps) {
  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          className="floating-save"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97, transition: { duration: 0.14 } }}
          transition={spring}
        >
          <Button
            type={form ? 'submit' : 'button'}
            form={form}
            onClick={onSave}
            disabled={busy || disabled}
            title="Save unsaved changes"
          >
            {busy ? busyLabel : label}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
