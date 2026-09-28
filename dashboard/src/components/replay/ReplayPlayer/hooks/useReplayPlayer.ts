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

// How often playback may push its position into React state.
//
// rrweb reports the playhead on every animation frame. Each report re-renders
// the whole replay page, and at ~60 per second those urgent renders kept
// interrupting React Router's navigation, which it renders as a low-priority
// transition: clicking away from a playing recording left the page on screen
// for about 8 seconds, until React forced the starved navigation through. The
// scrubber, clock and active sidebar row read fine at 5 updates per second.
// Seeks, pauses and the end of the buffer still report the exact position.
const TIME_REPORT_INTERVAL_MS = 200;

export function useReplayPlayer(
  {
    events,
    loaded,
    firstTs,
    autoplay = false,
    fallbackW = 0,
    fallbackH = 0,
    onTimeChange,
    onSeekOutsideBuffer,
    durationMs,
    buffering = false,
    repositioning = false,
    rebuildToken = 0,
    windowStartMs = 0,
  }: ReplayPlayerProps,
  ref: React.Ref<ReplayPlayerHandle>,
) {
  const [playerError, setPlayerError] = useState('');
  const [started, setStarted] = useState(autoplay);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [currentTime, setCurrentTimeState] = useState(0);
  const [duration, setDuration] = useState(0);
  const builtToken = useRef(0); // rebuildToken the current player was built for
  const waitingAtBufferEnd = useRef<number | null>(null);
  const wantsToPlay = useRef(autoplay);
  // All times in this hook's state are RECORDING time. rrweb speaks window
  // time, so conversion happens at exactly two boundaries: the position it
  // reports, and the position we ask it to seek to.
  //
  // Both use the window the CURRENT player was built from, not the prop. After
  // a jump the parent hands over the new window's start in the same render as
  // the new events, but the old player keeps running until the rebuild effect
  // replaces it. Converting its clock with the new offset reported positions
  // from a different part of the recording, which is what sent the scrubber
  // jumping backwards through unrelated times and could trigger another jump.
  const builtWindowStart = useRef(0);
  // Recording time of the last event the current player holds, kept in step
  // with appended pages. Same reason: the events prop can already describe
  // the next window while this player still holds the previous one.
  const builtEnd = useRef(0);
  const repositioningRef = useRef(repositioning);
  repositioningRef.current = repositioning;
  // Playback paused only because the playhead caught up with the buffer.
  const resumeAfterBuffering = useRef(false);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [skipInactive, setSkipInactive] = useState(!durationMs);
  const [isSkipping, setIsSkipping] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const playerFrame = useRef<HTMLDivElement>(null);
  const playerStage = useRef<HTMLDivElement>(null);
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerLike | null>(null);
  const builtStage = useRef({ width: 0, height: 0 });
  const speedRef = useRef(1);
  const skipInactiveRef = useRef(!durationMs);

  const disposePlayer = useCallback((instance: PlayerLike | null) => {
    if (!instance) return;
    try {
      instance.pause?.();
    } catch {
      // Continue teardown even if the player is already detached.
    }
    try {
      instance.getReplayer?.()?.destroy?.();
    } catch {
      // rrweb may already have removed its wrapper.
    }
    try {
      instance.$destroy?.();
    } catch {
      // The Svelte component may already be destroyed.
    }
  }, []);

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
      disposePlayer(player.current);
      player.current = null;
      builtStage.current = { width: 0, height: 0 };
    },
    [disposePlayer],
  );

  // A seek outside the loaded window is not playable until its snapshot and
  // following mutations have arrived. Pause without clearing wantsToPlay: an
  // automatic rolling-window refresh resumes explicitly once the rebuild is
  // ready, while a user seek stays paused.
  //
  // A stall is different: the playhead simply caught up with the buffer while
  // the operator was watching. Once the next page is in, carry on playing
  // instead of leaving a paused player that looks stuck. A jump never resumes
  // from here; the loader's landing seek decides whether it plays.
  useEffect(() => {
    if (buffering) {
      if (!repositioningRef.current && wantsToPlay.current && player.current) resumeAfterBuffering.current = true;
      player.current?.pause?.();
      setIsPlaying(false);
      return;
    }
    if (!resumeAfterBuffering.current) return;
    resumeAfterBuffering.current = false;
    // A rebuild committed in this same render owns the position.
    if (repositioningRef.current || rebuildToken !== builtToken.current) return;
    const wrapper = player.current;
    if (!wrapper || !wantsToPlay.current) return;
    const rp = wrapper.getReplayer?.();
    const t = rp && typeof rp.getCurrentTime === 'function' ? rp.getCurrentTime() : 0;
    const at = typeof t === 'number' ? t : 0;
    if (typeof wrapper.goto === 'function') wrapper.goto(at, true);
    else wrapper.play?.(at);
    setIsPlaying(true);
    // rebuildToken is read to detect a same-render rebuild, not to re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffering]);

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
    // A repositioned stream must rebuild even though the box has not moved:
    // the events the player holds are no longer the events it should be
    // showing. Everything else still skips the rebuild, so ordinary appends
    // and re-renders do not tear the player down.
    const repositioned = rebuildToken !== builtToken.current;
    if (
      !repositioned &&
      player.current &&
      Math.abs(stageSize.width - builtStage.current.width) < 60 &&
      Math.abs(stageSize.height - builtStage.current.height) < 60
    ) {
      return;
    }
    builtToken.current = rebuildToken;
    if (repositioned) {
      waitingAtBufferEnd.current = null;
      resumeAfterBuffering.current = false;
    }

    // A reposition starts at the new window's own beginning; resuming the old
    // clock would land somewhere the freshly loaded events do not cover.
    let resumeAt = 0;
    const resumePlaying = repositioned ? false : isPlaying;
    const previousPlayer = player.current;
    if (previousPlayer && !repositioned) {
      const rp = previousPlayer.getReplayer?.();
      const t = rp && typeof rp.getCurrentTime === 'function' ? rp.getCurrentTime() : 0;
      if (typeof t === 'number' && t > 500) resumeAt = t;
      previousPlayer.pause?.();
    }

    const ratio = ratioFor(events, { w: fallbackW, h: fallbackH });
    const width = stageSize.height
      ? Math.min(stageSize.width, Math.floor(stageSize.height / ratio))
      : stageSize.width;
    const height = Math.round(width * ratio);
    builtStage.current = { width: stageSize.width, height: stageSize.height };
    disposePlayer(previousPlayer);
    player.current = null;
    playerHost.current.innerHTML = '';
    let nextPlayer: PlayerLike;
    try {
      nextPlayer = new rrwebPlayer({
        target: playerHost.current,
        props: {
          events,
          width,
          height,
          autoPlay: !repositioned && autoplay && !resumeAt,
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
    // This player's own window, fixed for its lifetime (see builtWindowStart).
    const playerWindowStart = windowStartMs;
    builtWindowStart.current = playerWindowStart;
    builtEnd.current = events[events.length - 1].timestamp - firstTs;
    const eventDuration = Math.max(0, events[events.length - 1].timestamp - firstTs);
    let nextDuration = eventDuration;
    try {
      nextDuration = nextPlayer.getMetaData?.().totalTime ?? eventDuration;
    } catch {
      // The wrapper exposes getMetaData before its inner replayer is mounted.
    }
    // The index knows the real length; the player only knows its buffer. Trust
    // the index so the scrubber is full-length from the first frame.
    if (durationMs && durationMs > nextDuration) nextDuration = durationMs;
    setDuration(nextDuration);
    setCurrentTime(playerWindowStart + resumeAt);
    setIsPlaying(autoplay && !resumeAt ? true : resumePlaying && resumeAt > 0);

    // The rrweb wrapper emits UI events for the current position and player
    // state. Register after its Svelte controller has mounted, and ignore
    // callbacks from a player that has since been replaced by a resize.
    const listenerTimer = window.setTimeout(() => {
      if (player.current !== nextPlayer) return;
      try {
        const fromPlayer = nextPlayer.getMetaData?.().totalTime ?? eventDuration;
        // Never shrink below the indexed length. The player's metadata covers
        // only the events it currently holds, so with windowed loading this
        // would otherwise reset the scrubber to the boot window every time a
        // player is built.
        setDuration(Math.max(fromPlayer, durationMs ?? 0));
      } catch {
        // The event-derived duration is already in state.
      }
      let lastReportedAt = 0;
      nextPlayer.addEventListener?.('ui-update-current-time', (payload) => {
        if (player.current !== nextPlayer) return;
        const value = (payload as { payload?: unknown } | undefined)?.payload;
        if (typeof value !== 'number') return;
        const now = performance.now();
        if (now - lastReportedAt < TIME_REPORT_INTERVAL_MS) return;
        lastReportedAt = now;
        setCurrentTime(playerWindowStart + value);
      });
      nextPlayer.addEventListener?.('ui-update-player-state', (payload) => {
        if (player.current !== nextPlayer) return;
        const value = (payload as { payload?: unknown } | undefined)?.payload;
        if (value === 'playing' || value === 'paused') {
          setIsPlaying(value === 'playing');
          if (value === 'playing') setStarted(true);
          // The throttled clock can trail the real position; settle it exactly
          // wherever playback stopped, so a resume starts from the right frame.
          if (value === 'paused') {
            const rp = nextPlayer.getReplayer?.();
            const t = rp && typeof rp.getCurrentTime === 'function' ? rp.getCurrentTime() : null;
            if (typeof t === 'number') setCurrentTime(playerWindowStart + t);
          }
        }
      });
      nextPlayer.getReplayer?.()?.on?.('state-change', (state) => {
        if (player.current !== nextPlayer) return;
        const value = (state as { speed?: { value?: unknown } } | undefined)?.speed?.value;
        setIsSkipping(value === 'skipping');
      });
      nextPlayer.getReplayer?.()?.on?.('finish', () => {
        if (player.current !== nextPlayer) return;
        const end = builtEnd.current;
        if (durationMs && end < durationMs && wantsToPlay.current) {
          waitingAtBufferEnd.current = end;
          setCurrentTime(end);
        }
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
  }, [loaded, events, stageSize, autoplay, firstTs, fallbackW, fallbackH, durationMs, rebuildToken, windowStartMs, disposePlayer]);

  // The index can resolve after the player is built; widen the scrubber then
  // rather than leaving it showing only the boot window.
  useEffect(() => {
    if (durationMs) setDuration((d) => (durationMs > d ? durationMs : d));
  }, [durationMs]);

  // rrweb treats the last event currently held as the end of the recording.
  // When a later page arrives, resume from that boundary once addEvent has
  // delivered the new events to its internal queue.
  useEffect(() => {
    const stoppedAt = waitingAtBufferEnd.current;
    if (stoppedAt == null || !events?.length || !wantsToPlay.current) return;
    if (events[events.length - 1].timestamp - firstTs <= stoppedAt) return;
    const timer = window.setTimeout(() => {
      if (waitingAtBufferEnd.current !== stoppedAt || !wantsToPlay.current) return;
      waitingAtBufferEnd.current = null;
      player.current?.goto?.(Math.max(0, stoppedAt - builtWindowStart.current), true);
      setIsPlaying(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [events, firstTs]);

  const seekToOffset = useCallback(
    (offsetMs: number, play = isPlaying, fromLoader = false) => {
      const wrapper = player.current;
      if (!wrapper) return;
      waitingAtBufferEnd.current = null;
      resumeAfterBuffering.current = false;
      const start = builtWindowStart.current;
      const end = builtEnd.current;
      // The loader's own landing seek is final. Its window can open a moment
      // after the chunk the index pointed at (a keyframe chunk carries events
      // from before its snapshot), so the target may sit just before this
      // window. Bouncing it back to the loader as "outside" asked for the same
      // keyframe again, which landed on the same target again: an endless
      // loop with no network activity, stuck on Buffering. Clamp instead.
      const target = fromLoader
        ? Math.min(Math.max(offsetMs, start), Math.max(start, end))
        : Math.max(0, offsetMs);
      // While the stream is being repositioned, the player on screen belongs
      // to the old window and is about to be replaced. Moving it would be
      // undone by the reposition landing, so queue the seek behind it instead.
      const loaderBusy = !fromLoader && repositioningRef.current;
      // Ask the loader for an outside target before calling rrweb. Its goto()
      // treats positions past the current buffer as the end of the recording.
      if (loaderBusy || target < start || target > end) {
        wrapper.pause?.();
        wantsToPlay.current = false;
        setIsPlaying(false);
        setCurrentTimeState(target);
        onSeekOutsideBuffer?.(target);
        return;
      }
      const inWindow = Math.max(0, target - start);
      if (typeof wrapper.goto === 'function') wrapper.goto(inWindow, play);
      else if (play) wrapper.play?.(inWindow);
      else wrapper.getReplayer?.()?.pause?.(inWindow);
      wantsToPlay.current = play;
      setIsPlaying(play);
      setCurrentTime(target);
      setStarted(true);
    },
    [isPlaying, onSeekOutsideBuffer, setCurrentTime],
  );

  const appendEvents = useCallback(
    (more: eventWithTime[]) => {
      const p = player.current;
      if (!p?.addEvent || more.length === 0) return;
      for (const e of more) p.addEvent(e);
      builtEnd.current = Math.max(builtEnd.current, more[more.length - 1].timestamp - firstTs);
    },
    [firstTs],
  );

  const currentOffset = useCallback(() => {
    const rp = player.current?.getReplayer?.();
    const t = rp && typeof rp.getCurrentTime === 'function' ? rp.getCurrentTime() : 0;
    return typeof t === 'number' ? t : 0;
  }, []);

  useImperativeHandle(
    ref,
    () => ({ seekToOffset, appendEvents, currentOffset }),
    [seekToOffset, appendEvents, currentOffset],
  );

  function playFromStart() {
    if (buffering) return;
    wantsToPlay.current = true;
    if (player.current?.goto) player.current.goto(0, true);
    else player.current?.play?.();
    setCurrentTime(builtWindowStart.current);
    setStarted(true);
    setIsPlaying(true);
  }

  function togglePlayback() {
    if (buffering) return;
    if (isPlaying) {
      wantsToPlay.current = false;
      waitingAtBufferEnd.current = null;
      player.current?.pause?.();
      setIsPlaying(false);
      // State is throttled during playback; record where it actually stopped.
      setCurrentTime(builtWindowStart.current + currentOffset());
      return;
    }
    wantsToPlay.current = true;
    const target = duration > 0 && currentTime >= duration ? builtWindowStart.current : currentTime;
    if (player.current?.goto) player.current.goto(Math.max(0, target - builtWindowStart.current), true);
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
