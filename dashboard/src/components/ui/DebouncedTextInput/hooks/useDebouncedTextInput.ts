import { useEffect, useRef, useState } from 'react';

// Keeps typing responsive while delaying the value that drives filtering or
// other potentially expensive work. The input remains controlled so callers
// can reset or update it from outside without losing the current value.
export function useDebouncedTextInput(
  value: string,
  onDebouncedChange: (value: string) => void,
  delayMs: number,
  onPendingChange?: (pending: boolean) => void,
) {
  const [draft, setDraft] = useState(value);
  const lastExternalValue = useRef(value);
  const callbackRef = useRef(onDebouncedChange);
  const pendingRef = useRef(onPendingChange);

  useEffect(() => {
    callbackRef.current = onDebouncedChange;
    pendingRef.current = onPendingChange;
  }, [onDebouncedChange, onPendingChange]);

  const pending = draft !== value;
  useEffect(() => {
    pendingRef.current?.(pending);
  }, [pending]);

  // Unmounting mid-debounce must not leave the caller waiting on a value that
  // will never arrive.
  useEffect(() => () => pendingRef.current?.(false), []);

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

  return { draft, setDraft };
}
