import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { eventWithTime } from '@rrweb/types';
import { api, Log, Session, SessionPage } from '../api';
import { useUser } from '../App';
import PageHeader from '../components/ui/PageHeader';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import MetaCard from '../components/replay/MetaCard';
import PagesPanel from '../components/replay/PagesPanel';
import ReplayPlayer, { type ReplayPlayerHandle } from '../components/replay/ReplayPlayer';
import { Icon } from '../components/ui/Icon';
import './Replay.css';

type Meta = {
  session: Session;
  pages: SessionPage[];
  custom_events: { ts: number; name: string; track_id: string }[];
  logs: Log[];
};

export default function Replay() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const isAdmin = user.role === 'admin';
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

  if (error) {
    return (
      <main className="page">
        <Notice tone="error">{error}</Notice>
      </main>
    );
  }
  if (!meta) {
    return (
      <main className="page">
        <Loading label={progress || 'Loading…'} />
      </main>
    );
  }

  const { session, custom_events: activity, logs } = meta;

  return (
    <main className="page page--wide">
      <PageHeader
        leading={
          <Link to="/sessions" className="btn btn--secondary btn--sm">
            ← All sessions
          </Link>
        }
        actions={
          isAdmin && (
            <Button
              variant="danger"
              size="sm"
              disabled={!!session.active}
              title={
                session.active
                  ? 'Recording is in progress — it can be deleted once completed'
                  : 'Delete recording'
              }
              onClick={() => setConfirmingDelete(true)}
            >
              <Icon name="trash" size={13} />
              Delete
            </Button>
          )
        }
      />

      {deleteError && <Notice tone="error">{deleteError}</Notice>}

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this recording?"
        description="This permanently removes the recording and all of its events. This cannot be undone."
        confirmLabel="Delete recording"
        busy={deleting}
        onConfirm={removeSession}
        onClose={() => setConfirmingDelete(false)}
      />

      <div className="replay-grid">
        <div className="replay-main">
          <ReplayPlayer
            ref={playerRef}
            events={events}
            loaded={loaded}
            progress={progress}
            firstTs={firstTs.current}
            autoplay={autoplay}
            fallbackW={session.viewport_w}
            fallbackH={session.viewport_h}
            onTimeChange={setCurrentTime}
          />
          <MetaCard session={session} />
        </div>
        <aside className="replay-side-col">
          <PagesPanel
            session={session}
            activity={activity}
            logs={logs}
            pages={meta.pages}
            eventsReady={loaded}
            currentTimeMs={currentTime}
            onSeekMs={(ms) => playerRef.current?.seekToOffset(ms)}
            firstTs={firstTs.current}
          />
        </aside>
      </div>
    </main>
  );
}
