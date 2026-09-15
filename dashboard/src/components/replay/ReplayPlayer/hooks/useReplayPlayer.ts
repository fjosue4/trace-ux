import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import rrwebPlayer from 'rrweb-player';
import { EventType, IncrementalSource } from '@rrweb/types';
import type { eventWithTime } from '@rrweb/types';
import { InactivePeriod } from '../../ReplayControls';
import { PlayerLike, ReplayPlayerHandle, ReplayPlayerProps } from '../ReplayPlayer.types';

// The recording is the authority on its own dimensions. A visit that spans a
// window resize (or several page loads at different sizes) carries one Meta
// event per size plus ViewportResize events inside a page, and the player box
// must fit the largest of them — sizing from the session row instead lets the
// later, wider frames overflow their box, which is what makes the replayed
// cursor land away from whatever it actually clicked.
export function metaViewport(events: eventWithTime[]): { w: number; h: number } | null {
  let w = 0;
  let h = 0;
  for (const e of events) {
    const d =
      e.type === 4
        ? (e.data as { width?: number; height?: number })
        : e.type === 3 && (e.data as { source?: number }).source === 4
          ? (e.data as unknown as { width?: number; height?: number })
          : null;
    if (!d) continue;
    if (d.width && d.width > w) w = d.width;
    if (d.height && d.height > h) h = d.height;
  }
  return w > 0 && h > 0 ? { w, h } : null;
}

function ratioFor(events: eventWithTime[] | null, fallback?: { w: number; h: number }): number {
  const meta = events && events.length ? metaViewport(events) : null;
  const w = meta?.w ?? fallback?.w ?? 0;
  const h = meta?.h ?? fallback?.h ?? 0;
  if (w > 0 && h > 0) return Math.min(Math.max(h / w, 0.45), 1.1);
  return 0.5625; // 16:9 fallback
}

// Match rrweb-player's inactivity heuristic so the custom timeline can show
// the same gaps that the skip-inactive control fast-forwards over.
export function getInactivePeriods(events: eventWithTime[]): InactivePeriod[] {
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

export function useReplayPlayer(
  { events, loaded, firstTs, autoplay = false, fallbackW = 0, fallbackH = 0, onTimeChange }: ReplayPlayerProps,
  ref: React.Ref<ReplayPlayerHandle>,
) {
  const [playerError, setPlayerError] = useState('');
  const [started, setStarted] = useState(autoplay);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [currentTime, setCurrentTimeState] = useState(0);
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
  const builtStage = useRef({ width: 0, height: 0 });
  const speedRef = useRef(1);
  const skipInactiveRef = useRef(true);

  const inactivePeriods = useMemo(() => getInactivePeriods(events ?? []), [events]);

  const setCurrentTime = useCallback(
    (value: number) => {
      setCurrentTimeState(value);
      onTimeChange?.(value);
    },
    [onTimeChange],
  );

  // Track the stage's available box so desktop replays can fit both the
  // recording and its controls inside the viewport without cropping it.
  //
  // Measured directly first, then observed. A ResizeObserver alone is not
  // enough: the share page's stage is sized by its content, so before a player
  // exists it is 1039x0 and the observer has no size change to report — the
  // player would wait forever for a box that only appears once it is built.
  useLayoutEffect(() => {
    const el = playerStage.current;
    if (!el) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    if (next.width > 0) {
      setStageSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    }
  }, [loaded]);

  useEffect(() => {
    const el = playerStage.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const next = { width: Math.round(width), height: Math.round(height) };
      // Width is the only hard requirement. The dashboard constrains the stage
      // vertically so the recording and its controls both fit on screen, but
      // the share page lets it size to content — there, height is 0 and the
      // build below simply treats the box as unconstrained. Requiring both
      // deadlocks that page: no height, so no player, so no height.
      if (next.width > 0) {
        setStageSize((current) =>
          current.width === next.width && current.height === next.height ? current : next,
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === playerFrame.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(
    () => () => {
      player.current?.pause?.();
      player.current = null;
      builtStage.current = { width: 0, height: 0 };
    },
    [],
  );

  // Mount the player once sized; rebuild only when the host changes meaningfully
  // (window resizes), resuming at the current playback position.
  useEffect(() => {
    // rrweb-player throws when it receives fewer than two events. Keep the
    // empty/unavailable state in React instead of letting that exception take
    // down the whole route.
    if (!loaded || !events || events.length < 2 || !playerHost.current) return;
    if (stageSize.width < 240) return;
    // Rebuild whenever the box the player fits into has moved meaningfully in
    // either dimension, not just width — a sibling (the session-details card)
    // can change .player-stage's height after the first measurement without
    // touching its width, and a width-only check left a stale, wrongly-scaled
    // player sized for a box that no longer exists.
    if (
      player.current &&
      Math.abs(stageSize.width - builtStage.current.width) < 60 &&
      Math.abs(stageSize.height - builtStage.current.height) < 60
    ) {
      return;
    }

    let resumeAt = 0;
    const resumePlaying = isPlaying;
    if (player.current) {
      const rp = player.current.getReplayer?.();
      const t = rp && typeof rp.getCurrentTime === 'function' ? rp.getCurrentTime() : 0;
      if (typeof t === 'number' && t > 500) resumeAt = t;
      player.current.pause?.();
    }

    const ratio = ratioFor(events, { w: fallbackW, h: fallbackH });
    const width = stageSize.height
      ? Math.min(stageSize.width, Math.floor(stageSize.height / ratio))
      : stageSize.width;
    const height = Math.round(width * ratio);
    builtStage.current = { width: stageSize.width, height: stageSize.height };
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
      builtStage.current = { width: 0, height: 0 };
      player.current = null;
      setPlayerError('This recording is not available for replay.');
      return;
    }
    player.current = nextPlayer;
    const eventDuration = Math.max(0, events[events.length - 1].timestamp - firstTs);
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
    // isPlaying/setCurrentTime are read for resume only; rebuilding on either
    // would tear the player down mid-playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, events, stageSize, autoplay, firstTs, fallbackW, fallbackH]);

  const seekToOffset = useCallback(
    (offsetMs: number) => {
      const target = Math.max(0, offsetMs);
      const core = player.current?.getReplayer ? player.current.getReplayer() : player.current;
      if (!core) return;
      if (typeof core.goto === 'function') core.goto(target, isPlaying);
      else core.play?.(target);
      setCurrentTime(target);
      setStarted(true);
    },
    [isPlaying, setCurrentTime],
  );

  useImperativeHandle(ref, () => ({ seekToOffset }), [seekToOffset]);

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
    seekToOffset(Math.min(Math.max(0, offsetMs), duration || Number.MAX_SAFE_INTEGER));
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

  const playerReady = loaded && events !== null && events.length >= 2 && !playerError;
  const replayUnavailable = loaded && events !== null && (events.length < 2 || !!playerError);

  return {
    playerFrame,
    playerStage,
    playerHost,
    playerError,
    started,
    currentTime,
    duration,
    isPlaying,
    skipInactive,
    isSkipping,
    speed,
    isFullscreen,
    inactivePeriods,
    playerReady,
    replayUnavailable,
    playFromStart,
    togglePlayback,
    seekPlayer,
    changeSpeed,
    toggleSkipInactive,
    toggleFullscreen,
  };
}

export type UseReplayPlayerResult = ReturnType<typeof useReplayPlayer>;
