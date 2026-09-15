export type InactivePeriod = { start: number; end: number };

export type ReplayControlsProps = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  skipInactive: boolean;
  isSkipping: boolean;
  speed: number;
  inactivePeriods: InactivePeriod[];
  isFullscreen: boolean;
  onSeek: (offsetMs: number) => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
  onToggleSkipInactive: () => void;
  onToggleFullscreen: () => void;
};
