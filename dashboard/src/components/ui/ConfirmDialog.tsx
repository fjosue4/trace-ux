import { ReactNode } from 'react';
import Modal from './Modal';
import Button from './Button';
import { Icon } from './Icon';
import { InlineSpinner } from './Loading';

type Props = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

// Destructive-action confirmation built on Modal.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? <InlineSpinner /> : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-body">
        <span className="confirm-body__icon">
          <Icon name="warn" size={18} />
        </span>
        <p>{description}</p>
      </div>
    </Modal>
  );
}
