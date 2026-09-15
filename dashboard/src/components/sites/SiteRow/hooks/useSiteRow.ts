import { useState } from 'react';

export function useSiteRow() {
  const [keyCopied, setKeyCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);

  async function copyText(text: string, mark: (value: boolean) => void) {
    await navigator.clipboard.writeText(text);
    mark(true);
    setTimeout(() => mark(false), 1500);
  }

  return { keyCopied, snippetCopied, copyText, setKeyCopied, setSnippetCopied };
}
