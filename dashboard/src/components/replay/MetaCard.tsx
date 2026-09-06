import { ReactNode } from 'react';
import { Session } from '../../api';
import Card from '../ui/Card';
import './replay.css';

// Attribute/device facts about the session being replayed, as a label/value grid.
export default function MetaCard({ session }: { session: Session }) {
  const s = session;
  const utm = [s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(' / ');

  return (
    <Card className="replay-meta">
      <div className="meta-grid">
        <MetaBlock label="Entry" wide>
          <a href={s.initial_url} target="_blank" rel="noreferrer">
            {s.initial_url}
          </a>
        </MetaBlock>
        <MetaBlock label="Referrer">{s.referrer || 'direct'}</MetaBlock>
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
    <div className={`meta-block${wide ? ' meta-block--wide' : ''}`}>
      <span className="meta-block__label">{label}</span>
      <span className="meta-block__value">{children}</span>
    </div>
  );
}
