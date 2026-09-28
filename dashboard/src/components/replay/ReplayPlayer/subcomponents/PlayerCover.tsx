import { Icon } from '../../../ui/Icon';

export function PlayerCover({ onPlay, disabled = false }: { onPlay: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="player-cover" onClick={onPlay} aria-label="Play recording" disabled={disabled}>
      <span className="player-cover__btn">
        <Icon name="play" size={26} />
      </span>
      <span className="player-cover__label">Play recording</span>
    </button>
  );
}
