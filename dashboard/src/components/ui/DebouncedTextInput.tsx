import { InputHTMLAttributes, useEffect, useRef, useState } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onDebouncedChange: (value: string) => void;
  delayMs?: number;
};

// Keeps typing responsive while delaying the value that drives filtering or
// other potentially expensive work. The input remains controlled so callers
// can reset or update it from outside without losing the current value.
export default function DebouncedTextInput({
  value,
  onDebouncedChange,
  delayMs = 250,
  ...props
}: Props) {
  const [draft, setDraft] = useState(value);
  const lastExternalValue = useRef(value);
  const callbackRef = useRef(onDebouncedChange);

  useEffect(() => {
    callbackRef.current = onDebouncedChange;
  }, [onDebouncedChange]);

  useEffect(() => {
    if (value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => {
      lastExternalValue.current = draft;
      callbackRef.current(draft);
    }, Math.max(0, delayMs));
    return () => window.clearTimeout(timer);
  }, [draft, value, delayMs]);

  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
    />
  );
}
