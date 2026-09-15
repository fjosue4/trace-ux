import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { eventWithTime } from '@rrweb/types';
import { api, CustomEvent, SharedLog, SharedSession } from '../../../api';
import { ReplayPlayerHandle } from '../../../components/replay/ReplayPlayer';

export function useShareReplay() {
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

  return { session, events, error, progress, loaded, activity, logs, currentTime, setCurrentTime, firstTs, playerRef };
}
