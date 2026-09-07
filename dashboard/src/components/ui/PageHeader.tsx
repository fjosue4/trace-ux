import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { fadeUp, stagger } from '../../lib/motion';
import './PageHeader.css';

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export default function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <motion.div className="page-head" variants={stagger} initial="hidden" animate="visible">
      <motion.div variants={fadeUp}>
        <h1>{title}</h1>
        {subtitle && <p className="page-head__sub">{subtitle}</p>}
      </motion.div>
      {actions && <motion.div className="page-head__actions" variants={fadeUp}>{actions}</motion.div>}
    </motion.div>
  );
}
