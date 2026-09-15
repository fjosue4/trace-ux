import type { ReactNode } from 'react';
import classNames from 'classnames';
import { motion } from 'motion/react';
import { fadeUp } from '../../../lib/motion';
import { LoadingProps } from './Loading.types';
import './Loading.scss';

export default function Loading({ label = 'Loading…', overlay = false }: LoadingProps) {
  return (
    <motion.div className={classNames('loading', { 'loading--overlay': overlay })} variants={fadeUp} initial="hidden" animate="visible">
      <motion.span className="loading__spinner" aria-hidden animate={{ rotate: 360 }} transition={{ duration: 0.8, ease: 'linear', repeat: Infinity }} />
      <span>{label}</span>
    </motion.div>
  );
}

export function InlineSpinner() {
  return <motion.span className="loading__spinner loading__spinner--inline" aria-hidden animate={{ rotate: 360 }} transition={{ duration: 0.8, ease: 'linear', repeat: Infinity }} />;
}

export function MaybeLoading({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Loading /> : <>{children}</>;
}
