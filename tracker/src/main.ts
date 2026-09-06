/**
 * Webshots tracker: records DOM event streams with rrweb and ships them in
 * compressed batches to a Webshots server. Loaded as:
 *   <script async src="https://your-server/t.js" data-site="SITE_KEY"></script>
 *
 * Privacy: all form inputs are masked, elements with class `ws-block` are
 * removed from the recording, `ws-mask` masks their text, and Do Not Track /
 * localStorage.ws_optout=1 disables tracking entirely.
 */
import { record } from '@rrweb/record';
import type { eventWithTime } from '@rrweb/types';

type WsConfig = {
  sample_rate: number;
  checkout_interval_ms: number;
  mask_inputs: boolean;
  flush_interval_ms: number;
  flush_batch_size: number;
};

const DEFAULTS: WsConfig = {
  sample_rate: 1,
  checkout_interval_ms: 30_000,
  mask_inputs: true,
  flush_interval_ms: 5_000,
  flush_batch_size: 20,
};

const SESSION_TTL_MS = 30 * 60 * 1000; // hidden-tab grace before a visit ends
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // no interaction for this long ends the visit
const MAX_SESSION_MS = 2 * 60 * 60 * 1000; // even continuous interaction splits at 2h
const PING_INTERVAL_MS = 15_000;
const GZIP_THRESHOLD = 2048; // compress batches larger than 2 KB

interface StorageLike {
  get(key: string): string;
  set(key: string, value: string): void;
}

(async () => {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return;
  const siteKey = script.dataset.site;
  if (!siteKey) return;

  try {
    if (navigator.doNotTrack === '1' || localStorage.getItem('ws_optout') === '1') return;
  } catch {
    /* storage blocked: proceed anyway; tracking still honors the server config */
  }

  const origin = new URL(script.src).origin;
  const ingestURL = `${origin}/api/ingest/${encodeURIComponent(siteKey)}`;

  const cfg = await fetchConfig(origin, siteKey);
  if (Math.random() > cfg.sample_rate) return; // sampled out for this visit

  // ---- session identity (per tab; new visit after SESSION_TTL_MS idle) ----
  // pageIdx and activeMs live in sessionStorage so a multi-page visit is one
  // continuous session even though every page load restarts the script.
  const store = sessionStorageSafe();
  let sessionId = store.get('ws_sid');
  let seq = Number(store.get('ws_seq') || '0');
  let pageIdx = Number(store.get('ws_page') || '-1');
  let activeMs = Number(store.get('ws_active') || '0');
  let startedAt = Date.now();
  if (!sessionId || startedAt - Number(store.get('ws_sid_ts') || '0') > SESSION_TTL_MS) {
    sessionId = newId();
    seq = 0;
    pageIdx = -1;
    activeMs = 0;
  }

  let stopped = false;
  let stopRecording: ReturnType<typeof record> | undefined;
  let buffer: eventWithTime[] = [];
  let lastTick = startedAt;
  let lastEventAt = startedAt; // last real user interaction (any recorded event)
  let wakeArmed = false;

  // ---- transport ----
  function send(batch: unknown, useBeacon: boolean) {
    const json = JSON.stringify(batch);
    if (typeof CompressionStream !== 'undefined' && json.length > GZIP_THRESHOLD) {
      compress(json)
        .then((gz) => transmit(new Blob([gz]), true, useBeacon))
        .catch(() => transmit(new Blob([json], { type: 'text/plain' }), false, useBeacon));
    } else {
      transmit(new Blob([json], { type: 'text/plain' }), false, useBeacon);
    }
  }
  function transmit(body: Blob, gz: boolean, useBeacon: boolean) {
    const url = gz ? ingestURL + '?gz=1' : ingestURL;
    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, body);
      return;
    }
    fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => {});
  }

  function compress(text: string): Promise<ArrayBuffer> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  function flush(useBeacon = false) {
    if (buffer.length === 0) return;
    const batch = { type: 'events', session_id: sessionId, seq: seq++, events: buffer };
    store.set('ws_seq', String(seq));
    buffer = [];
    send(batch, useBeacon);
  }

  function ping(useBeacon = false) {
    send(
      {
        type: 'ping',
        session_id: sessionId,
        duration_ms: activeMs,
        page_count: pageIdx + 1,
      },
      useBeacon,
    );
  }

  // ---- page tracking (works for MPAs and SPA route changes) ----
  function trackPage() {
    pageIdx++;
    store.set('ws_page', String(pageIdx));
    send(
      {
        type: 'page',
        session_id: sessionId,
        idx: pageIdx,
        url: location.href,
        title: document.title,
        entered_at: Math.floor(Date.now() / 1000),
      },
      false,
    );
  }

  function onRouteChange() {
    flush();
    trackPage();
  }

  const origPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    const result = origPushState(...args);
    onRouteChange();
    return result;
  };
  window.addEventListener('popstate', onRouteChange);

  // ---- recording ----
  function startRecording() {
    try {
      stopRecording =
        record({
          emit(event) {
            lastEventAt = Date.now(); // any recorded event (move/click/key/scroll) is activity
            buffer.push(event);
            if (buffer.length >= cfg.flush_batch_size) flush();
          },
          checkoutEveryNms: cfg.checkout_interval_ms,
          maskAllInputs: cfg.mask_inputs,
          blockClass: 'ws-block',
          maskTextClass: 'ws-mask',
          ignoreClass: 'ws-ignore',
        }) ?? undefined;
    } catch {
      /* recording unsupported in this browser */
    }
  }

  // ---- hello ----
  function sendHello() {
    const params = new URLSearchParams(location.search);
    send(
      {
        type: 'hello',
        session_id: sessionId,
        url: location.href,
        referrer: document.referrer,
        utm_source: params.get('utm_source') || '',
        utm_medium: params.get('utm_medium') || '',
        utm_campaign: params.get('utm_campaign') || '',
        lang: navigator.language || '',
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        screen_w: screen.width,
        screen_h: screen.height,
      },
      false,
    );
  }

  sendHello();
  store.set('ws_sid', sessionId);
  store.set('ws_sid_ts', String(startedAt));

  startRecording();
  trackPage();

  // ---- session lifecycle ----

  // Finalizes the current visit: ship what's pending, stop recording, and arm
  // wake listeners so the next deliberate interaction starts a new visit.
  function endSession() {
    if (stopped) return;
    stopped = true;
    flush(true);
    ping(true);
    stopRecording?.();
    wakeOnInteraction();
  }

  // Starts a fresh visit — used when returning to an ended session and when
  // the 2h cap splits a marathon visit mid-activity.
  function newSession() {
    stopped = false;
    disarmWake();
    sessionId = newId();
    seq = 0;
    pageIdx = -1;
    activeMs = 0;
    lastEventAt = Date.now();
    startedAt = lastEventAt;
    lastTick = startedAt;
    store.set('ws_sid', sessionId);
    store.set('ws_sid_ts', String(startedAt));
    store.set('ws_page', '-1');
    store.set('ws_active', '0');
    startRecording();
    sendHello();
    trackPage();
  }

  // A dead visit wakes on deliberate input (click/key/scroll), never on mere
  // mouse movement — a passing cursor shouldn't start recording someone.
  function onWake() {
    disarmWake();
    newSession();
  }

  function wakeOnInteraction() {
    if (wakeArmed) return;
    wakeArmed = true;
    for (const type of ['pointerdown', 'keydown', 'wheel', 'scroll'] as const) {
      document.addEventListener(type, onWake, { capture: true, passive: true });
    }
  }

  function disarmWake() {
    if (!wakeArmed) return;
    wakeArmed = false;
    for (const type of ['pointerdown', 'keydown', 'wheel', 'scroll'] as const) {
      document.removeEventListener(type, onWake, { capture: true });
    }
  }

  setInterval(flush, cfg.flush_interval_ms);
  setInterval(() => {
    const now = Date.now();
    if (stopped || document.visibilityState !== 'visible') {
      lastTick = now;
      return;
    }
    // 30 min without any interaction ends the visit...
    if (now - lastEventAt > IDLE_TIMEOUT_MS) {
      endSession();
      return;
    }
    // ...but 2h of continuous interaction is split into a fresh session.
    if (activeMs >= MAX_SESSION_MS) {
      newSession();
      return;
    }
    // Only visible time counts toward the session length; pings also keep
    // last_seen fresh on the server so retention can expire dead sessions.
    activeMs += now - lastTick;
    store.set('ws_active', String(activeMs));
    store.set('ws_sid_ts', String(now));
    ping();
    lastTick = now;
  }, PING_INTERVAL_MS);

  window.addEventListener('pagehide', () => {
    flush(true);
    if (!stopped) ping(true);
  });

  // Long-hidden tabs end the visit; returning starts a fresh session.
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush(true);
      if (!stopped) ping(true);
      hideTimer = setTimeout(endSession, SESSION_TTL_MS);
    } else {
      clearTimeout(hideTimer);
      if (stopped) newSession();
    }
  });

  // ---- helpers ----
  function newId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'ws-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function sessionStorageSafe(): StorageLike {
    try {
      const s = window.sessionStorage;
      return {
        get: (k) => s.getItem(k) || '',
        set: (k, v) => {
          try {
            s.setItem(k, v);
          } catch {
            /* quota / private mode */
          }
        },
      };
    } catch {
      const m = new Map<string, string>();
      return { get: (k) => m.get(k) || '', set: (k, v) => void m.set(k, v) };
    }
  }

  async function fetchConfig(origin: string, key: string): Promise<WsConfig> {
    const ctrl = new AbortController();
    const bail = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`${origin}/api/config/${encodeURIComponent(key)}`, {
        signal: ctrl.signal,
      });
      return { ...DEFAULTS, ...(await res.json()) };
    } catch {
      return DEFAULTS;
    } finally {
      clearTimeout(bail);
    }
  }
})();
