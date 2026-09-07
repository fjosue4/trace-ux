import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import rrwebPlayer from 'rrweb-player';
import type { eventWithTime } from '@rrweb/types';
import 'rrweb-player/dist/style.css';
import { api, Session, SessionPage } from '../api';
import { useUser } from '../App';
import PageHeader from '../components/ui/PageHeader';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import MetaCard from '../components/replay/MetaCard';
import PagesPanel from '../components/replay/PagesPanel';
import { Icon } from '../components/ui/Icon';
import './Replay.css';

type Meta = {
  session: Session;
  pages: SessionPage[];
  custom_events: { ts: number; name: string; track_id: string }[];
};

// The parts of the rrweb-player wrapper we need. Different builds expose
// seeking as goto()/play() on the wrapper or only on the core replayer.
type PlayerLike = {
  play?: (offsetMs?: number) => void;
  pause?: () => void;
  goto?: (offsetMs: number, playAfter?: boolean) => void;
  getReplayer?: () => {
    play?: (offsetMs?: number) => void;
    goto?: (offsetMs: number, playAfter?: boolean) => void;
    getCurrentTime?: () => number;
  };
};

// Player height follows the recorded viewport's aspect so the frame fills the
// page instead of letterboxing; clamped against extreme shapes.
function ratioFor(s?: Session): number {
  if (s && s.viewport_w > 0 && s.viewport_h > 0) {
    return Math.min(Math.max(s.viewport_h / s.viewport_w, 0.45), 1.1);
  }
  return 0.5625; // 16:9 fallback
}

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
  const [started, setStarted] = useState(autoplay);
  const [loaded, setLoaded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [hostWidth, setHostWidth] = useState(0);
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerLike | null>(null);
  const builtWidth = useRef(0);
  const firstTs = useRef(0); // client-clock ms of the first rrweb event
  const hasMeta = meta !== null;

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
      player.current = null;
      builtWidth.current = 0;
    };
  }, [sessionId]);

  // Track the player host's width so the recording can fill available space.
  useEffect(() => {
    const el = playerHost.current;
    if (!hasMeta || !el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setHostWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasMeta]);

  // Mount the player once sized; rebuild only when the host changes meaningfully
  // (window resizes), resuming at the current playback position.
  useEffect(() => {
    if (!loaded || !events || events.length === 0 || !playerHost.current) return;
    if (hostWidth < 240) return;
    if (player.current && Math.abs(hostWidth - builtWidth.current) < 60) return;

    // Preserve the position across rebuilds.
    let resumeAt = 0;
    if (player.current) {
      const rp = player.current.getReplayer?.();
      const t = rp && typeof rp.getCurrentTime === 'function' ? rp.getCurrentTime() : 0;
      if (typeof t === 'number' && t > 500) resumeAt = t;
    }

    const width = hostWidth;
    const height = Math.round(width * ratioFor(meta?.session)) + 2;
    builtWidth.current = width;
    playerHost.current.innerHTML = '';
    player.current = new rrwebPlayer({
      target: playerHost.current,
      props: {
        events,
        width,
        height,
        autoPlay: autoplay,
        speed: 1, // rrweb-player otherwise starts at the first speedOption
        showController: true,
        speedOption: [0.5, 1, 2, 4, 8],
      },
    }) as unknown as PlayerLike;

    if (resumeAt > 0) {
      player.current.play?.(resumeAt);
      setStarted(true);
    }
  }, [loaded, events, hostWidth, meta, autoplay]);

  // Seek to an offset (ms from the first recorded event) and keep playing.
  const seekToOffset = useCallback((offsetMs: number) => {
    const target = Math.max(0, offsetMs);
    const core = player.current?.getReplayer ? player.current.getReplayer() : player.current;
    if (!core) return;
    if (typeof core.goto === 'function') core.goto(target);
    else core.play?.(target);
    setStarted(true);
  }, []);

  // Pages and tracked activity are stamped with the visitor's clock; the first
  // rrweb event shares that clock, so offsets are relative to it.
  function seekToPage(page: SessionPage) {
    seekToOffset(page.entered_at * 1000 - firstTs.current);
  }

  function playFromStart() {
    player.current?.play?.(0);
    setStarted(true);
  }

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

  const { session, pages, custom_events: activity } = meta;
  const playerReady = loaded && events !== null && events.length > 0;

  return (
    <main className="page page--wide">
      <PageHeader
        title="Session replay"
        actions={
          <>
            {isAdmin && (
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
            )}
            <Link to="/sessions" className="btn btn--secondary btn--sm">
              ← All sessions
            </Link>
          </>
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
          <div className="player-frame">
            <div ref={playerHost} className="player-host" />
            {playerReady ? (
              !started && (
                <button className="player-cover" onClick={playFromStart} aria-label="Play recording">
                  <span className="player-cover__btn">
                    <Icon name="play" size={26} />
                  </span>
                  <span className="player-cover__label">Play recording</span>
                </button>
              )
            ) : (
              <Loading label={progress} overlay />
            )}
          </div>
        </div>
        <aside className="replay-side-col">
          <PagesPanel
            session={session}
            pages={pages}
            activity={activity}
            eventsReady={loaded}
            onSeekMs={seekToOffset}
            firstTs={firstTs.current}
          />
          <MetaCard session={session} />
        </aside>
      </div>
    </main>
  );
}
