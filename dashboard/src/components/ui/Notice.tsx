import { ReactNode } from 'react';
import './Notice.css';

type Props = {
  tone?: 'success' | 'error' | 'info';
  children: ReactNode;
};

export default function Notice({ tone = 'info', children }: Props) {
  return <div className={`notice notice--${tone}`}>{children}</div>;
}
