import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { fadeUp, stagger } from '../../lib/motion';
import './PageHeader.css';

type Props = {
  /** Optional: a page whose content is self-evident (the replay) can omit the
   *  heading and keep only the actions, reclaiming the vertical space. */
  title?: string;
  subtitle?: string;
  /** Rendered at the far left of the bar — back links belong here, where the
   *  eye lands first, rather than grouped with the page's own actions. */
  leading?: ReactNode;
  actions?: ReactNode;
};

export default function PageHeader({ title, subtitle, leading, actions }: Props) {
  return (
    <motion.div className="page-head" variants={stagger} initial="hidden" animate="visible">
      <motion.div className="page-head__lead" variants={fadeUp}>
        {leading}
        <div>
          {title && <h1>{title}</h1>}
          {subtitle && <p className="page-head__sub">{subtitle}</p>}
        </div>
      </motion.div>
      {actions && <motion.div className="page-head__actions" variants={fadeUp}>{actions}</motion.div>}
    </motion.div>
  );
}
