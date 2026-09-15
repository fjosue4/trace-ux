import { motion } from 'motion/react';
import { fadeUp, softSpring } from '../../../lib/motion';
import { Icon } from '../Icon';
import { EmptyStateProps } from './EmptyState.types';
import './EmptyState.scss';

export default function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <motion.div className="empty" variants={fadeUp} initial="hidden" animate="visible">
      <motion.div className="empty__icon" aria-hidden whileHover={{ rotate: -5, scale: 1.06 }} transition={softSpring}>
        {icon ?? <Icon name="play" size={20} />}
      </motion.div>
      <h3 className="empty__title">{title}</h3>
      {description && <p className="empty__desc">{description}</p>}
      {action}
    </motion.div>
  );
}
