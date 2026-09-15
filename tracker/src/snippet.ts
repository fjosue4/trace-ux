/**
 * The legacy browser entry served at /t.js.
 *
 * Keep this file intentionally small: all tracker behavior lives in init(),
 * while this adapter only translates script-tag data attributes into the
 * package options used by npm and React consumers.
 */
import { init } from './main';

function findTrackerScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.dataset.site) return current;

  // document.currentScript can be null for async scripts and tag-manager
  // injection. Find the script whose data-site was set before it was loaded.
  return (
    (Array.from(document.scripts).find((candidate) => {
      const script = candidate as HTMLScriptElement;
      if (!script.dataset.site) return false;
      try {
        return new URL(script.src, location.href).pathname.endsWith('/t.js');
      } catch {
        return false;
      }
    }) as HTMLScriptElement | undefined) || null
  );
}

const script = findTrackerScript();
if (script?.dataset.site) {
  try {
    const source = new URL(script.src, location.href);
    const traceux = init({
      siteKey: script.dataset.site,
      origin: source.origin,
      userId: script.dataset.userId,
      clientId: script.dataset.clientId,
      remoteId: script.dataset.remoteId,
      widget: true,
    });

    // The global remains a compatibility adapter only. npm and React users
    // receive the exact same handle directly from init().
    window.TraceUX = traceux;
  } catch {
    // A malformed or incomplete snippet must never break the host page.
  }
}
