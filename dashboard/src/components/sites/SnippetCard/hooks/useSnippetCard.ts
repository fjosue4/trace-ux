import { useState } from 'react';
import { InstallMethod } from '../SnippetCard.types';

export function useSnippetCard(siteKey: string, origin: string) {
  const [method, setMethod] = useState<InstallMethod>('npm');
  const [copied, setCopied] = useState(false);

  const npm = `npm install @trace-ux/tracker

import { init } from '@trace-ux/tracker';

const traceux = init({
  siteKey: '${siteKey}',
  origin: '${origin}',
});`;
  const manual = `<script async src="${origin}/t.js" data-site="${siteKey}"></script>`;

  // GTM's script injection drops unknown attributes like data-site, so the
  // tag manager variant sets it programmatically after creating the element.
  const gtm = `<script>
  (function () {
    var s = document.createElement('script');
    s.async = true;
    s.src = '${origin}/t.js';
    s.setAttribute('data-site', '${siteKey}');
    document.head.appendChild(s);
  })();
</script>`;

  const code = method === 'npm' ? npm : method === 'manual' ? manual : gtm;

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return { method, setMethod, copied, code, copy };
}
