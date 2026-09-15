import { Icon } from '../../../ui/Icon';

type SkipInactiveProps = {
  skipInactive: boolean;
  isSkipping: boolean;
  onToggle: () => void;
};

export function SkipInactive({ skipInactive, isSkipping, onToggle }: SkipInactiveProps) {
  return (
    <button
      type="button"
      className={`replay-skip${skipInactive ? ' is-active' : ''}${isSkipping ? ' is-skipping' : ''}`}
      onClick={onToggle}
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
  );
}
