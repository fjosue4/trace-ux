import { motion } from 'motion/react';
import { fadeUp, stagger } from '../../../lib/motion';
import { PageHeaderProps } from './PageHeader.types';
import './PageHeader.scss';

export default function PageHeader({ title, subtitle, leading, actions }: PageHeaderProps) {
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
