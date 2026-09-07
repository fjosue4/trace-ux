import { useState } from 'react';
import { motion } from 'motion/react';
import { CustomEvent, Session, SessionPage } from '../../api';
import { fmtClock, fmtDuration, fmtTime } from '../../lib/format';
import { spring, stagger } from '../../lib/motion';
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
      <motion.ol className="pages-list" variants={stagger} initial="hidden" animate="visible">
        {pages.map((p) => (
          <motion.li key={p.idx} variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}>
            <motion.button
              className={`page-row${activePage === p.idx ? ' is-active' : ''}`}
              onClick={() => {
                setActivePage(p.idx);
                onSeekMs(p.entered_at * 1000 - firstTs);
              }}
              title={`Jump to ${p.url}`}
              whileHover={{ x: 3 }}
              whileTap={{ scale: 0.985 }}
              transition={spring}
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
            </motion.button>
          </motion.li>
        ))}
      </motion.ol>

      {eventsReady && activity.length > 0 && (
        <>
          <h4>Tracked activity</h4>
          <ol className="pages-list">
            {activity.map((a, i) => (
              <li key={`${a.ts}-${i}`}>
                <motion.button
                  className="page-row activity-row"
                  title={`Jump to ${a.track_id || a.name}`}
                  onClick={() => onSeekMs(a.ts - firstTs)}
                  whileHover={{ x: 3 }}
                  whileTap={{ scale: 0.985 }}
                  transition={spring}
                >
                  <span className="page-row__num activity-row__icon">
                    <Icon name="bolt" size={12} />
                  </span>
                  <span className="page-row__body">
                    <span className="page-row__url">{a.track_id || a.name}</span>
                    <span className="page-row__meta">{fmtClock(Math.floor(a.ts / 1000))}</span>
                  </span>
                </motion.button>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
