import { forwardRef } from 'react';
import 'rrweb-player/dist/style.css';
import Loading from '../../ui/Loading';
import EmptyState from '../../ui/EmptyState';
import Notice from '../../ui/Notice';
import { Icon } from '../../ui/Icon';
import ReplayControls from '../ReplayControls';
import { useReplayPlayer } from './hooks/useReplayPlayer';
import { PlayerCover } from './subcomponents/PlayerCover';
import { ReplayPlayerHandle, ReplayPlayerProps } from './ReplayPlayer.types';
import '../replay.scss';

// The rrweb player, its chrome and every piece of state around it. Both the
// dashboard replay and the public share page mount this, so playback, sizing
// and the recorded-viewport handling exist once rather than in two copies that
// drift apart.
const ReplayPlayer = forwardRef<ReplayPlayerHandle, ReplayPlayerProps>(function ReplayPlayer(props, ref) {
  const { progress, buffering } = props;
  const {
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
  } = useReplayPlayer(props, ref);

  return (
    <div ref={playerFrame} className="player-frame">
      {playerError && <Notice tone="error">{playerError}</Notice>}
      <div ref={playerStage} className="player-stage">
        {playerReady && <div ref={playerHost} className="player-host" />}
        {playerReady && started && (
          <button
            type="button"
            className="player-stage__toggle"
            onClick={togglePlayback}
            disabled={buffering}
            aria-label={isPlaying ? 'Pause recording' : 'Play recording'}
          />
        )}
        {playerReady && buffering && <Loading label="Buffering…" overlay />}
        {playerReady ? (
          !started && <PlayerCover onPlay={playFromStart} disabled={buffering} />
        ) : replayUnavailable ? (
          <EmptyState
            title="Replay unavailable"
            description={
              progress.startsWith('This recording has no complete snapshot')
                ? progress
                : 'This recording has fewer than two replay events, so there is nothing to play yet.'
            }
            icon={<Icon name="film" size={20} />}
          />
        ) : (
          <Loading label={progress} overlay />
        )}
      </div>
      {playerReady && (
        <ReplayControls
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          skipInactive={skipInactive}
          isSkipping={isSkipping}
          speed={speed}
          inactivePeriods={inactivePeriods}
          isFullscreen={isFullscreen}
          playDisabled={buffering}
          onSeek={seekPlayer}
          onTogglePlay={togglePlayback}
          onSpeedChange={changeSpeed}
          onToggleSkipInactive={toggleSkipInactive}
          onToggleFullscreen={toggleFullscreen}
        />
      )}
    </div>
  );
});

export default ReplayPlayer;
