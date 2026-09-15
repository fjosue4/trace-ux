import { motion } from 'motion/react';
import { spring } from '../../../lib/motion';
import { formatCountry } from '../../../lib/format';
import Card from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import { useMetaCard } from './hooks/useMetaCard';
import { MetaBlock } from './subcomponents/MetaBlock';
import { CopyButton } from './subcomponents/CopyButton';
import { MetaCardProps } from './MetaCard.types';
import '../replay.scss';

// Attribute/device facts about the session being replayed. It sits under the
// player as a compact two-row strip rather than in the sidebar, so the actions
// feed gets the full column height — and it collapses away entirely when the
// viewer wants more room for the recording.
export default function MetaCard({ session }: MetaCardProps) {
  const s = session;
  const utm = [s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(' / ');
  const { collapsed, setCollapsed } = useMetaCard();

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
