import { useState } from 'react';
import { CustomEvent, Session, SessionPage } from '../../api';
import { fmtClock, fmtDuration, fmtTime } from '../../lib/format';
import Card from '../ui/Card';
import { Icon } from '../ui/Icon';
import './replay.css';

type Props = {
  session: Session;
  pages: SessionPage[];
  activity: CustomEvent[];
  eventsReady: boolean;
  firstTs: number; // client-clock ms of the first recorded event
  onSeekMs: (offsetMs: number) => void;
};

// Sidebar: visit summary, the clickable page timeline, and tracked activity
// (trace-ux-track-id clicks / window.TraceUX.track calls). Every row seeks the
// player to that moment.
export default function PagesPanel({ session, pages, activity, eventsReady, firstTs, onSeekMs }: Props) {
  const s = session;
  const [activePage, setActivePage] = useState<number | null>(pages[0]?.idx ?? null);

  return (
    <Card className="replay-side">
      <h3>{fmtDuration(s.duration_ms)} visit</h3>
      <p className="muted small">
        {fmtTime(s.started_at)} · {s.page_count} {s.page_count === 1 ? 'page' : 'pages'}
      </p>

      <h4>Pages visited</h4>
      <ol className="pages-list">
        {pages.map((p) => (
          <li key={p.idx}>
            <button
              className={`page-row${activePage === p.idx ? ' is-active' : ''}`}
              onClick={() => {
                setActivePage(p.idx);
                onSeekMs(p.entered_at * 1000 - firstTs);
              }}
              title={`Jump to ${p.url}`}
            >
              <span className="page-row__num">{p.idx + 1}</span>
              <span className="page-row__body">
                <span className="page-row__url">{p.url.replace(/^https?:\/\//, '')}</span>
                <span className="page-row__meta">
                  {p.title ? `${p.title} · ` : ''}
                  {fmtClock(p.entered_at)}
                  {p.left_at ? ` – ${fmtClock(p.left_at)}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {eventsReady && activity.length > 0 && (
        <>
          <h4>Tracked activity</h4>
          <ol className="pages-list">
            {activity.map((a, i) => (
              <li key={`${a.ts}-${i}`}>
                <button
                  className="page-row activity-row"
                  title={`Jump to ${a.track_id || a.name}`}
                  onClick={() => onSeekMs(a.ts - firstTs)}
                >
                  <span className="page-row__num activity-row__icon">
                    <Icon name="bolt" size={12} />
                  </span>
                  <span className="page-row__body">
                    <span className="page-row__url">{a.track_id || a.name}</span>
                    <span className="page-row__meta">{fmtClock(Math.floor(a.ts / 1000))}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
