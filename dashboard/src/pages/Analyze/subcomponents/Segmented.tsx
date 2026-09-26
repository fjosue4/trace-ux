import classNames from 'classnames';

type SegmentedProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
  disabled?: boolean;
};

/** A small single-choice control, announced as a radio group. */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel, disabled }: SegmentedProps<T>) {
  return (
    <span className="analyze-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          className={classNames('analyze-segmented__option', { 'is-active': value === option.value })}
          onClick={() => onChange(option.value)}
        >
          <span className="analyze-segmented__label">{option.label}</span>
        </button>
      ))}
    </span>
  );
}
