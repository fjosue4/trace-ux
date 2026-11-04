import { useMemo } from 'react';
import type { eventWithTime } from '@rrweb/types';
import { SessionPage } from '../../../../api';
import { pageIndexAt, pageStartTimes } from '../BrowserBar.helpers';
import { BrowserPage } from '../BrowserBar.types';

const SEEK_PAST_START_MS = 250;

type BrowserPageInput = {
  pages: SessionPage[];
  /** The loaded rrweb events, which sharpen page times to the millisecond. */
  events: eventWithTime[] | null;
  firstTs: number;
  currentTimeMs: number;
  /** The session's entry URL, shown until a page is known. */
  fallbackURL?: string;
};

type BrowserPageState = {
  page: BrowserPage | null;
  /** Playback offsets (ms from the recording's start) to seek to, or null. */
  previousAt: number | null;
  currentAt: number | null;
  nextAt: number | null;
};

/** The page on screen in the recording at the playhead, and where it and its
 *  neighbours start, for the recorded browser's bar and buttons. */
export function useBrowserPage({ pages, events, firstTs, currentTimeMs, fallbackURL = '' }: BrowserPageInput): BrowserPageState {
  const ordered = useMemo(
    () => [...pages].sort((a, b) => a.entered_at - b.entered_at || a.idx - b.idx),
    [pages],
  );
  const startTimes = useMemo(() => pageStartTimes(ordered, events), [ordered, events]);
  const index = pageIndexAt(startTimes, firstTs + currentTimeMs);
  // Seek targets sit just past a page's start: a paused player seeked to the
  // snapshot's exact timestamp keeps showing the previous page until it plays.
  const offsetOf = (i: number) => Math.max(0, startTimes[i] - firstTs + SEEK_PAST_START_MS);

  if (index < 0) {
    return { page: fallbackURL ? { url: fallbackURL, title: '' } : null, previousAt: null, currentAt: null, nextAt: null };
  }
  return {
    page: { url: ordered[index].url, title: ordered[index].title },
    previousAt: index > 0 ? offsetOf(index - 1) : null,
    currentAt: offsetOf(index),
    nextAt: index < ordered.length - 1 ? offsetOf(index + 1) : null,
  };
}
