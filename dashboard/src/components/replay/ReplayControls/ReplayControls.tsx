import { Icon } from '../../ui/Icon';
import { Timeline } from './subcomponents/Timeline';
import { SpeedControl } from './subcomponents/SpeedControl';
import { SkipInactive } from './subcomponents/SkipInactive';
import { ReplayControlsProps } from './ReplayControls.types';

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
}: ReplayControlsProps) {
  return (
    <div className="replay-controls" aria-label="Replay controls">
      <Timeline currentTime={currentTime} duration={duration} inactivePeriods={inactivePeriods} onSeek={onSeek} />

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

        <SpeedControl speed={speed} onSpeedChange={onSpeedChange} />

        <SkipInactive skipInactive={skipInactive} isSkipping={isSkipping} onToggle={onToggleSkipInactive} />

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
