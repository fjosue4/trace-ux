import type { CSSProperties } from 'react';
import { InactivePeriod } from '../ReplayControls.types';

function formatPlaybackTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

type TimelineProps = {
  currentTime: number;
  duration: number;
  inactivePeriods: InactivePeriod[];
  onSeek: (offsetMs: number) => void;
};

export function Timeline({ currentTime, duration, inactivePeriods, onSeek }: TimelineProps) {
  const safeDuration = Math.max(duration, 1);
  const safeTime = Math.min(Math.max(currentTime, 0), safeDuration);
  const progress = (safeTime / safeDuration) * 100;
  const timelineStyle = { '--replay-progress': `${progress}%` } as CSSProperties;

  return (
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
  );
}
