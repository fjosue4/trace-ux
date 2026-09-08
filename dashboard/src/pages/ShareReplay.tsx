import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import rrwebPlayer from 'rrweb-player';
import { EventType, IncrementalSource } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import 'rrweb-player/dist/style.css';
import { api, CustomEvent, SharedLog, SharedSession } from '../api';
import Loading from '../components/ui/Loading';
import Notice from '../components/ui/Notice';
import PagesPanel from '../components/replay/PagesPanel';
import ReplayControls, { type InactivePeriod } from '../components/replay/ReplayControls';
import { Icon } from '../components/ui/Icon';
import './Replay.css';

type PlayerLike = {
  play?: () => void;
  pause?: () => void;
  goto?: (offsetMs: number, playAfter?: boolean) => void;
  setSpeed?: (speed: number) => void;
  toggleSkipInactive?: () => void;
  addEventListener?: (event: string, handler: (payload?: unknown) => void) => void;
  getMetaData?: () => { totalTime: number };
  getReplayer?: () => {
    play?: (offsetMs?: number) => void;
    goto?: (offsetMs: number, playAfter?: boolean) => void;
    getCurrentTime?: () => number;
    on?: (event: string, handler: (payload?: unknown) => void) => void;
  };
};

function ratioFor(session: SharedSession): number {
  if (session.viewport_w > 0 && session.viewport_h > 0) {
    return Math.min(Math.max(session.viewport_h / session.viewport_w, 0.45), 1.1);
  }
  return 0.5625;
}

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

// Public viewer for the short-lived demo capability. It intentionally uses the
// same player chrome as the dashboard, but never mounts the authenticated app
// shell or requests the richer session metadata endpoints.
export default function ShareReplay() {
  const { token = '' } = useParams();
  const [session, setSession] = useState<SharedSession | null>(null);
  const [events, setEvents] = useState<eventWithTime[] | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('Loading events…');
  const [loaded, setLoaded] = useState(false);
  const [activity, setActivity] = useState<CustomEvent[]>([]);
  const [logs, setLogs] = useState<SharedLog[]>([]);
  const [hostWidth, setHostWidth] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [started, setStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [skipInactive, setSkipInactive] = useState(true);
  const [isSkipping, setIsSkipping] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerFrame = useRef<HTMLDivElement>(null);
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerLike | null>(null);
  const builtWidth = useRef(0);
  const speedRef = useRef(1);
  const skipInactiveRef = useRef(true);
  const firstTs = useRef(0);
  const inactivePeriods = useMemo(() => getInactivePeriods(events ?? []), [events]);

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
      player.current?.pause?.();
      player.current = null;
      builtWidth.current = 0;
    };
  }, [token]);

  useEffect(() => {
    const el = playerHost.current;
    if (!session || !el) return;
    const ro = new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width);
      if (width > 0) setHostWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [session]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === playerFrame.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!loaded || !events || events.length === 0 || !session || !playerHost.current) return;
    if (hostWidth < 240) return;
    if (player.current && Math.abs(hostWidth - builtWidth.current) < 60) return;

    let resumeAt = 0;
    const resumePlaying = isPlaying;
    if (player.current) {
      const replayer = player.current.getReplayer?.();
      const current = replayer && typeof replayer.getCurrentTime === 'function' ? replayer.getCurrentTime() : 0;
      if (typeof current === 'number' && current > 500) resumeAt = current;
      player.current.pause?.();
    }

    const width = hostWidth;
    const height = Math.round(width * ratioFor(session));
    builtWidth.current = width;
    playerHost.current.innerHTML = '';
    const nextPlayer = new rrwebPlayer({
      target: playerHost.current,
      props: {
        events,
        width,
        height,
        autoPlay: false,
        speed: speedRef.current,
        showController: false,
        skipInactive: skipInactiveRef.current,
        speedOption: [0.5, 1, 2, 4, 8],
      },
    }) as unknown as PlayerLike;
    player.current = nextPlayer;
    const eventDuration = Math.max(0, events[events.length - 1].timestamp - firstTs.current);
    let nextDuration = eventDuration;
    try {
      nextDuration = nextPlayer.getMetaData?.().totalTime ?? eventDuration;
    } catch {
      // The wrapper may expose metadata before the inner replayer mounts.
    }
    setDuration(nextDuration);
    setCurrentTime(resumeAt);
    setIsPlaying(resumePlaying && resumeAt > 0);

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
  }, [loaded, events, hostWidth, session, isPlaying]);

  const seekPlayer = useCallback((offsetMs: number) => {
    const target = Math.min(Math.max(0, offsetMs), duration || Number.MAX_SAFE_INTEGER);
    const core = player.current?.getReplayer ? player.current.getReplayer() : player.current;
    if (!core) return;
    if (typeof core.goto === 'function') core.goto(target, isPlaying);
    else core.play?.(target);
    setCurrentTime(target);
    setStarted(true);
  }, [duration, isPlaying]);

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
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.requestFullscreen();
  }

  function seekToOffset(offsetMs: number) {
    seekPlayer(offsetMs);
  }

  const playerReady = loaded && events !== null && events.length > 0;

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
            <div ref={playerFrame} className="player-frame">
              <div className="player-stage">
                <div ref={playerHost} className="player-host" />
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
                      <span className="player-cover__btn"><Icon name="play" size={26} /></span>
                      <span className="player-cover__label">Play recording</span>
                    </button>
                  )
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
          <PagesPanel
            session={session}
            activity={activity}
            logs={logs}
            eventsReady={loaded}
            firstTs={firstTs.current}
            onSeekMs={seekToOffset}
          />
        </div>
      )}
    </main>
  );
}
