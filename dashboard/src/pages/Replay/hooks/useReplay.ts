import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { eventWithTime } from '@rrweb/types';
import { api, CustomEvent, Feedback, Log, Session, SessionPage, Ticket } from '../../../api';
import { loadCSSAssets, rehydrateCSS } from '../../../lib/cssAssets';
import { ReplayPlayerHandle } from '../../../components/replay/ReplayPlayer';
import { forgetCachedSession } from '../../Sessions/hooks/useSessions';

type Meta = {
  session: Session;
  pages: SessionPage[];
  custom_events: CustomEvent[];
  logs: Log[];
  tickets: Ticket[];
  feedback: Feedback[];
};

// Opened from the sessions list, the way back returns to that list with its
// filters; opened from anywhere else, it falls back to the unfiltered list.
function sessionsListFrom(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/sessions') ? from : '/sessions';
}

export function useReplay() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const backTo = sessionsListFrom(useLocation().state);
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

  // ---- Windowed playback ----
  //
  // Playback used to download the whole recording before the first frame: 83
  // sequential requests and 125 MB parsed for a 24-minute visit, which is where
  // the CPU spike came from. Now it boots on the first few seconds and fetches
  // the rest as the playhead approaches, the way a video player buffers.
  //
  // Events already fetched are kept, so rewinding and re-watching costs nothing
  // and nothing is requested twice.

  /** Keep this much playable time ahead of the playhead. */
  const BUFFER_AHEAD_MS = 15_000;
  /** Start fetching once the playhead is this close to the end of the buffer. */
  const PREFETCH_WITHIN_MS = 5_000;

  const allEvents = useRef<eventWithTime[]>([]); // everything fetched, in order
  const nextSeq = useRef(-1); // resume point for the next page
  const exhausted = useRef(false); // server has no more chunks
  const haveSnapshot = useRef(false); // a FullSnapshot has been loaded
  // The in-flight request itself, not a boolean. A flag lets a caller that
  // finds a fetch already running return immediately, and a loop awaiting that
  // return spins without yielding -- which is what froze the tab on a long
  // forward seek. Sharing the promise makes "wait for the current page" mean it.
  const inFlight = useRef<Promise<boolean> | null>(null);
  const pumping = useRef(false); // one catch-up loop at a time
  const seekIndex = useRef<{ seq: number; first_ts: number; snapshot: boolean }[]>([]);
  // Where the user actually asked to go, held until the rebuilt player exists.
  const pendingSeek = useRef<number | null>(null);
  // A seek that arrived while the loader was busy. Dropping it is what made
  // clicking an action in the sidebar do nothing until the third or fourth try:
  // a prefetch is in flight for much of playback, and the seek landed in that
  // window. Queued instead, and drained when the loader frees up.
  const queuedSeek = useRef<number | null>(null);
  // True while the stream is being repositioned. Pages fetched during a
  // reposition belong to the player that is about to be built, NOT to the one
  // still on screen showing a different part of the recording -- feeding them
  // to it replays mutations against a DOM that never contained those nodes.
  const repositioning = useRef(false);
  // The keyframe the current window starts at, so a second seek that resolves
  // to the same keyframe reloads nothing and, crucially, cannot loop.
  const windowSeq = useRef<number | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  // Bumped when the stream is repositioned, to force the player to rebuild from
  // the new window rather than keep its old DOM.
  const [rebuildToken, setRebuildToken] = useState(0);
  const [seekReadyToken, setSeekReadyToken] = useState(0);
  // Where the loaded window begins, relative to the start of the recording.
  // rrweb treats its first event as t=0, so after a jump its clock is window
  // relative while the scrubber speaks in recording time. This is the offset
  // between the two.
  const [windowStartMs, setWindowStartMs] = useState(0);

  /** Playable milliseconds currently held, measured from the first event. */
  const bufferedMs = () => {
    const evs = allEvents.current;
    if (evs.length === 0) return 0;
    return evs[evs.length - 1].timestamp - firstTs.current;
  };

  const fetchNextPage = useRef(async (): Promise<boolean> => false);
  const jumpTo = useRef(async (_offsetMs: number): Promise<void> => {});

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    // Reset per-session so navigating between recordings cannot mix streams.
    allEvents.current = [];
    nextSeq.current = -1;
    exhausted.current = false;
    haveSnapshot.current = false;
    inFlight.current = null;
    pumping.current = false;
    repositioning.current = false;
    windowSeq.current = null;
    pendingSeek.current = null;
    queuedSeek.current = null;
    seekIndex.current = [];

    const loadPage = async (): Promise<boolean> => {
      if (exhausted.current || cancelled) return false;
      const res = await api.getEvents(sessionId, nextSeq.current);
      if (cancelled) return false;
      // Stylesheets resolve before the events reach rrweb. Each distinct sheet
      // is fetched once per tab, then served from the browser cache.
      const assets = await loadCSSAssets(res.events);
      if (cancelled) return false;
      rehydrateCSS(res.events, assets);
      const page = res.events as eventWithTime[];
      // Only ever set from the first page of the session: after a jump the
      // window starts later, but every offset in this hook is measured from the
      // start of the RECORDING, not from the start of the window.
      if (firstTs.current === 0 && page.length > 0) {
        firstTs.current = page[0].timestamp;
      }
      if (!haveSnapshot.current && page.some((e) => e.type === 2)) haveSnapshot.current = true;
      allEvents.current.push(...page);
      nextSeq.current = res.next_seq;
      if (!res.has_more) exhausted.current = true;
      if (!repositioning.current && playerRef.current && page.length) {
        playerRef.current.appendEvents(page);
      }
      // Keep the prop in step with what the player has actually been fed. The
      // player is rebuilt on resize from this array, so if it held only the
      // boot window the rebuilt player would be missing every appended event --
      // and later mutations would reference nodes it never created, which is
      // exactly the "Node with id N not found" the replayer reports.
      if (!cancelled) setEvents([...allEvents.current]);
      return !exhausted.current;
    };

    fetchNextPage.current = () => {
      if (inFlight.current) return inFlight.current;
      const p = loadPage().finally(() => {
        inFlight.current = null;
      });
      inFlight.current = p;
      return p;
    };

    // Reposition the stream to cover a target that is past the buffer.
    //
    // Streaming every intervening page would be both slow and pointless: rrweb
    // rebuilds its whole DOM from a FullSnapshot, so everything between the
    // buffer and the nearest preceding snapshot is work whose result is thrown
    // away. Jump to that snapshot instead -- the index exists for this.
    jumpTo.current = async (offsetMs: number) => {
      const idx = seekIndex.current;
      if (idx.length === 0) return;
      const t0 = firstTs.current;
      let target = null as null | { seq: number };
      for (const c of idx) {
        if (!c.snapshot) continue;
        if (c.first_ts - t0 <= offsetMs) target = c;
        else break;
      }
      if (!target) return;
      // A seek within the current keyframe can extend this player in place.
      // Wait for enough events, then apply the seek after React has delivered
      // the new event prop to the child handle.
      if (windowSeq.current === target.seq) {
        for (let guard = 0; guard < 200 && !exhausted.current && bufferedMs() < offsetMs + BUFFER_AHEAD_MS; guard++) {
          const more = await fetchNextPage.current();
          if (!more || cancelled) break;
        }
        if (cancelled) return;
        pendingSeek.current = Math.min(offsetMs, bufferedMs());
        setSeekReadyToken((n) => n + 1);
        return;
      }
      await inFlight.current?.catch(() => {});
      if (cancelled) return;

      repositioning.current = true;

      allEvents.current = [];
      haveSnapshot.current = false;
      exhausted.current = false;
      nextSeq.current = target.seq - 1;

      try {
        for (let guard = 0; guard < 200; guard++) {
          const more = await fetchNextPage.current();
          if (cancelled) return;
          if (!haveSnapshot.current) continue;
          if (allEvents.current.length >= 2 && bufferedMs() >= offsetMs + BUFFER_AHEAD_MS) break;
          if (!more) break;
        }
      } finally {
        repositioning.current = false;
      }
      if (cancelled) return;

      // Start at the snapshot, discarding old DOM mutations before it. Keep the
      // preceding Meta event: rrweb uses it to size and reveal its iframe.
      // Without that event the timeline advances but the replay stays blank.
      //
      // A chunk is not aligned to checkouts: on this recording the keyframe
      // chunk held 87 incremental events before its FullSnapshot. Those
      // describe the DOM as it was *before* the jump, so replaying them against
      // a tree that does not exist yet is what produced hundreds of
      // "Node with id N not found" warnings.
      const firstSnap = allEvents.current.findIndex((e) => e.type === 2);
      if (firstSnap > 0) {
        const before = allEvents.current.slice(0, firstSnap);
        const viewport = before.reverse().find((e) => e.type === 4);
        allEvents.current = viewport
          ? [viewport, ...allEvents.current.slice(firstSnap)]
          : allEvents.current.slice(firstSnap);
      }
      if (allEvents.current.length === 0) return;

      windowSeq.current = target.seq;
      setWindowStartMs(allEvents.current[0].timestamp - firstTs.current);
      setEvents([...allEvents.current]);
      // The window opens at the keyframe, which can be well before the point
      // that was asked for -- 41s earlier on this recording. Remember the real
      // target and land on it once the rebuilt player is mounted.
      pendingSeek.current = offsetMs;
      setRebuildToken((n) => n + 1);
    };

    (async () => {
      try {
        // Metadata and the seek table are both small and independent.
        const [m, idx] = await Promise.all([
          api.getSession(sessionId),
          api.getSessionIndex(sessionId).catch(() => null),
        ]);
        if (cancelled) return;
        setMeta(m);
        if (idx) {
          seekIndex.current = idx.chunks;
          if (idx.first_ts) firstTs.current = idx.first_ts;
          if (idx.last_ts > idx.first_ts) setDurationMs(idx.last_ts - idx.first_ts);
        }
        // No index, no windowing.
        //
        // Without it the loader cannot know the recording's real length or
        // where to jump, so it would report the boot window as the whole
        // recording -- a 200-minute visit shown as 27 minutes, with seeking
        // confined to the first slice. Falling back to loading everything is
        // slower but correct, and it is what this page did before windowing
        // existed. Reached when the endpoint is missing, which is exactly the
        // case of a cached new frontend talking to an older server.
        const windowed = idx !== null && idx.chunks.length > 0;

        // Boot window: enough to start playing, not the whole recording.
        // Bounded, so a recording that never yields a snapshot cannot spin.
        for (let guard = 0; guard < 500; guard++) {
          const more = await fetchNextPage.current();
          if (cancelled) return;
          setProgress(`Loaded ${allEvents.current.length} events…`);
          if (!more) break;
          // rrweb builds the DOM from a FullSnapshot and renders nothing before
          // it sees one, so boot must reach a keyframe however long that takes.
          // On a real recording the first snapshot was in chunk 6, not chunk 1:
          // the tracker batches, and a snapshot dwarfs the events around it.
          if (!haveSnapshot.current) continue;
          if (!windowed) continue; // load the whole recording
          if (allEvents.current.length >= 2 && bufferedMs() >= BUFFER_AHEAD_MS) break;
        }

        setEvents([...allEvents.current]);
        setLoaded(true);
        if (allEvents.current.length === 0) setProgress('This session has no recorded events yet.');
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Reposition for a seek, serialising against whatever the loader is doing.
  //
  // A seek is a direct instruction from the operator and must never be lost, so
  // one that arrives mid-pump is held and run next rather than discarded. Only
  // the most recent is kept: dragging the scrubber emits a stream of positions
  // and only the one it was released on matters.
  const runSeek = useRef((_offsetMs: number) => {});
  const drainSeek = () => {
    const q = queuedSeek.current;
    queuedSeek.current = null;
    if (q != null) runSeek.current(q);
  };
  runSeek.current = (offsetMs: number) => {
    if (pumping.current) {
      queuedSeek.current = offsetMs;
      return;
    }
    pumping.current = true;
    setBuffering(true);
    void jumpTo.current(offsetMs).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      pumping.current = false;
      setBuffering(false);
      drainSeek();
    });
  };

  const onSeekOutsideBuffer = useCallback((offsetMs: number) => {
    setCurrentTime(offsetMs);
    runSeek.current(offsetMs);
  }, []);

  // Apply a deferred seek once the repositioned player has been built.
  //
  // Effects in a parent run after the child's, so by the time this fires
  // ReplayPlayer has already rebuilt against the new window and the offset is
  // meaningful. Skipped on the first render, when nothing has been repositioned.
  useEffect(() => {
    if (rebuildToken === 0 && seekReadyToken === 0) return;
    const target = pendingSeek.current;
    pendingSeek.current = null;
    if (target == null) return;
    playerRef.current?.seekToOffset(target, false);
  }, [rebuildToken, seekReadyToken]);

  // The buffering decision, driven by playback position.
  //
  // Deliberately quiet: `buffering` only becomes true once the playhead has
  // actually reached the end of what is loaded. Fetching ahead of that happens
  // silently, which is the difference between a player that feels smooth and
  // one that flashes a spinner every few seconds.
  const onPlaybackTime = useCallback((offsetMs: number) => {
    setCurrentTime(offsetMs);
    // Nothing to do when everything is already loaded.
    if (seekIndex.current.length === 0 && exhausted.current) return;
    const buffered = bufferedMs();
    // Prefetching is the only thing that may be skipped while busy: another
    // pump is already doing the same work.
    if (pumping.current || exhausted.current) return;
    const ahead = buffered - offsetMs;
    if (ahead <= 0) setBuffering(true);
    if (ahead > PREFETCH_WITHIN_MS) return;

    pumping.current = true;
    void (async () => {
      try {
        // Bounded. A page is 400 events, which on a busy recording can be under
        // a second, so several may be needed -- but never an unbounded number.
        for (let i = 0; i < 40; i++) {
          if (exhausted.current) break;
          if (bufferedMs() - offsetMs >= BUFFER_AHEAD_MS) break;
          const more = await fetchNextPage.current();
          if (!more) break;
        }
      } finally {
        pumping.current = false;
        setBuffering(false);
        drainSeek();
      }
    })().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  async function removeSession() {
    if (!sessionId) return;
    setDeleting(true);
    try {
      await api.deleteSession(sessionId);
      forgetCachedSession(sessionId);
      navigate(backTo);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete the recording.');
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return {
    backTo,
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
    onPlaybackTime,
    onSeekOutsideBuffer,
    buffering,
    durationMs,
    rebuildToken,
    windowStartMs,
  };
}
