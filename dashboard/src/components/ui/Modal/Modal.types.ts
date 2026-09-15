import type { ReactNode } from 'react';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
};
