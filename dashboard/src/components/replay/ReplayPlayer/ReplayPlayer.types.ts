import type { eventWithTime } from '@rrweb/types';

// The parts of the rrweb-player wrapper we need. Different builds expose
// seeking as goto()/play() on the wrapper or only on the core replayer.
export type PlayerLike = {
  getReplayer?: () => {
    getCurrentTime?: () => number;
    goto?: (timeOffset: number, play?: boolean) => void;
    play?: (timeOffset?: number) => void;
    pause?: (timeOffset?: number) => void;
    on?: (event: string, handler: (payload: unknown) => void) => void;
    destroy?: () => void;
  };
  goto?: (timeOffset: number, play?: boolean) => void;
  play?: (timeOffset?: number) => void;
  pause?: () => void;
  setSpeed?: (speed: number) => void;
  toggleSkipInactive?: () => void;
  getMetaData?: () => { totalTime: number };
  addEventListener?: (event: string, handler: (payload: unknown) => void) => void;
  // Feeds one more event to a player that is already running. This is what
  // makes windowed playback possible: the alternative is rebuilding the player
  // with a longer array, which re-parses everything loaded so far.
  addEvent?: (event: eventWithTime) => void;
  /** rrweb-player is a Svelte component and must be destroyed, not just detached. */
  $destroy?: () => void;
};

export type ReplayPlayerHandle = {
  /**
   * `fromLoader` marks the loader's own landing after a reposition. That seek
   * is clamped into the window and applied even while the loader is busy;
   * every other seek is routed back to the loader when it falls outside.
   */
  seekToOffset: (offsetMs: number, play?: boolean, fromLoader?: boolean) => void;
  /** Extend a running replay with newly fetched events, without rebuilding. */
  appendEvents: (events: eventWithTime[]) => void;
  /** Playback position in ms, for deciding when to fetch the next window. */
  currentOffset: () => number;
};

export type ReplayPlayerProps = {
  events: eventWithTime[] | null;
  loaded: boolean;
  progress: string;
  firstTs: number;
  autoplay?: boolean;
  fallbackW?: number;
  fallbackH?: number;
  onTimeChange?: (offsetMs: number) => void;
  onSeekOutsideBuffer?: (offsetMs: number) => void;
  /**
   * True length of the recording, from the seek index. The player only knows
   * about the events it holds, so with windowed loading its own metadata would
   * report the buffer's end as the end of the recording and the scrubber would
   * grow as you watch.
   */
  durationMs?: number;
  /** Fetching the next window while the playhead has caught up to the buffer. */
  buffering?: boolean;
  /**
   * The stream is being moved to another part of the recording. The player on
   * screen is about to be replaced, so seeks are queued behind the move.
   */
  repositioning?: boolean;
  /**
   * Changes when the event stream has been repositioned to a different part of
   * the recording (a seek past the buffer). The player must then rebuild from
   * the new window: its DOM belongs to the old one and cannot be carried over.
   */
  rebuildToken?: number;
  /**
   * Offset between the recording's start and the loaded window's start. rrweb
   * counts from its own first event, so after a jump every position it reports
   * is short by this much, and every seek it is given must have it removed.
   */
  windowStartMs?: number;
};
