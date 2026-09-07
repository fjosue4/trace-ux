import { ReactNode, useState } from 'react';
import { motion } from 'motion/react';
import { Session } from '../../api';
import { fadeUp, spring } from '../../lib/motion';
import Card from '../ui/Card';
import { Icon } from '../ui/Icon';
import './replay.css';

// Attribute/device facts about the session being replayed, as a label/value grid.
export default function MetaCard({ session }: { session: Session }) {
  const s = session;
  const utm = [s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(' / ');

  return (
    <Card className="replay-meta">
      <div className="meta-grid">
        <MetaBlock label="Entry" wide>
          <span className="meta-value-row">
            <a className="meta-clamp2" href={s.initial_url} target="_blank" rel="noreferrer">
              {s.initial_url}
            </a>
            <CopyButton text={s.initial_url} />
          </span>
        </MetaBlock>
        <MetaBlock label="Referrer" wide>
          <span className="meta-value-row">
            <span className="meta-oneline" title={s.referrer || 'direct'}>
              {s.referrer || 'direct'}
            </span>
            {s.referrer && <CopyButton text={s.referrer} />}
          </span>
        </MetaBlock>
        <MetaBlock label="Device">{s.device}</MetaBlock>
        <MetaBlock label="Browser">{s.browser}</MetaBlock>
        <MetaBlock label="OS">{s.os}</MetaBlock>
        <MetaBlock label="Viewport">
          {s.viewport_w}×{s.viewport_h}
        </MetaBlock>
        <MetaBlock label="Screen">
          {s.screen_w}×{s.screen_h}
        </MetaBlock>
        {utm && <MetaBlock label="UTM">{utm}</MetaBlock>}
        {s.user_id && <MetaBlock label="User">{s.user_id}</MetaBlock>}
        {s.client_id && <MetaBlock label="Client">{s.client_id}</MetaBlock>}
        {s.remote_id && <MetaBlock label="Remote">{s.remote_id}</MetaBlock>}
      </div>
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
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

function MetaBlock({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div className={`meta-block${wide ? ' meta-block--wide' : ''}`} variants={fadeUp} initial="hidden" animate="visible">
      <span className="meta-block__label">{label}</span>
      <span className="meta-block__value">{children}</span>
    </motion.div>
  );
}
