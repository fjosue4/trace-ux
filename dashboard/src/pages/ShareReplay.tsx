import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { eventWithTime } from '@rrweb/types';
import { api, CustomEvent, SharedLog, SharedSession } from '../api';
import Loading from '../components/ui/Loading';
import Notice from '../components/ui/Notice';
import PagesPanel from '../components/replay/PagesPanel';
import ReplayPlayer, { type ReplayPlayerHandle } from '../components/replay/ReplayPlayer';
import './Replay.css';

// Public viewer for the short-lived demo capability. It mounts the same
// ReplayPlayer as the dashboard, but never the authenticated app shell, and
// never requests the richer session metadata endpoints.
export default function ShareReplay() {
  const { token = '' } = useParams();
  const [session, setSession] = useState<SharedSession | null>(null);
  const [events, setEvents] = useState<eventWithTime[] | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('Loading events…');
  const [loaded, setLoaded] = useState(false);
  const [activity, setActivity] = useState<CustomEvent[]>([]);
  const [logs, setLogs] = useState<SharedLog[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const firstTs = useRef(0);
  const playerRef = useRef<ReplayPlayerHandle>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await api.getSharedSession(token);
        if (cancelled) return;
        setSession(meta.session);
        setActivity(meta.custom_events);
        setLogs(meta.logs);
        const all: eventWithTime[] = [];
        let afterSeq = -1;
        for (;;) {
          const page = await api.getSharedEvents(token, afterSeq);
          all.push(...(page.events as eventWithTime[]));
          afterSeq = page.next_seq;
          setProgress(`Loaded ${all.length} events…`);
          if (!page.has_more) break;
          if (cancelled) return;
        }
        if (!cancelled) {
          firstTs.current = all[0]?.timestamp ?? 0;
          setEvents(all);
          setLoaded(true);
          if (all.length === 0) setProgress('This recording has no replay events yet.');
        }
      } catch {
        if (!cancelled) setError('This temporary replay link has expired or is unavailable.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);



  return (
    <main className="page page--wide share-replay-page">
      <div className="share-replay-intro">
        <p className="share-replay-eyebrow">Temporary Trace UX demo replay</p>
        <h1>Your visit</h1>
        <p className="muted">This private demo link is limited to this recording and expires automatically.</p>
      </div>
      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : !session ? (
        <Loading label={progress} />
      ) : (
        <div className="share-replay-layout">
          <div className="share-replay-player">
            <ReplayPlayer
              ref={playerRef}
              events={events}
              loaded={loaded}
              progress={progress}
              firstTs={firstTs.current}
              fallbackW={session.viewport_w}
              fallbackH={session.viewport_h}
              onTimeChange={setCurrentTime}
            />
          </div>
          <PagesPanel
            session={session}
            activity={activity}
            logs={logs}
            // Public bearer link: the visitor's page-by-page path is withheld
            // here for the same reason referrers and identity fields are.
            pages={[]}
            currentTimeMs={currentTime}
            eventsReady={loaded}
            firstTs={firstTs.current}
            onSeekMs={(ms) => playerRef.current?.seekToOffset(ms)}
          />
        </div>
      )}
    </main>
  );
}
