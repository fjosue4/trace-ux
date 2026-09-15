import Modal from '../Modal';
import Button from '../Button';
import { Icon } from '../Icon';
import { InlineSpinner } from '../Loading';
import { ConfirmDialogProps } from './ConfirmDialog.types';

// Destructive-action confirmation built on Modal.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
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
