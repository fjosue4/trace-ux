import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { eventWithTime } from '@rrweb/types';
import { api, Log, Session, SessionPage } from '../../../api';
import { ReplayPlayerHandle } from '../../../components/replay/ReplayPlayer';

type Meta = {
  session: Session;
  pages: SessionPage[];
  custom_events: { ts: number; name: string; track_id: string }[];
  logs: Log[];
};

export function useReplay() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const autoplay = params.get('autoplay') === '1';
  const [meta, setMeta] = useState<Meta | null>(null);
  const [events, setEvents] = useState<eventWithTime[] | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('Loading events…');
  const [loaded, setLoaded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const firstTs = useRef(0); // client-clock ms of the first rrweb event
  const playerRef = useRef<ReplayPlayerHandle>(null);

  // Load metadata + the full event stream, paged from the server.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    (async () => {
      try {
        const m = await api.getSession(sessionId);
        if (cancelled) return;
        setMeta(m);

        const all: eventWithTime[] = [];
        let afterSeq = -1;
        for (;;) {
          const res = await api.getEvents(sessionId, afterSeq);
          all.push(...(res.events as eventWithTime[]));
          afterSeq = res.next_seq;
          setProgress(`Loaded ${all.length} events…`);
          if (!res.has_more) break;
          if (cancelled) return;
        }
        firstTs.current = all[0]?.timestamp ?? 0;
        setEvents(all);
        setLoaded(true);
        if (all.length === 0) setProgress('This session has no recorded events yet.');
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function removeSession() {
    if (!sessionId) return;
    setDeleting(true);
    try {
      await api.deleteSession(sessionId);
      navigate('/sessions');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete the recording.');
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return {
    meta,
    events,
    error,
    progress,
    loaded,
    autoplay,
    confirmingDelete,
    setConfirmingDelete,
    deleting,
    deleteError,
    currentTime,
    setCurrentTime,
    firstTs,
    playerRef,
    removeSession,
  };
}
