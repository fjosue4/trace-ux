import type { CSSProperties } from 'react';
import { Icon } from '../ui/Icon';

export type InactivePeriod = { start: number; end: number };

type Props = {
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

const SPEEDS = [0.5, 1, 2, 4, 8];

function formatPlaybackTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export default function ReplayControls({
  currentTime,
  duration,
  isPlaying,
  skipInactive,
  isSkipping,
  speed,
  inactivePeriods,
  isFullscreen,
  onSeek,
  onTogglePlay,
  onSpeedChange,
  onToggleSkipInactive,
  onToggleFullscreen,
}: Props) {
  const safeDuration = Math.max(duration, 1);
  const safeTime = Math.min(Math.max(currentTime, 0), safeDuration);
  const progress = (safeTime / safeDuration) * 100;
  const timelineStyle = { '--replay-progress': `${progress}%` } as CSSProperties;

  return (
    <div className="replay-controls" aria-label="Replay controls">
      <div className="replay-controls__timeline">
        <span className="replay-controls__time" aria-label="Current time">
          {formatPlaybackTime(safeTime)}
        </span>
        <div className="replay-timeline">
          <div className="replay-timeline__inactive" aria-hidden="true">
            {inactivePeriods.map((period, index) => {
              const left = (period.start / safeDuration) * 100;
              const width = ((period.end - period.start) / safeDuration) * 100;
              return (
                <span
                  key={`${period.start}-${index}`}
                  className="replay-timeline__inactive-period"
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                  title="Inactive period"
                />
              );
            })}
          </div>
          <input
            className="replay-timeline__input"
            type="range"
            min={0}
            max={safeDuration}
            step={1}
            value={safeTime}
            style={timelineStyle}
            aria-label="Seek replay"
            onChange={(event) => onSeek(Number(event.target.value))}
          />
        </div>
        <span className="replay-controls__time replay-controls__time--end" aria-label="Total time">
          {formatPlaybackTime(safeDuration)}
        </span>
      </div>

      <div className="replay-controls__toolbar">
        <button
          type="button"
          className="replay-control-btn replay-control-btn--play"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause recording' : 'Play recording'}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size={15} />
        </button>

        <div className="replay-controls__group replay-controls__group--speed">
          <span className="replay-controls__label">Speed</span>
          <div className="replay-speed" role="group" aria-label="Playback speed">
            {SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                className={`replay-speed__option${speed === option ? ' is-active' : ''}`}
                onClick={() => onSpeedChange(option)}
                aria-pressed={speed === option}
              >
                {option}×
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className={`replay-skip${skipInactive ? ' is-active' : ''}${isSkipping ? ' is-skipping' : ''}`}
          onClick={onToggleSkipInactive}
          aria-pressed={skipInactive}
          title={skipInactive ? 'Skip inactive periods is on' : 'Skip inactive periods is off'}
        >
          <span className="replay-skip__icon">
            <Icon name="bolt" size={13} />
          </span>
          <span className="replay-skip__copy">
            <span className="replay-skip__label">Skip inactive</span>
            <span className="replay-skip__state">{isSkipping ? 'Catching up' : skipInactive ? 'On' : 'Off'}</span>
          </span>
        </button>

        <button
          type="button"
          className="replay-control-btn replay-control-btn--utility"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          <Icon name={isFullscreen ? 'minimize' : 'maximize'} size={15} />
        </button>
      </div>
    </div>
  );
}
