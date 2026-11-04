import { EventType, eventWithTime } from '@rrweb/types';
import { SessionPage } from '../../../api';
import { DisplayURL } from './BrowserBar.types';

/**
 * When each page came on screen, in client-clock epoch ms. Pages are stored
 * to the second (rounded down), which would show a new URL up to a second
 * before the replayed page changes. A full page load also leaves an rrweb Meta
 * event carrying its href, followed a few ms later by the snapshot that draws
 * the page; where those are loaded, the snapshot's time replaces the rounded
 * one. Seeking to the Meta event itself would land just before the new page
 * is drawn. In-page navigations (pushState, #anchors) leave neither and keep
 * the stored second.
 */
export function pageStartTimes(pages: SessionPage[], events: eventWithTime[] | null): number[] {
  const list = events ?? [];
  const loads: { loadedAt: number; drawnAt: number; href: string }[] = [];
  for (const [i, e] of list.entries()) {
    if (e.type !== EventType.Meta) continue;
    const drawn = list.slice(i + 1, i + 4).find((next) => next.type === EventType.FullSnapshot);
    loads.push({ loadedAt: e.timestamp, drawnAt: drawn?.timestamp ?? e.timestamp, href: e.data.href });
  }
  return pages.map((page) => {
    const second = page.entered_at * 1000;
    // Matched on the Meta event's own second, which is the one stored.
    const load = loads.find((l) => l.href === page.url && l.loadedAt >= second && l.loadedAt < second + 1000);
    return load ? load.drawnAt : second;
  });
}

/**
 * Index of the page on screen at `atMs`: the last one started at or before
 * it. The first page also covers anything before its own start, since the
 * recording opens on it. -1 when there are no pages. Expects ascending times.
 */
export function pageIndexAt(startTimes: number[], atMs: number): number {
  let index = startTimes.length ? 0 : -1;
  for (let i = 1; i < startTimes.length; i++) {
    if (startTimes[i] > atMs) break;
    index = i;
  }
  return index;
}

/** Splits a URL the way Chrome's address bar shows it: no scheme, the host
 *  emphasised, and a bare "/" path left out. */
export function displayURL(raw: string): DisplayURL {
  try {
    const url = new URL(raw);
    const path = url.pathname === '/' && !url.search && !url.hash ? '' : url.pathname;
    return { secure: url.protocol === 'https:', host: url.host, rest: `${path}${url.search}${url.hash}`, full: raw };
  } catch {
    return { secure: false, host: '', rest: raw, full: raw };
  }
}
