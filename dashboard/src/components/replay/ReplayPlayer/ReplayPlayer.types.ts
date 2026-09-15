import type { eventWithTime } from '@rrweb/types';

// The parts of the rrweb-player wrapper we need. Different builds expose
// seeking as goto()/play() on the wrapper or only on the core replayer.
export type PlayerLike = {
  getReplayer?: () => {
    getCurrentTime?: () => number;
    goto?: (timeOffset: number, play?: boolean) => void;
    play?: (timeOffset?: number) => void;
    on?: (event: string, handler: (payload: unknown) => void) => void;
  };
  goto?: (timeOffset: number, play?: boolean) => void;
  play?: (timeOffset?: number) => void;
  pause?: () => void;
  setSpeed?: (speed: number) => void;
  toggleSkipInactive?: () => void;
  getMetaData?: () => { totalTime: number };
  addEventListener?: (event: string, handler: (payload: unknown) => void) => void;
};

export type ReplayPlayerHandle = {
  seekToOffset: (offsetMs: number) => void;
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
};
