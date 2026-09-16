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
import type { eventWithTime } from '@rrweb/types';
import type { WidgetCfg, WidgetHandle } from './widget';

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

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

export type TraceUXIdentity = {
  userId?: string;
  clientId?: string;
  remoteId?: string;
};

type LogCfg = {
  enabled: boolean;
  minimum_severity: LogSeverity;
};

type TraceUXConfig = {
  sample_rate: number;
  checkout_interval_ms: number;
  inline_stylesheet?: boolean;
  slim_dom?: boolean;
  mask_inputs: boolean;
  flush_interval_ms: number;
  flush_batch_size: number;
  recording_enabled?: boolean;
  logs?: LogCfg;
  feedback?: FeedbackCfg;
  updates?: { enabled: boolean; position?: string; appearance?: { theme?:'light'|'dark'; button_bg?:string; button_text?:string; button_label?:string; panel_bg?:string; panel_text?:string; accent?:string; action_bg?:string; action_text?:string; radius?:number; max_width?:number } };
  /** Unified widget block: one launcher for announcements, tickets, and feedback. */
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
export interface TraceUXFeedbackInput {
  rating?: number; // 1-5 (stars) or 0-10 (NPS); derived from answers when omitted
  comment?: string;
  surveyId?: string;
  answers?: { id: string; label?: string; value: string }[];
}

export interface TraceUXOptions extends TraceUXIdentity {
  /** The site key shown in the TraceUX dashboard. */
  siteKey: string;
  /** The TraceUX server origin, for example https://traceux.example.com. */
  origin: string;
  /** Load the optional announcements/support/feedback widget when configured. */
  widget?: boolean;
}

export interface TraceUXHandle {
  /** Attach/replace visitor identity mid-session (e.g. right after login). */
  identify: (fields: TraceUXIdentity) => void;
  /** Emit a named custom event, visible as seekable activity in the replay. */
  track: (name: string, trackId?: string) => void;
  /** Record a user lifecycle state as a seekable custom activity. */
  setUserStatus: (status: string) => void;
  /** Alias for setUserStatus for integrations that prefer update semantics. */
  updateUserStatus: (status: string) => void;
  /** Record an application log when the server-side log setting allows it. */
  log: (severity: LogSeverity, message: unknown, ...details: unknown[]) => void;
  debug: (message: unknown, ...details: unknown[]) => void;
  info: (message: unknown, ...details: unknown[]) => void;
  warn: (message: unknown, ...details: unknown[]) => void;
  error: (message: unknown, ...details: unknown[]) => void;
  /** Submit in-app feedback/survey response, linked to the current session. */
  feedback: (input: TraceUXFeedbackInput) => void;
  /** Request a short-lived demo replay link without exposing the session ID. */
  claimReplay: () => Promise<{ url: string; expires_at: number }>;
  /** Stop recording, flush pending data, and remove tracker listeners. */
  stop: () => void;
}

/** Backwards-compatible name for integrations that used the global API shape. */
export type TraceUXApi = TraceUXHandle;

declare global {
  interface Window {
    TraceUX?: TraceUXApi;
    __traceUXStarted?: boolean;
    __traceUXInstance?: TraceUXHandle;
  }
}

const DEFAULTS: TraceUXConfig = {
  sample_rate: 1,
  checkout_interval_ms: 30_000,
  inline_stylesheet: true,
  slim_dom: true,
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

type DeferredClaim = {
  resolve: (value: { url: string; expires_at: number }) => void;
  reject: (reason?: unknown) => void;
};

type QueuedHandle = TraceUXHandle & {
  activate: (runtime: TraceUXHandle) => void;
  fail: () => void;
  isFailed: () => boolean;
};

function unavailableReplay(): Promise<{ url: string; expires_at: number }> {
  return Promise.reject(new Error('TraceUX is not active.'));
}

function createNoopHandle(): TraceUXHandle {
  return {
    identify: () => {},
    track: () => {},
    setUserStatus: () => {},
    updateUserStatus: () => {},
    log: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    feedback: () => {},
    claimReplay: unavailableReplay,
    stop: () => {},
  };
}

function createQueuedHandle(): QueuedHandle {
  let runtime: TraceUXHandle | null = null;
  let failed = false;
  const pending: Array<(next: TraceUXHandle) => void> = [];
  const claims: DeferredClaim[] = [];

  function dispatch(action: (next: TraceUXHandle) => void) {
    if (runtime) {
      action(runtime);
    } else if (!failed) {
      pending.push(action);
    }
  }

  const handle: QueuedHandle = {
    identify(fields) {
      dispatch((next) => next.identify(fields));
    },
    track(name, trackId) {
      dispatch((next) => next.track(name, trackId));
    },
    setUserStatus(status) {
      dispatch((next) => next.setUserStatus(status));
    },
    updateUserStatus(status) {
      dispatch((next) => next.updateUserStatus(status));
    },
    log(severity, message, ...details) {
      dispatch((next) => next.log(severity, message, ...details));
    },
    debug(message, ...details) {
      dispatch((next) => next.debug(message, ...details));
    },
    info(message, ...details) {
      dispatch((next) => next.info(message, ...details));
    },
    warn(message, ...details) {
      dispatch((next) => next.warn(message, ...details));
    },
    error(message, ...details) {
      dispatch((next) => next.error(message, ...details));
    },
    feedback(input) {
      dispatch((next) => next.feedback(input));
    },
    claimReplay() {
      if (runtime) return runtime.claimReplay();
      if (failed) return unavailableReplay();
      return new Promise((resolve, reject) => claims.push({ resolve, reject }));
    },
    stop() {
      if (runtime) {
        runtime.stop();
        return;
      }
      failed = true;
      pending.length = 0;
      for (const claim of claims.splice(0)) claim.reject(new Error('TraceUX was stopped.'));
    },
    activate(next) {
      if (failed) {
        next.stop();
        for (const claim of claims.splice(0)) claim.reject(new Error('TraceUX was stopped.'));
        return;
      }
      runtime = next;
      for (const action of pending.splice(0)) action(next);
      for (const claim of claims.splice(0)) {
        next.claimReplay().then(claim.resolve, claim.reject);
      }
    },
    fail() {
      failed = true;
      pending.length = 0;
      for (const claim of claims.splice(0)) claim.reject(new Error('TraceUX is not active.'));
    },
    isFailed() {
      return failed;
    },
  };
  return handle;
}

export function init(options: TraceUXOptions): TraceUXHandle {
  const noop = createNoopHandle();
  if (typeof window === 'undefined' || typeof document === 'undefined') return noop;

  const siteKey = String(options?.siteKey || '').trim();
  if (!siteKey) throw new Error('TraceUX init requires a siteKey.');

  let origin: string;
  try {
    const parsed = new URL(String(options?.origin || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
    origin = parsed.origin;
  } catch {
    throw new Error('TraceUX init requires a valid http(s) origin.');
  }

  // A page can receive the snippet from both a static tag and an npm/React
  // integration. Only one recorder may own the page or every copy will emit
  // its own stream. Return the existing handle when this is the second caller
  // so both integrations can safely share the same instance.
  if (window.__traceUXStarted) return window.__traceUXInstance || noop;
  window.__traceUXStarted = true;

  const handle = createQueuedHandle();
  window.__traceUXInstance = handle;

  try {
    if (navigator.doNotTrack === '1' || localStorage.getItem('trace_ux_optout') === '1') {
      handle.fail();
      return handle;
    }
  } catch {
    /* storage blocked: proceed anyway; tracking still honors the server config */
  }

  void start(options, origin, siteKey, handle).catch(() => {
    if (!handle.isFailed()) handle.fail();
  });

  return handle;
}

async function start(options: TraceUXOptions, origin: string, siteKey: string, handle: QueuedHandle) {
  const ingestURL = `${origin}/api/ingest/${encodeURIComponent(siteKey)}`;

  // Visitor identity is passed as options for npm/React consumers and is
  // replaced or augmented later through identify().
  const identity = {
    user_id: String(options.userId || ''),
    client_id: String(options.clientId || ''),
    remote_id: String(options.remoteId || ''),
  };

  const cfg = await fetchConfig(origin, siteKey);
  if (Math.random() > cfg.sample_rate) {
    handle.fail();
    return; // sampled out for this visit
  }

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
    if (!sessionId) {
      handle.fail();
      return;
    }
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
  let disposed = false;
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

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
    if (stopped || disposed) return;
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

  function sendFeedback(input: TraceUXFeedbackInput, visitorKey = '') {
    if (disposed) return;
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
        visitor_key: visitorKey,
        user_id: identity.user_id,
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
    if (disposed) return;
    trackPage();
    mountWidgetIfConfigured();
  }

  // Every way a page's URL can change without a document load. pushState and
  // popstate alone miss two common cases: in-page anchors (`<a href="#x">`
  // fires hashchange, not popstate) and routers that use replaceState for
  // filters and tab state.
  let lastTrackedURL = location.href;
  function onURLMaybeChanged() {
    if (disposed) return;
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
  const onResize = () => {
    if (disposed) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const now = `${window.innerWidth}x${window.innerHeight}`;
      if (now === lastSentViewport || disposed) return;
      lastSentViewport = now;
      sendHello();
    }, 400);
  };
  window.addEventListener('resize', onResize, { passive: true });

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
          // Do not copy the page's stylesheets into every FullSnapshot. rrweb
          // inlines them by default, which means a large CSS bundle is stored
          // again on every checkout -- measured at 2.95 MB per snapshot on a
          // real app, dwarfing the DOM itself.
          //
          // The trade is that the replay must load the stylesheet from the
          // recorded origin instead. That is subject to the replay page's CSP
          // (style-src) and to the site serving it cross-origin, so a replay
          // can come back unstyled where either says no.
          inlineStylesheet: cfg.inline_stylesheet !== false,
          // Drop what a replay never needs: comments, <script> tags (they do
          // not execute during playback anyway), favicons, and the block of
          // social/robots/verification meta tags.
          // rrweb's type is `true | 'all' | object | undefined` -- there is no
          // `false`, so opting out means passing undefined.
          slimDOMOptions: cfg.slim_dom === false ? undefined : true,
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

  // Tracked clicks: any element with a trace-ux-track-id attribute reports itself as
  // seekable activity ("trace-ux-track").
  const onTrackedClick = (e: MouseEvent) => {
    if (disposed) return;
    const el = (e.target as Element | null)?.closest?.('[trace-ux-track-id]');
    if (!el) return;
    const trackId = el.getAttribute('trace-ux-track-id') || '';
    sendCustom('click', trackId);
    mountWidgetIfConfigured(trackId);
  };
  document.addEventListener('click', onTrackedClick, { capture: true, passive: true });

  let unifiedWidget: WidgetHandle | null = null;

  // ---- unified widget (announcements + tickets + feedback) ----
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

  let widgetLoading: Promise<void> | null = null;
  let pendingWidgetAction: string | undefined;

  function mountWidgetIfConfigured(triggerAction?: string) {
    // The npm/React integration must opt into the widget explicitly. The
    // script wrapper passes widget: true to preserve the legacy behavior.
    if (options.widget !== true || disposed) return;
    const widgetCfg = cfg.widget;
    if (!widgetCfg || !widgetCfg.enabled) return;

    if (unifiedWidget) {
      // Already mounted: a tracked action just needs to open the right section.
      if (triggerAction && feedbackAvailable(triggerAction)) unifiedWidget.open('feedback');
      return;
    }

    if (triggerAction && feedbackAvailable(triggerAction)) pendingWidgetAction = triggerAction;
    if (widgetLoading) return;

    const feedbackNow = feedbackAvailable(triggerAction);
    const updatesNow = !!widgetCfg.updates_enabled;
    const ticketsNow = !!widgetCfg.tickets_enabled;
    if (!feedbackNow && !updatesNow && !ticketsNow) return;

    // Keep motion and the widget DOM out of the npm entry until a configured
    // site actually needs it. In the IIFE build esbuild inlines this import,
    // retaining the single-file /t.js contract.
    widgetLoading = import('./widget.js')
      .then(({ mountUnifiedWidget }) => {
        if (disposed) return;
        const action = pendingWidgetAction;
        pendingWidgetAction = undefined;
        unifiedWidget = mountUnifiedWidget({
          origin,
          siteKey,
          config: {
            ...widgetCfg,
            feedback_enabled: feedbackAvailable(action),
            tickets_enabled: ticketsNow,
          },
          survey: {
            title: cfg.feedback?.title,
            type: cfg.feedback?.type,
            survey_id: cfg.feedback?.survey_id,
            questions: cfg.feedback?.questions,
          },
          submitFeedback: (input) => sendFeedback(input, input.visitorKey),
          newId,
          sessionId: () => sessionId,
          identity: () => ({ userId: identity.user_id }),
        });
        // An action-triggered survey opens immediately, as it did before the merge.
        if (action && feedbackAvailable(action)) unifiedWidget?.open('feedback');
      })
      .catch(() => {
        // The widget must never break the host page or stop the recording.
        unifiedWidget = null;
        pendingWidgetAction = undefined;
      })
      .finally(() => {
        widgetLoading = null;
      });
  }

  function applyIdentity(fields: TraceUXIdentity, notify = true) {
    if (fields?.userId) identity.user_id = String(fields.userId);
    if (fields?.clientId) identity.client_id = String(fields.clientId);
    if (fields?.remoteId) identity.remote_id = String(fields.remoteId);
    if (notify && !disposed && !stopped) {
      sendHello(); // server adopts non-empty ids for the running session
    }
  }

  async function claimReplay() {
    if (disposed || stopped) throw new Error('TraceUX is not active.');
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
  }

  const runtime: TraceUXHandle = {
    identify: (fields) => applyIdentity(fields),
    track: (name, trackId) => {
      const normalizedName = String(name || 'event').slice(0, 100);
      sendCustom(normalizedName, String(trackId || '').slice(0, 100));
      mountWidgetIfConfigured(normalizedName);
    },
    setUserStatus: (status) => sendCustom('user_status', String(status || '').slice(0, 100)),
    updateUserStatus: (status) => sendCustom('user_status', String(status || '').slice(0, 100)),
    log: (severity, message, ...details) => {
      if (typeof severity !== 'string' || !(severity in LOG_SEVERITY_RANK)) return;
      captureLog(severity, [message, ...details]);
    },
    debug: (message, ...details) => captureLog('debug', [message, ...details]),
    info: (message, ...details) => captureLog('info', [message, ...details]),
    warn: (message, ...details) => captureLog('warn', [message, ...details]),
    error: (message, ...details) => captureLog('error', [message, ...details]),
    feedback: (input) => sendFeedback(input),
    claimReplay,
    stop: shutdown,
  };

  if (handle.isFailed()) return;

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

  mountWidgetIfConfigured();

  // ---- session lifecycle ----

  // Finalizes the current visit: ship what's pending, stop recording, and arm
  // wake listeners so the next deliberate interaction starts a new visit.
  function endSession() {
    if (stopped || disposed) return;
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
    if (disposed) return;
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
    if (disposed) return;
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
  flushTimer = setInterval(() => {
    if (disposed) return;
    flush();
    flushLogs();
  }, flushIntervalMs);
  heartbeatTimer = setInterval(() => {
    if (disposed) return;
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

  const onPageHide = () => {
    if (disposed) return;
    flush(true);
    flushLogs(true);
    if (!stopped) ping(true);
  };
  window.addEventListener('pagehide', onPageHide);

  // Long-hidden tabs end the visit; returning starts a fresh session.
  const onVisibilityChange = () => {
    if (disposed) return;
    if (document.visibilityState === 'hidden') {
      flush(true);
      flushLogs(true);
      if (!stopped) ping(true);
      hideTimer = setTimeout(endSession, SESSION_TTL_MS);
    } else {
      clearTimeout(hideTimer);
      if (stopped) newSession();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  function shutdown() {
    if (disposed) return;
    pendingWidgetAction = undefined;
    if (!stopped) {
      endSession();
    } else {
      flush(true);
      flushLogs(true);
      stopRecording?.();
      restoreConsole?.();
    }
    disposed = true;
    disarmWake();
    clearInterval(flushTimer);
    clearInterval(heartbeatTimer);
    clearTimeout(hideTimer);
    clearTimeout(resizeTimer);
    unifiedWidget?.destroy();
    unifiedWidget = null;
    document.removeEventListener('click', onTrackedClick, { capture: true });
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('popstate', onURLMaybeChanged);
    window.removeEventListener('hashchange', onURLMaybeChanged);
    try {
      history.pushState = origPushState;
      history.replaceState = origReplaceState;
    } catch {
      /* another integration may have replaced the history methods */
    }
    // stop() explicitly releases ownership so a React provider can be mounted
    // again later. While active, the shared guard still prevents HTML, GTM,
    // npm, and React integrations from creating a second recorder.
    if (window.__traceUXInstance === handle) {
      window.__traceUXStarted = false;
      delete window.__traceUXInstance;
      if (window.TraceUX === handle) delete window.TraceUX;
    }
  }

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

  handle.activate(runtime);
}
