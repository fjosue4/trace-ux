import './Switch.css';

type Props = {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
};

export default function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <label className={`switch${disabled ? ' is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" aria-hidden>
        <span className="switch__knob" />
      </span>
      {label && <span className="switch__label">{label}</span>}
    </label>
  );
}
