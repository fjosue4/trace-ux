import { ReactNode, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Session } from '../../api';
import { fadeUp, spring } from '../../lib/motion';
import { formatCountry } from '../../lib/format';
import Card from '../ui/Card';
import { Icon } from '../ui/Icon';
import './replay.css';

const COLLAPSE_KEY = 'trace_ux_replay_meta_collapsed';

// Attribute/device facts about the session being replayed. It sits under the
// player as a compact two-row strip rather than in the sidebar, so the actions
// feed gets the full column height — and it collapses away entirely when the
// viewer wants more room for the recording.
export default function MetaCard({ session }: { session: Session }) {
  const s = session;
  const utm = [s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(' / ');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage blocked; the choice just does not persist */
    }
  }, [collapsed]);

  // Collapsed, the panel is gone entirely — no card, no padding, no reserved
  // height — so the player gets the space back. All that is left is the
  // control that brings it out again.
  if (collapsed) {
    return (
      <motion.button
        type="button"
        className="replay-meta-show"
        aria-expanded={false}
        title="Show session details"
        onClick={() => setCollapsed(false)}
        whileTap={{ scale: 0.96 }}
        transition={spring}
      >
        <Icon name="maximize" size={11} />
        Session details
      </motion.button>
    );
  }

  return (
    <Card className="replay-meta">
      <div className="replay-meta__bar">
        <span className="replay-meta__title">Session details</span>
        <motion.button
          type="button"
          className="icon-btn replay-meta__toggle"
          aria-expanded
          aria-label="Hide session details"
          title="Hide session details (gives the space back to the player)"
          onClick={() => setCollapsed(true)}
          whileTap={{ scale: 0.9 }}
          transition={spring}
        >
          <Icon name="minimize" size={12} />
        </motion.button>
      </div>
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
        <MetaBlock label="Country">{formatCountry(s.country)}</MetaBlock>
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
