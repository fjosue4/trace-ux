import { useCallback, useEffect, useState } from 'react';

export type ClipboardCopyStatus = 'idle' | 'copied' | 'failed';

// How long a copy button shows its result before returning to its icon.
const RESULT_MS = 2000;

/** Copies text to the clipboard and reports how it went, briefly. Shared by
 *  every copy button so they confirm, fail and reset the same way. */
export function useClipboardCopy() {
  const [status, setStatus] = useState<ClipboardCopyStatus>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const timer = window.setTimeout(() => setStatus('idle'), RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }, []);

  return { status, copy };
}
