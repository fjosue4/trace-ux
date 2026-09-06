import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import rrwebPlayer from 'rrweb-player';
import type { eventWithTime } from '@rrweb/types';
import 'rrweb-player/dist/style.css';
import { api, Session, SessionPage, fmtDuration, fmtTime, fmtClock } from '../api';

export default function Replay() {
  const { sessionId } = useParams();
  const [meta, setMeta] = useState<{ session: Session; pages: SessionPage[] } | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('Loading events…');
  const playerHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    (async () => {
      try {
        const m = await api.getSession(sessionId);
        if (cancelled) return;
        setMeta(m);

        // Load the full event stream in pages, then hand it to the player.
        const events: eventWithTime[] = [];
        let afterSeq = -1;
        for (;;) {
          const res = await api.getEvents(sessionId, afterSeq);
          events.push(...(res.events as eventWithTime[]));
          afterSeq = res.next_seq;
          setProgress(`Loaded ${events.length} events…`);
          if (!res.has_more) break;
          if (cancelled) return;
        }
        if (cancelled || events.length === 0 || !playerHost.current) {
          if (events.length === 0) setProgress('This session has no recorded events yet.');
          return;
        }

        setProgress('');
        playerHost.current.innerHTML = '';
        new rrwebPlayer({
          target: playerHost.current,
          props: {
            events,
            width: playerHost.current.clientWidth,
            height: Math.round((playerHost.current.clientWidth * 9) / 16),
            autoPlay: true,
            showController: true,
            speedOption: [0.5, 1, 2, 4, 8],
          },
        });
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (error) {
    return (
      <main className="page">
        <div className="error">{error}</div>
      </main>
    );
  }
  if (!meta) {
    return (
      <main className="page">
        <div className="loading">{progress || 'Loading…'}</div>
      </main>
    );
  }

  const { session: s, pages } = meta;

  return (
    <main className="page replay-layout">
      <div className="page-head">
        <h1>Session replay</h1>
        <Link to={`/site/${s.site_id}`} className="muted">
          ← All sessions
        </Link>
      </div>

      <div className="replay-grid">
        <div className="replay-main">
          <div className="player-frame">
            <div ref={playerHost} className="player-host" />
            {!progress ? null : <div className="loading overlay">{progress}</div>}
          </div>
          <div className="card replay-meta">
            <div className="kv">
              <span className="muted">Entry</span>
              <a href={s.initial_url} target="_blank" rel="noreferrer">
                {s.initial_url}
              </a>
            </div>
            <div className="kv">
              <span className="muted">Referrer</span>
              {s.referrer || 'direct'}
            </div>
            <div className="kv-row">
              <div className="kv">
                <span className="muted">Device</span>
                {s.device}
              </div>
              <div className="kv">
                <span className="muted">Browser</span>
                {s.browser}
              </div>
              <div className="kv">
                <span className="muted">OS</span>
                {s.os}
              </div>
              <div className="kv">
                <span className="muted">Viewport</span>
                {s.viewport_w}×{s.viewport_h}
              </div>
              <div className="kv">
                <span className="muted">Screen</span>
                {s.screen_w}×{s.screen_h}
              </div>
            </div>
            {(s.utm_source || s.utm_medium || s.utm_campaign) && (
              <div className="kv">
                <span className="muted">UTM</span>
                {[s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(' / ')}
              </div>
            )}
          </div>
        </div>

        <aside className="card replay-side">
          <h3>{fmtDuration(s.duration_ms)} visit</h3>
          <p className="muted small">
            {fmtTime(s.started_at)} · {s.page_count} {s.page_count === 1 ? 'page' : 'pages'}
          </p>
          <h4>Pages visited</h4>
          <ol className="pages-list">
            {pages.map((p) => (
              <li key={p.idx}>
                <div className="page-url" title={p.url}>
                  {p.url.replace(/^https?:\/\//, '')}
                </div>
                <div className="muted small">
                  {p.title ? `${p.title} · ` : ''}
                  {fmtClock(p.entered_at)}
                  {p.left_at ? ` – ${fmtClock(p.left_at)}` : ''}
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </main>
  );
}
