/**
 * TraceUX tracker: records DOM event streams with rrweb and ships them in
 * compressed batches to a TraceUX server. Loaded as:
 *   <script async src="https://your-server/t.js" data-site="SITE_KEY"></script>
 *
 * Privacy: all form inputs are masked, elements with class `trace-ux-block` are
 * removed from the recording, `trace-ux-mask` masks their text, and Do Not Track /
 * localStorage.trace_ux_optout=1 disables tracking entirely.
 */
import { record } from '@rrweb/record';
import { mountUnifiedWidget, type WidgetCfg, type WidgetHandle } from './widget';
import type { eventWithTime } from '@rrweb/types';

type SurveyQuestionCfg = {
  id: string;
  label: string;
  type: 'rating' | 'text' | 'choice';
  max?: number; // rating scale: 5 (stars) or 10 (NPS)
  options?: string[]; // choice
  optional?: boolean;
};

type FeedbackCfg = {
  enabled: boolean;
  position?: string; // right | left
  survey_id?: string;
  title?: string;
  type?: string; // stars | nps | custom
  questions?: SurveyQuestionCfg[];
  appearance?: {
    button_bg?: string;
    button_text?: string;
    button_label?: string;
    panel_bg?: string;
    panel_text?: string;
    accent?: string;
    primary?: string;
    primary_text?: string;
    radius?: number;
    spacing?: number;
  };
  trigger?: { mode?: string; pages?: string[]; actions?: string[] };
};

type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

type LogCfg = {
  enabled: boolean;
  minimum_severity: LogSeverity;
};

type TraceUXConfig = {
  sample_rate: number;
  checkout_interval_ms: number;
  mask_inputs: boolean;
  flush_interval_ms: number;
  flush_batch_size: number;
  recording_enabled?: boolean;
  logs?: LogCfg;
  feedback?: FeedbackCfg;
  updates?: { enabled: boolean; position?: string; appearance?: { theme?:'light'|'dark'; button_bg?:string; button_text?:string; button_label?:string; panel_bg?:string; panel_text?:string; accent?:string; action_bg?:string; action_text?:string; radius?:number; max_width?:number } };
  /** Unified widget block: one launcher for announcements + feedback. */
  widget?: WidgetCfg;
};

type PendingLog = {
  client_seq: number;
  timestamp_ms: number;
  severity: LogSeverity;
  message: string;
  url: string;
};

// Public API on window.TraceUX for the host page.
interface TraceUXFeedbackInput {
  rating?: number; // 1-5 (stars) or 0-10 (NPS); derived from answers when omitted
  comment?: string;
  surveyId?: string;
  answers?: { id: string; label?: string; value: string }[];
}

interface TraceUXApi {
  /** Attach/replace visitor identity mid-session (e.g. right after login). */
  identify: (fields: { userId?: string; clientId?: string; remoteId?: string }) => void;
  /** Emit a named custom event, visible as seekable activity in the replay. */
  track: (name: string, trackId?: string) => void;
  /** Submit in-app feedback/survey response, linked to the current session. */
  feedback: (input: TraceUXFeedbackInput) => void;
  /** Request a short-lived demo replay link without exposing the session ID. */
  claimReplay: () => Promise<{ url: string; expires_at: number }>;
}

declare global {
  interface Window {
    TraceUX?: TraceUXApi;
    __traceUXStarted?: boolean;
  }
}

const DEFAULTS: TraceUXConfig = {
  sample_rate: 1,
  checkout_interval_ms: 30_000,
  mask_inputs: true,
  flush_interval_ms: 5_000,
  flush_batch_size: 20,
  recording_enabled: true, // dashboard can turn recording off per site
  logs: { enabled: false, minimum_severity: 'error' },
};

const LOG_SEVERITY_RANK: Record<LogSeverity, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SESSION_TTL_MS = 30 * 60 * 1000; // hidden-tab grace before a visit ends
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // no interaction for this long ends the visit
const MAX_SESSION_MS = 2 * 60 * 60 * 1000; // even continuous interaction splits at 2h
const PING_INTERVAL_MS = 15_000;
const GZIP_THRESHOLD = 2048; // compress batches larger than 2 KB
const MAX_BUFFER_EVENTS = 5_000; // match the server-side batch safety cap
const MAX_BUFFER_LOGS = 100; // match the server-side log batch safety cap

interface StorageLike {
  get(key: string): string;
  set(key: string, value: string): void;
}

(async () => {
  // document.currentScript can be null when a tag manager injects this async
  // script. Fall back to the matching tracker tag so the public API still
  // initializes on GTM-managed pages.
  const script =
    (document.currentScript as HTMLScriptElement | null) ||
    (Array.from(document.scripts).find((candidate) => {
      const element = candidate as HTMLScriptElement;
      return element.dataset.site && new URL(element.src, location.href).pathname.endsWith('/t.js');
    }) as HTMLScriptElement | undefined) ||
    null;
  if (!script) return;
  const siteKey = script.dataset.site;
  if (!siteKey) return;

  // A page can receive the snippet from both a static tag and a tag manager.
  // Only one recorder may own the page or every copy will emit its own stream.
  if (window.__traceUXStarted) return;
  window.__traceUXStarted = true;

  try {
    if (navigator.doNotTrack === '1' || localStorage.getItem('trace_ux_optout') === '1') return;
  } catch {
    /* storage blocked: proceed anyway; tracking still honors the server config */
  }

  const origin = new URL(script.src).origin;
  const ingestURL = `${origin}/api/ingest/${encodeURIComponent(siteKey)}`;

  // Visitor identity: snippet attributes (data-user-id etc.) at init, later
  // replaced/augmented via window.TraceUX.identify() (e.g. after login).
  const identity = {
    user_id: script.dataset.userId || '',
    client_id: script.dataset.clientId || '',
    remote_id: script.dataset.remoteId || '',
  };

  const cfg = await fetchConfig(origin, siteKey);
  if (Math.random() > cfg.sample_rate) return; // sampled out for this visit

  // ---- session identity (per tab; new visit after SESSION_TTL_MS idle) ----
  // pageIdx and activeMs live in sessionStorage so a multi-page visit is one
  // continuous session even though every page load restarts the script.
  const store = sessionStorageSafe();
  let sessionId = store.get('trace_ux_sid');
  let seq = Number(store.get('trace_ux_seq') || '0');
  let logSeq = Number(store.get('trace_ux_log_seq') || '0');
  let pageIdx = Number(store.get('trace_ux_page') || '-1');
  let activeMs = Number(store.get('trace_ux_active') || '0');
  let startedAt = Date.now();
  const stale =
    !sessionId || startedAt - Number(store.get('trace_ux_sid_ts') || '0') > SESSION_TTL_MS;
  // A session that already hit the 2h cap must not swallow this page load:
  // start a fresh one right away instead of recording into the old session
  // until the first tick notices.
  if (stale || activeMs >= MAX_SESSION_MS) {
    sessionId = newId();
    if (!sessionId) return;
    seq = 0;
    logSeq = 0;
    pageIdx = -1;
    activeMs = 0;
  }

  let stopped = false;
  let stopRecording: ReturnType<typeof record> | undefined;
  let buffer: eventWithTime[] = [];
  let logBuffer: PendingLog[] = [];
  let lastTick = startedAt;
  let lastEventAt = startedAt; // last real user interaction (any recorded event)
  let wakeArmed = false;
  let restoreConsole: (() => void) | undefined;

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
    // keepalive is reserved for lifecycle sends. Using it for every recording
    // batch can fill the browser's small keepalive queue on mutation-heavy pages.
    fetch(url, { method: 'POST', body, keepalive: useBeacon, credentials: 'omit' }).catch(() => {});
  }

  function compress(text: string): Promise<ArrayBuffer> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  function flush(useBeacon = false) {
    if (buffer.length === 0) return;
    const events = buffer;
    buffer = [];
    const batch = { type: 'events', session_id: sessionId, seq: seq++, events };
    store.set('trace_ux_seq', String(seq));
    send(batch, useBeacon);
  }

  function flushLogs(useBeacon = false) {
    if (logBuffer.length === 0) return;
    const logs = logBuffer;
    logBuffer = [];
    send({ type: 'logs', session_id: sessionId, logs }, useBeacon);
  }

  function logMinimumSeverity(): LogSeverity {
    const configured = cfg.logs?.minimum_severity;
    return configured && configured in LOG_SEVERITY_RANK ? configured : 'error';
  }

  function formatConsoleValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof Element !== 'undefined' && value instanceof Element) {
      return `[Element ${value.tagName.toLowerCase()}]`;
    }
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    try {
      const json = JSON.stringify(value);
      return json === undefined ? String(value) : json;
    } catch {
      return String(value);
    }
  }

  function captureLog(severity: LogSeverity, args: unknown[]) {
    if (stopped || cfg.recording_enabled === false || cfg.logs?.enabled !== true) return;
    if (LOG_SEVERITY_RANK[severity] < LOG_SEVERITY_RANK[logMinimumSeverity()]) return;
    logSeq++;
    store.set('trace_ux_log_seq', String(logSeq));
    logBuffer.push({
      client_seq: logSeq,
      timestamp_ms: Date.now(),
      severity,
      message: args.map(formatConsoleValue).join(' ').slice(0, 8192),
      url: location.href.slice(0, 2048),
    });
    if (logBuffer.length > MAX_BUFFER_LOGS) {
      // Keep one digest-sized batch ready for the next scheduled flush. A
      // count-based flush here can create a request loop on noisy pages when
      // the page logs in response to each network request.
      logBuffer.splice(0, logBuffer.length - MAX_BUFFER_LOGS);
    }
  }

  function startLogTracking() {
    if (cfg.recording_enabled === false || cfg.logs?.enabled !== true || restoreConsole) return;
    const consoleObject = console as unknown as Record<string, (...args: unknown[]) => void>;
    const methods: Array<{ name: string; severity: LogSeverity }> = [
      { name: 'debug', severity: 'debug' },
      { name: 'info', severity: 'info' },
      { name: 'log', severity: 'info' },
      { name: 'warn', severity: 'warn' },
      { name: 'error', severity: 'error' },
    ];
    const originals: Array<{ name: string; fn: (...args: unknown[]) => void }> = [];
    for (const method of methods) {
      const original = consoleObject[method.name];
      if (typeof original !== 'function') continue;
      const bound = original.bind(console);
      try {
        consoleObject[method.name] = (...args: unknown[]) => {
          bound(...args);
          captureLog(method.severity, args);
        };
        originals.push({ name: method.name, fn: original });
      } catch {
        /* some hosts expose a read-only console */
      }
    }
    if (originals.length > 0) {
      restoreConsole = () => {
        for (const original of originals) {
          try {
            consoleObject[original.name] = original.fn;
          } catch {
            /* best effort */
          }
        }
        restoreConsole = undefined;
      };
    }
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

  function sendCustom(name: string, trackId: string) {
    send(
      {
        type: 'custom',
        session_id: sessionId,
        events: [
          {
            ts: Date.now(),
            name: String(name || 'event').slice(0, 100),
            track_id: String(trackId || '').slice(0, 100),
          },
        ],
      },
      false,
    );
  }

  function sendFeedback(input: TraceUXFeedbackInput) {
    const rating = Math.round(Number(input && input.rating)) || 0;
    if (rating < 0 || rating > 10) return;
    const answers = (input.answers || []).slice(0, 20).map((a) => ({
      id: String(a.id || '').slice(0, 100),
      label: String(a.label || '').slice(0, 200),
      value: String(a.value || '').slice(0, 1000),
    }));
    send(
      {
        type: 'feedback',
        session_id: sessionId,
        survey_id: String(input.surveyId || 'default').slice(0, 100),
        rating,
        comment: String(input.comment || '').slice(0, 2000),
        answers,
      },
      false,
    );
  }

  // ---- page tracking (works for MPAs and SPA route changes) ----
  function trackPage() {
    pageIdx++;
    store.set('trace_ux_page', String(pageIdx));
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
    trackPage();
    try {
      mountWidgetIfConfigured();
    } catch {
      /* widget must never break the host page */
    }
  }

  // Every way a page's URL can change without a document load. pushState and
  // popstate alone miss two common cases: in-page anchors (`<a href="#x">`
  // fires hashchange, not popstate) and routers that use replaceState for
  // filters and tab state.
  let lastTrackedURL = location.href;
  function onURLMaybeChanged() {
    if (location.href === lastTrackedURL) return; // same URL: not a navigation
    lastTrackedURL = location.href;
    onRouteChange();
  }

  const origPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    const result = origPushState(...args);
    onURLMaybeChanged();
    return result;
  };
  const origReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    const result = origReplaceState(...args);
    onURLMaybeChanged();
    return result;
  };
  window.addEventListener('popstate', onURLMaybeChanged);
  window.addEventListener('hashchange', onURLMaybeChanged);

  // The visit's window geometry is not fixed at page load: people maximise,
  // snap windows side by side, and open or dock devtools mid-visit. rrweb
  // records each change as a ViewportResize so the replay can follow it, and
  // the session's own metadata has to keep up too — otherwise the dashboard
  // and the replay's aspect are stuck describing the window the visit opened
  // in. Trailing-edge debounce so a drag-resize sends one update, not one per
  // frame.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSentViewport = `${window.innerWidth}x${window.innerHeight}`;
  window.addEventListener(
    'resize',
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const now = `${window.innerWidth}x${window.innerHeight}`;
        if (now === lastSentViewport) return;
        lastSentViewport = now;
        sendHello();
      }, 400);
    },
    { passive: true },
  );

  // ---- recording ----
  function startRecording() {
    // Recording is toggled per site from the TraceUX dashboard; the feedback
    // channel and lightweight batches keep working while it is off.
    if (cfg.recording_enabled === false) return;
    try {
      stopRecording =
        record({
          emit(event) {
            lastEventAt = Date.now(); // any recorded event (move/click/key/scroll) is activity
            buffer.push(event);
            if (buffer.length > MAX_BUFFER_EVENTS) {
              // Keep the newest events if a page produces an extreme mutation
              // storm before the next scheduled digest.
              buffer.splice(0, buffer.length - MAX_BUFFER_EVENTS);
            }
          },
          checkoutEveryNms: cfg.checkout_interval_ms,
          maskAllInputs: cfg.mask_inputs,
          // Elements carrying trace-ux-mask as a class OR a bare attribute have their
          // text masked, wherever they appear in the page.
          maskTextClass: 'trace-ux-mask',
          maskTextSelector: '.trace-ux-mask,[trace-ux-mask],[data-trace-ux-mask]',
          blockClass: 'trace-ux-block',
          ignoreClass: 'trace-ux-ignore',
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
        user_id: identity.user_id,
        client_id: identity.client_id,
        remote_id: identity.remote_id,
      },
      false,
    );
  }

  // ---- host-page API ----
  window.TraceUX = {
    identify(fields) {
      if (fields.userId) identity.user_id = fields.userId;
      if (fields.clientId) identity.client_id = fields.clientId;
      if (fields.remoteId) identity.remote_id = fields.remoteId;
      sendHello(); // server adopts non-empty ids for the running session
    },
    track(name, trackId) {
      sendCustom(name || 'event', trackId || '');
      try {
        mountWidgetIfConfigured(name || 'event');
      } catch {
        /* widget must never break the host page */
      }
    },
    feedback(input) {
      sendFeedback(input);
    },
    async claimReplay() {
      // Flush first so the server has the current visit before validating it.
      flush();
      ping();
      await new Promise((resolve) => setTimeout(resolve, 350));
      const res = await fetch(`${origin}/api/demo/claim/${encodeURIComponent(siteKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!res.ok) throw new Error('Temporary replay access is unavailable.');
      const link = (await res.json()) as { url: string; expires_at: number };
      // Resolve the server's relative share path against the tracker origin;
      // the landing page may be hosted on a different origin.
      return { ...link, url: new URL(link.url, origin).toString() };
    },
  };

  // Tracked clicks: any element with a trace-ux-track-id attribute reports itself as
  // seekable activity ("trace-ux-track").
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('[trace-ux-track-id]');
      if (el) {
        const trackId = el.getAttribute('trace-ux-track-id') || '';
        sendCustom('click', trackId);
        try {
          mountWidgetIfConfigured(trackId);
        } catch {
          /* widget must never break the host page */
        }
      }
    },
    { capture: true, passive: true },
  );

  let unifiedWidget: WidgetHandle | null = null;

  // ---- unified widget (announcements + feedback) ----
  //
  // One launcher, one panel. The panel shows a tab strip only when the site
  // has both sections switched on; with just one enabled it opens straight
  // into that section. See widget.ts.
  function matchesPages(patterns: string[]): boolean {
    const path = location.pathname;
    const href = location.href;
    return patterns.some((p) => {
      const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return re.test(path) || re.test(href);
    });
  }

  // The feedback trigger still decides whether the Feedback section is offered:
  // 'always' everywhere, 'page' on matching URLs, 'action' only once a tracked
  // action fires (which then opens the panel on that section).
  function feedbackAvailable(triggerAction?: string): boolean {
    if (!cfg.feedback?.enabled) return false;
    const trigger = cfg.feedback.trigger;
    const mode = trigger?.mode || 'always';
    if (mode === 'action') return !!triggerAction && (trigger?.actions || []).includes(triggerAction);
    if (mode === 'page') return matchesPages(trigger?.pages || []);
    return true;
  }

  function mountWidgetIfConfigured(triggerAction?: string) {
    const widgetCfg = cfg.widget;
    if (!widgetCfg) return;

    if (unifiedWidget) {
      // Already mounted: a tracked action just needs to open the right section.
      if (triggerAction && feedbackAvailable(triggerAction)) unifiedWidget.open('feedback');
      return;
    }

    const feedbackNow = feedbackAvailable(triggerAction);
    const updatesNow = !!widgetCfg.updates_enabled;
    if (!feedbackNow && !updatesNow) return;

    try {
      unifiedWidget = mountUnifiedWidget({
        origin,
        siteKey: siteKey as string,
        config: { ...widgetCfg, feedback_enabled: feedbackNow, enabled: true },
        survey: {
          title: cfg.feedback?.title,
          type: cfg.feedback?.type,
          survey_id: cfg.feedback?.survey_id,
          questions: cfg.feedback?.questions,
        },
        submitFeedback: (input) => sendFeedback(input),
        newId,
      });
    } catch {
      /* the widget must never break the host page */
      unifiedWidget = null;
      return;
    }
    // An action-triggered survey opens immediately, as it did before the merge.
    if (triggerAction && feedbackNow) unifiedWidget?.open('feedback');
  }

  // ---- bootstrap ----
  //
  // Recording comes first and the widget second, deliberately: capture is the
  // product's job, so nothing about the optional widget may sit between the
  // page loading and the recorder starting.
  sendHello();
  store.set('trace_ux_sid', sessionId);
  store.set('trace_ux_sid_ts', String(startedAt));
  store.set('trace_ux_log_seq', String(logSeq));

  startRecording();
  startLogTracking();
  trackPage();

  try {
    mountWidgetIfConfigured();
  } catch {
    /* widget must never break the host page or stop the recording */
  }

  // ---- session lifecycle ----

  // Finalizes the current visit: ship what's pending, stop recording, and arm
  // wake listeners so the next deliberate interaction starts a new visit.
  function endSession() {
    if (stopped) return;
    stopped = true;
    flush(true);
    flushLogs(true);
    ping(true);
    stopRecording?.();
    restoreConsole?.();
    wakeOnInteraction();
  }

  // Starts a fresh visit. `finalize` ships the tail of the outgoing session
  // first (pending events + final ping) — required for the 2h cap split, where
  // the visit is still live and its buffered events would otherwise carry the
  // NEW session id. Wake-from-dead sessions skip it: endSession already flushed.
  function newSession(finalize = false) {
    if (finalize && !stopped) {
      flush(true);
      flushLogs(true);
      ping(true);
    }
    const nextSessionId = newId();
    if (!nextSessionId) {
      stopped = true;
      return;
    }
    stopped = false;
    disarmWake();
    sessionId = nextSessionId;
    seq = 0;
    logSeq = 0;
    pageIdx = -1;
    activeMs = 0;
    lastEventAt = Date.now();
    startedAt = lastEventAt;
    lastTick = startedAt;
    store.set('trace_ux_sid', sessionId);
    store.set('trace_ux_sid_ts', String(startedAt));
    store.set('trace_ux_log_seq', String(logSeq));
    store.set('trace_ux_page', '-1');
    store.set('trace_ux_active', '0');
    startRecording();
    startLogTracking();
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

  // Recording events and browser logs are digested on the same time boundary,
  // not on event count. This keeps noisy pages from opening a request loop:
  // one recording request and, when needed, one logs request per digest tick.
  const flushIntervalMs = Math.max(5_000, cfg.flush_interval_ms || 5_000);
  setInterval(() => {
    flush();
    flushLogs();
  }, flushIntervalMs);
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
      newSession(true);
      return;
    }
    // Only visible time counts toward the session length; pings also keep
    // last_seen fresh on the server so retention can expire dead sessions.
    activeMs += now - lastTick;
    store.set('trace_ux_active', String(activeMs));
    store.set('trace_ux_sid_ts', String(now));
    ping();
    lastTick = now;
  }, PING_INTERVAL_MS);

  window.addEventListener('pagehide', () => {
    flush(true);
    flushLogs(true);
    if (!stopped) ping(true);
  });

  // Long-hidden tabs end the visit; returning starts a fresh session.
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush(true);
      flushLogs(true);
      if (!stopped) ping(true);
      hideTimer = setTimeout(endSession, SESSION_TTL_MS);
    } else {
      clearTimeout(hideTimer);
      if (stopped) newSession();
    }
  });

  // ---- helpers ----
  function newId(): string {
    const cryptoAPI =
      typeof globalThis.crypto !== 'undefined'
        ? (globalThis.crypto as Crypto & { randomUUID?: () => string })
        : undefined;
    if (typeof cryptoAPI?.randomUUID === 'function') return cryptoAPI.randomUUID();
    if (cryptoAPI && typeof cryptoAPI.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoAPI.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return '';
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

  async function fetchConfig(origin: string, key: string): Promise<TraceUXConfig> {
    const ctrl = new AbortController();
    const bail = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`${origin}/api/config/${encodeURIComponent(key)}`, {
        signal: ctrl.signal,
      });
      const remote = await res.json();
      return {
        ...DEFAULTS,
        ...remote,
        logs: { ...DEFAULTS.logs, ...(remote.logs || {}) },
      };
    } catch {
      return DEFAULTS;
    } finally {
      clearTimeout(bail);
    }
  }
})();
