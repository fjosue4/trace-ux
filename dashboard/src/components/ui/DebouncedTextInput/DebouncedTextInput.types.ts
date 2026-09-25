import type { InputHTMLAttributes } from 'react';

export type DebouncedTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onDebouncedChange: (value: string) => void;
  delayMs?: number;
  // True from the first keystroke until the typed value has been handed on,
  // so a caller can show that a search is on its way before it starts.
  onPendingChange?: (pending: boolean) => void;
};
