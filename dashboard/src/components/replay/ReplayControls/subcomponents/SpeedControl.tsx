const SPEEDS = [0.5, 1, 2, 4, 8];

type SpeedControlProps = {
  speed: number;
  onSpeedChange: (speed: number) => void;
};

export function SpeedControl({ speed, onSpeedChange }: SpeedControlProps) {
  return (
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
  );
}
