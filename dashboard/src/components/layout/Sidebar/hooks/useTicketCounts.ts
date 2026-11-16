import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, TicketCounts } from '../../../../api';

// Several ticket events often arrive together (a reply and its status
// change); one count request covers them all.
const REFRESH_DEBOUNCE_MS = 400;

/**
 * Open tickets for the navigation badge, kept current without polling: the
 * dashboard ticket socket announces every ticket change, and the count is
 * also re-read on navigation and when the tab comes back into view, which
 * covers anything missed while the socket was reconnecting.
 */
export function useTicketCounts(): TicketCounts | null {
  const [counts, setCounts] = useState<TicketCounts | null>(null);
  const { pathname } = useLocation();
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let debounceTimer: number | undefined;
    let retryTimer: number | undefined;
    let retryDelay = 1_000;
    let socket: WebSocket | null = null;

    const load = () => {
      api
        .getTicketCounts()
        .then((next) => {
          if (!disposed) setCounts(next);
        })
        // A missing badge is better than an error in the navigation; the
        // next event or focus tries again.
        .catch(() => {});
    };
    const refresh = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(load, REFRESH_DEBOUNCE_MS);
    };
    refreshRef.current = refresh;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const next = new WebSocket(`${protocol}//${window.location.host}/api/tickets/socket`);
      socket = next;
      next.addEventListener('open', () => {
        retryDelay = 1_000;
        refresh();
      });
      next.addEventListener('message', refresh);
      next.addEventListener('close', () => {
        if (disposed || socket !== next) return;
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      });
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    // The first count comes from the navigation effect below.
    connect();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.clearTimeout(debounceTimer);
      window.clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      socket?.close();
      socket = null;
    };
  }, []);

  // Leaving the inbox after working through it should not leave a stale
  // number behind.
  useEffect(() => {
    refreshRef.current();
  }, [pathname]);

  return counts;
}
