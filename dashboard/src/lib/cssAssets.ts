// Client-side stylesheet rehydration.
//
// The replay endpoint returns events with stylesheets replaced by
// `@traceux-css-ref:<sha256>` markers. Expanding them server-side meant every
// checkout FullSnapshot carried the page's entire CSS again: measured on a
// 24-minute recording, 4 distinct sheets (6.5 MB) expanded 54 times into a
// 125 MB response, 98 MB of which was the same bytes repeated.
//
// Here each sheet is fetched once. The URL is content-addressed, so the
// response is immutable and the browser reuses it for every other recording of
// the same site -- the second replay pays nothing for CSS at all.

const CSS_REF_PREFIX = '@traceux-css-ref:';
const CSS_REF_LEN = CSS_REF_PREFIX.length + 64;

// Shared across players and sessions for the lifetime of the tab. Values are
// promises so twenty snapshots referencing one sheet trigger one request.
const cache = new Map<string, Promise<string>>();

function isCSSRef(v: unknown): v is string {
  return typeof v === 'string' && v.length === CSS_REF_LEN && v.startsWith(CSS_REF_PREFIX);
}

/** Every distinct stylesheet hash referenced anywhere in these events. */
export function collectCSSRefs(events: unknown[]): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '_cssText' && isCSSRef(v)) found.add(v.slice(CSS_REF_PREFIX.length));
      else walk(v);
    }
  };
  walk(events);
  return [...found];
}

export function fetchCSSAsset(hash: string): Promise<string> {
  const hit = cache.get(hash);
  if (hit) return hit;
  const p = fetch(`/api/css-assets/${hash}`, { credentials: 'same-origin' }).then((r) => {
    if (!r.ok) throw new Error(`stylesheet ${hash.slice(0, 8)}… failed: HTTP ${r.status}`);
    return r.text();
  });
  // A failed fetch must not be cached as permanently broken; a later retry for
  // the same sheet should be allowed to succeed.
  p.catch(() => cache.delete(hash));
  cache.set(hash, p);
  return p;
}

/** Resolve every reference these events need, in parallel, once each. */
export async function loadCSSAssets(events: unknown[]): Promise<Map<string, string>> {
  const hashes = collectCSSRefs(events);
  const loaded = await Promise.all(hashes.map((h) => fetchCSSAsset(h)));
  return new Map(hashes.map((h, i) => [h, loaded[i]]));
}

/**
 * Substitute references in place.
 *
 * Mutates rather than rebuilding: these objects are large and freshly parsed
 * from the response, nothing else holds them yet, and cloning a FullSnapshot
 * costs about as much as the parse did.
 *
 * An unresolved reference throws instead of rendering as empty CSS. An unstyled
 * replay looks like a broken application and sends somebody hunting through
 * their own stylesheets for a fault that is not there.
 */
export function rehydrateCSS(events: unknown[], assets: Map<string, string>): void {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (k === '_cssText' && isCSSRef(v)) {
        const hash = v.slice(CSS_REF_PREFIX.length);
        const css = assets.get(hash);
        if (css === undefined) {
          throw new Error(`stylesheet ${hash.slice(0, 8)}… referenced by this recording is missing`);
        }
        obj[k] = css;
      } else {
        walk(v);
      }
    }
  };
  walk(events);
}
