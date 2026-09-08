import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import rrwebPlayer from 'rrweb-player';
import type { eventWithTime } from '@rrweb/types';
import 'rrweb-player/dist/style.css';
import { api, SharedSession } from '../api';

// Minimal public viewer. It deliberately has no dashboard chrome or controls
// that can mutate data, and the token is never copied into a third-party URL.
export default function ShareReplay() {
  const { token = '' } = useParams();
  const host = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<SharedSession | null>(null);
  const [events, setEvents] = useState<eventWithTime[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await api.getSharedSession(token);
        const all: eventWithTime[] = [];
        let after = -1;
        for (;;) {
          const page = await api.getSharedEvents(token, after);
          all.push(...(page.events as eventWithTime[]));
          after = page.next_seq;
          if (!page.has_more) break;
        }
        if (!cancelled) { setSession(meta.session); setEvents(all); }
      } catch { if (!cancelled) setError('This temporary replay link has expired or is unavailable.'); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!host.current || !session || events.length === 0) return;
    host.current.innerHTML = '';
    const width = Math.max(320, Math.min(host.current.clientWidth, 1280));
    const height = Math.round(width * (session.viewport_h > 0 && session.viewport_w > 0 ? session.viewport_h / session.viewport_w : 0.5625));
    const player = new rrwebPlayer({ target: host.current, props: { events, width, height, autoPlay: true, showController: true } });
    return () => { (player as any).pause?.(); };
  }, [session, events]);

  return <main style={{ minHeight: '100vh', background: '#f6f7fb', padding: '32px', color: '#182033', fontFamily: 'Inter, system-ui, sans-serif' }}>
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <p style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', opacity: .65 }}>Temporary TraceUX demo replay</p>
      <h1 style={{ margin: '8px 0 10px' }}>Your visit</h1>
      <p style={{ opacity: .72 }}>This private demo link is limited to this recording and expires automatically.</p>
      {error ? <p role="alert">{error}</p> : session && events.length === 0 ? <p>The recording is still being finalized. Refresh this page in a moment.</p> : <div ref={host} style={{ marginTop: 24, background: '#111827', borderRadius: 12, overflow: 'hidden' }} />}
    </div>
  </main>;
}
