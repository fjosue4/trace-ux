import { useDebouncedTextInput } from './hooks/useDebouncedTextInput';
import { DebouncedTextInputProps } from './DebouncedTextInput.types';

export default function DebouncedTextInput({
  value,
  onDebouncedChange,
  delayMs = 840,
  onPendingChange,
  ...props
}: DebouncedTextInputProps) {
  const { draft, setDraft } = useDebouncedTextInput(value, onDebouncedChange, delayMs, onPendingChange);

  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
    />
  );
}
