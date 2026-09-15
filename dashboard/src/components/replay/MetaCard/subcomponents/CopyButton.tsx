import { useState } from 'react';
import { motion } from 'motion/react';
import { spring } from '../../../../lib/motion';
import { Icon } from '../../../ui/Icon';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.button
      type="button"
      className={`icon-btn meta-copy${copied ? ' is-success' : ''}`}
      aria-label={copied ? 'Copied' : 'Copy value'}
      title={copied ? 'Copied' : 'Copy'}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
      whileTap={{ scale: 0.88 }}
      transition={spring}
    >
      <Icon name={copied ? 'check' : 'copy'} size={12} />
    </motion.button>
  );
}
