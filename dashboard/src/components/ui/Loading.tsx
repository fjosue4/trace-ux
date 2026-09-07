import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { fadeUp } from '../../lib/motion';
import './Loading.css';

type Props = { label?: string; overlay?: boolean };

export default function Loading({ label = 'Loading…', overlay = false }: Props) {
  return (
    <motion.div className={`loading${overlay ? ' loading--overlay' : ''}`} variants={fadeUp} initial="hidden" animate="visible">
      <motion.span className="loading__spinner" aria-hidden animate={{ rotate: 360 }} transition={{ duration: 0.8, ease: 'linear', repeat: Infinity }} />
      <span>{label}</span>
    </motion.div>
  );
}

export function InlineSpinner() {
  return <motion.span className="loading__spinner loading__spinner--inline" aria-hidden animate={{ rotate: 360 }} transition={{ duration: 0.8, ease: 'linear', repeat: Infinity }} />;
}

// Convenience for pages that render either content or a loading placeholder.
export function MaybeLoading({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Loading /> : <>{children}</>;
}
