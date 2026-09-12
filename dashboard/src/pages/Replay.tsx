import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import rrwebPlayer from 'rrweb-player';
import { EventType, IncrementalSource } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import 'rrweb-player/dist/style.css';
import { api, Log, Session } from '../api';
import { useUser } from '../App';
import PageHeader from '../components/ui/PageHeader';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import MetaCard from '../components/replay/MetaCard';
import PagesPanel from '../components/replay/PagesPanel';
import ReplayControls, { type InactivePeriod } from '../components/replay/ReplayControls';
import { Icon } from '../components/ui/Icon';
import './Replay.css';

type Meta = {
  session: Session;
  custom_events: { ts: number; name: string; track_id: string }[];
  logs: Log[];
};

// The parts of the rrweb-player wrapper we need. Different builds expose
// seeking as goto()/play() on the wrapper or only on the core replayer.
type PlayerLike = {
  play?: () => void;
  pause?: () => void;
  goto?: (offsetMs: number, playAfter?: boolean) => void;
  toggle?: () => void;
  setSpeed?: (speed: number) => void;
  toggleSkipInactive?: () => void;
  toggleFullscreen?: () => void;
  addEventListener?: (event: string, handler: (payload?: unknown) => void) => void;
  getMetaData?: () => { totalTime: number };
  getReplayer?: () => {
    play?: (offsetMs?: number) => void;
    pause?: (offsetMs?: number) => void;
    goto?: (offsetMs: number, playAfter?: boolean) => void;
    getCurrentTime?: () => number;
    on?: (event: string, handler: (payload?: unknown) => void) => void;
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

// Match rrweb-player's inactivity heuristic so the custom timeline can show
// the same gaps that the skip-inactive control fast-forwards over.
function getInactivePeriods(events: eventWithTime[]): InactivePeriod[] {
  if (events.length < 2) return [];

  const first = events[0].timestamp;
  let lastActive = first;
  const periods: InactivePeriod[] = [];

  for (const event of events) {
    if (event.type !== EventType.IncrementalSnapshot) continue;
    const source = event.data.source;
    if (source <= IncrementalSource.Mutation || source > IncrementalSource.Input) continue;
    if (event.timestamp - lastActive > 10_000) {
      periods.push({ start: lastActive - first, end: event.timestamp - first });
    }
    lastActive = event.timestamp;
  }

  return periods;
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
  const [playerError, setPlayerError] = useState('');
  const [progress, setProgress] = useState('Loading events…');
  const [started, setStarted] = useState(autoplay);
  const [loaded, setLoaded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [skipInactive, setSkipInactive] = useState(true);
  const [isSkipping, setIsSkipping] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerFrame = useRef<HTMLDivElement>(null);
  const playerStage = useRef<HTMLDivElement>(null);
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerLike | null>(null);
  const builtWidth = useRef(0);
  const speedRef = useRef(1);
  const skipInactiveRef = useRef(true);
  const firstTs = useRef(0); // client-clock ms of the first rrweb event
  const hasMeta = meta !== null;
  const inactivePeriods = useMemo(() => getInactivePeriods(events ?? []), [events]);

  // Load metadata + the full event stream, paged from the server.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    (async () => {
      try {
        const m = await api.getSession(sessionId);
        if (cancelled) return;
        setMeta(m);
        setPlayerError('');

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
      player.current?.pause?.();
      player.current = null;
      builtWidth.current = 0;
    };
  }, [sessionId]);

  // Track the stage's available box so desktop replays can fit both the
  // recording and its controls inside the viewport without cropping it.
  useEffect(() => {
    const el = playerStage.current;
    if (!hasMeta || !el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const next = { width: Math.round(width), height: Math.round(height) };
      if (next.width > 0 && next.height > 0) {
        setStageSize((current) => (
          current.width === next.width && current.height === next.height ? current : next
        ));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasMeta]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === playerFrame.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Mount the player once sized; rebuild only when the host changes meaningfully
  // (window resizes), resuming at the current playback position.
  useEffect(() => {
    // rrweb-player throws when it receives fewer than two events. Keep the
    // empty/unavailable state in React instead of letting that exception take
    // down the entire replay route.
    if (!loaded || !events || events.length < 2 || !playerHost.current) return;
    if (stageSize.width < 240) return;

    const isDesktop = window.matchMedia('(min-width: 961px)').matches;
    const ratio = ratioFor(meta?.session);
    const width = isDesktop && stageSize.height > 0
      ? Math.min(stageSize.width, Math.floor(stageSize.height / ratio))
      : stageSize.width;
    if (width < 240) return;
    if (player.current && Math.abs(width - builtWidth.current) < 60) return;

    // Preserve the position and playback state across responsive rebuilds.
    let resumeAt = 0;
    const resumePlaying = isPlaying;
    if (player.current) {
      const rp = player.current.getReplayer?.();
      const t = rp && typeof rp.getCurrentTime === 'function' ? rp.getCurrentTime() : 0;
      if (typeof t === 'number' && t > 500) resumeAt = t;
      player.current.pause?.();
    }

    const height = Math.round(width * ratio);
    builtWidth.current = width;
    playerHost.current.innerHTML = '';
    let nextPlayer: PlayerLike;
    try {
      nextPlayer = new rrwebPlayer({
        target: playerHost.current,
        props: {
          events,
          width,
          height,
          autoPlay: autoplay && !resumeAt,
          speed: speedRef.current,
          showController: false,
          skipInactive: skipInactiveRef.current,
          speedOption: [0.5, 1, 2, 4, 8],
        },
      }) as unknown as PlayerLike;
    } catch {
      builtWidth.current = 0;
      player.current = null;
      setPlayerError('This recording is not available for replay.');
      return;
    }
    player.current = nextPlayer;
    const eventDuration = Math.max(0, events[events.length - 1].timestamp - firstTs.current);
    let nextDuration = eventDuration;
    try {
      nextDuration = nextPlayer.getMetaData?.().totalTime ?? eventDuration;
    } catch {
      // The wrapper exposes getMetaData before its inner replayer is mounted.
    }
    setDuration(nextDuration);
    setCurrentTime(resumeAt);
    setIsPlaying(autoplay && !resumeAt ? true : resumePlaying && resumeAt > 0);

    // The rrweb wrapper emits UI events for the current position and player
    // state. Register after its Svelte controller has mounted, and ignore
    // callbacks from a player that has since been replaced by a resize.
    const listenerTimer = window.setTimeout(() => {
      if (player.current !== nextPlayer) return;
      try {
        setDuration(nextPlayer.getMetaData?.().totalTime ?? eventDuration);
      } catch {
        // The event-derived duration is already in state.
      }
      nextPlayer.addEventListener?.('ui-update-current-time', (payload) => {
        if (player.current !== nextPlayer) return;
        const value = (payload as { payload?: unknown } | undefined)?.payload;
        if (typeof value === 'number') setCurrentTime(value);
      });
      nextPlayer.addEventListener?.('ui-update-player-state', (payload) => {
        if (player.current !== nextPlayer) return;
        const value = (payload as { payload?: unknown } | undefined)?.payload;
        if (value === 'playing' || value === 'paused') {
          setIsPlaying(value === 'playing');
          if (value === 'playing') setStarted(true);
        }
      });

      nextPlayer.getReplayer?.()?.on?.('state-change', (state) => {
        if (player.current !== nextPlayer) return;
        const value = (state as { speed?: { value?: unknown } } | undefined)?.speed?.value;
        setIsSkipping(value === 'skipping');
      });
    }, 0);

    if (resumeAt > 0) {
      nextPlayer.goto?.(resumeAt, resumePlaying);
      setStarted(true);
    }

    return () => window.clearTimeout(listenerTimer);
  }, [loaded, events, stageSize, meta, autoplay]);

  // Seek to an offset (ms from the first recorded event) and keep playing.
  const seekToOffset = useCallback((offsetMs: number) => {
    const target = Math.max(0, offsetMs);
    const core = player.current?.getReplayer ? player.current.getReplayer() : player.current;
    if (!core) return;
    if (typeof core.goto === 'function') core.goto(target, isPlaying);
    else core.play?.(target);
    setCurrentTime(target);
    setStarted(true);
  }, [isPlaying]);

  function playFromStart() {
    if (player.current?.goto) player.current.goto(0, true);
    else player.current?.play?.();
    setCurrentTime(0);
    setStarted(true);
    setIsPlaying(true);
  }

  function togglePlayback() {
    if (isPlaying) {
      player.current?.pause?.();
      setIsPlaying(false);
      return;
    }

    const target = duration > 0 && currentTime >= duration ? 0 : currentTime;
    if (player.current?.goto) player.current.goto(target, true);
    else player.current?.play?.();
    setCurrentTime(target);
    setStarted(true);
    setIsPlaying(true);
  }

  function seekPlayer(offsetMs: number) {
    const target = Math.min(Math.max(0, offsetMs), duration || Number.MAX_SAFE_INTEGER);
    const core = player.current?.getReplayer ? player.current.getReplayer() : player.current;
    if (!core) return;
    if (typeof core.goto === 'function') core.goto(target, isPlaying);
    else core.play?.(target);
    setCurrentTime(target);
    setStarted(true);
  }

  function changeSpeed(nextSpeed: number) {
    speedRef.current = nextSpeed;
    player.current?.setSpeed?.(nextSpeed);
    setSpeed(nextSpeed);
  }

  function toggleSkipInactive() {
    const nextValue = !skipInactive;
    skipInactiveRef.current = nextValue;
    player.current?.toggleSkipInactive?.();
    setSkipInactive(nextValue);
  }

  function toggleFullscreen() {
    const frame = playerFrame.current;
    if (!frame) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void frame.requestFullscreen();
    }
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

  const { session, custom_events: activity, logs } = meta;
  const playerReady = loaded && events !== null && events.length >= 2 && !playerError;
  const replayUnavailable = loaded && events !== null && (events.length < 2 || !!playerError);

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
          <div ref={playerFrame} className="player-frame">
            <div ref={playerStage} className="player-stage">
              {playerReady && <div ref={playerHost} className="player-host" />}
              {playerReady && started && (
                <button
                  type="button"
                  className="player-stage__toggle"
                  onClick={togglePlayback}
                  aria-label={isPlaying ? 'Pause recording' : 'Play recording'}
                />
              )}
              {playerReady ? (
                !started && (
                  <button type="button" className="player-cover" onClick={playFromStart} aria-label="Play recording">
                    <span className="player-cover__btn">
                      <Icon name="play" size={26} />
                    </span>
                    <span className="player-cover__label">Play recording</span>
                  </button>
                )
              ) : replayUnavailable ? (
                <EmptyState
                  title="Replay unavailable"
                  description={playerError || 'This recording has fewer than two replay events, so there is nothing to play yet.'}
                  icon={<Icon name="film" size={20} />}
                />
              ) : (
                <Loading label={progress} overlay />
              )}
            </div>
            {playerReady && (
              <ReplayControls
                currentTime={currentTime}
                duration={duration}
                isPlaying={isPlaying}
                skipInactive={skipInactive}
                isSkipping={isSkipping}
                speed={speed}
                inactivePeriods={inactivePeriods}
                isFullscreen={isFullscreen}
                onSeek={seekPlayer}
                onTogglePlay={togglePlayback}
                onSpeedChange={changeSpeed}
                onToggleSkipInactive={toggleSkipInactive}
                onToggleFullscreen={toggleFullscreen}
              />
            )}
          </div>
        </div>
        <aside className="replay-side-col">
          <PagesPanel
            session={session}
            activity={activity}
            logs={logs}
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
