import { motion } from 'motion/react';
import { useClipboardCopy } from '../../../../hooks/useClipboardCopy';
import { Icon } from '../../../ui/Icon';

export function CopyButton({ text }: { text: string }) {
  const { status, copy } = useClipboardCopy();
  const label = status === 'copied' ? 'Copied' : status === 'failed' ? 'Could not copy. Try again.' : 'Copy value';
  return (
    <motion.button
      type="button"
      className={`icon-btn meta-copy${status === 'copied' ? ' is-success' : ''}`}
      aria-label={label}
      title={status === 'idle' ? 'Copy' : label}
      onClick={() => copy(text)}
    >
      <Icon name={status === 'copied' ? 'check' : 'copy'} size={12} />
    </motion.button>
  );
}
