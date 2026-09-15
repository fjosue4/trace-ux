import type { InputHTMLAttributes } from 'react';

export type DebouncedTextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onDebouncedChange: (value: string) => void;
  delayMs?: number;
};
