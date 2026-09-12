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
      mountFeedbackIfConfigured();
    } catch {
      /* widget must never break the host page */
    }
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
        mountFeedbackIfConfigured(name || 'event');
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
          mountFeedbackIfConfigured(trackId);
        } catch {
          /* widget must never break the host page */
        }
      }
    },
    { capture: true, passive: true },
  );

  // ---- in-app feedback widget ----
  // Enabled and fully configured per site from the TraceUX dashboard (served
  // via /api/config/{key}). Rendered inside a shadow root so host-page CSS
  // cannot break it, and its own neutral look works on any site.
  function mountFeedbackWidget(fb: FeedbackCfg, autoOpen = false): { open: () => void } {
    const side = fb.position === 'left' ? 'left:20px' : 'right:20px';
    const origin = fb.position === 'left' ? 'bottom left' : 'bottom right';
    const surveyId = fb.survey_id || 'default';
    const ap = {
      buttonBg: fb.appearance?.button_bg || '#1a1d29',
      buttonText: fb.appearance?.button_text || '#ffffff',
      buttonLabel: fb.appearance?.button_label || 'Feedback',
      panelBg: fb.appearance?.panel_bg || '#ffffff',
      panelText: fb.appearance?.panel_text || '#1a1d29',
      accent: fb.appearance?.accent || '#f5a623',
      primary: fb.appearance?.primary || '#1a1d29',
      primaryText: fb.appearance?.primary_text || '#ffffff',
      radius: fb.appearance?.radius ?? 14,
      spacing: fb.appearance?.spacing ?? 16,
    };
    const questions: SurveyQuestionCfg[] =
      fb.type === 'custom' && fb.questions && fb.questions.length
        ? fb.questions
        : [
            {
              id: 'rating',
              label: fb.title || 'How was your experience?',
              type: 'rating',
              max: fb.type === 'nps' ? 10 : 5,
            },
            { id: 'comment', label: 'Anything else?', type: 'text', optional: true },
          ];

    const host = document.createElement('div');
    host.id = 'trace-ux-feedback-root';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          --fb-btn-bg: ${ap.buttonBg}; --fb-btn-text: ${ap.buttonText};
          --fb-panel-bg: ${ap.panelBg}; --fb-panel-text: ${ap.panelText};
          --fb-accent: ${ap.accent}; --fb-primary: ${ap.primary}; --fb-primary-text: ${ap.primaryText};
          --fb-radius: ${ap.radius}px; --fb-space: ${ap.spacing}px;
        }
        * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; }
        .btn {
          position: fixed; bottom: var(--fb-space); ${side};
          z-index: 2147483000; display: flex; align-items: center; gap: 8px;
          padding: 10px 16px; border: 0; border-radius: 999px; cursor: pointer;
          background: var(--fb-btn-bg); color: var(--fb-btn-text); font-size: 14px; font-weight: 600;
          box-shadow: 0 6px 20px rgba(0,0,0,.25);
          transition: transform .15s ease, box-shadow .15s ease;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(0,0,0,.3); }
        .panel {
          position: fixed; bottom: calc(var(--fb-space) + 56px); ${side};
          z-index: 2147483000; width: 300px; max-height: 70vh; overflow-y: auto;
          padding: var(--fb-space); background: var(--fb-panel-bg); color: var(--fb-panel-text);
          border-radius: var(--fb-radius);
          box-shadow: 0 12px 40px rgba(0,0,0,.3);
          transform-origin: ${origin};
        }
        .panel.fb-in { animation: fb-in .2s cubic-bezier(.2,.7,.2,1); }
        .panel.fb-out { animation: fb-out .13s ease-in forwards; }
        @keyframes fb-in { from { opacity: 0; transform: translateY(10px) scale(.96); } }
        @keyframes fb-out { to { opacity: 0; transform: translateY(8px) scale(.97); } }
        .panel h3 { margin: 0 0 12px; font-size: 15px; }
        .panel h3:empty { display: none; }
        .q { margin-bottom: var(--fb-space); }
        .q-label { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
        .q.invalid .q-label { color: #d0453e; }
        .q.invalid textarea, .q.invalid .choices { border-color: #d0453e; }
        .stars { display: flex; gap: 6px; }
        .stars button {
          flex: 1; border: 0; background: none; cursor: pointer; font-size: 30px;
          color: color-mix(in srgb, var(--fb-panel-text) 18%, transparent);
          padding: 2px 0; line-height: 1;
          transition: transform .12s ease, color .12s ease;
        }
        .stars button:hover { transform: scale(1.25); }
        .stars button.on { color: var(--fb-accent); animation: fb-pop .18s ease; }
        @keyframes fb-pop { 50% { transform: scale(1.35); } }
        .nps { display: flex; gap: 4px; }
        .nps button {
          flex: 1; padding: 7px 0; border: 1px solid color-mix(in srgb, var(--fb-panel-text) 20%, transparent);
          border-radius: 6px; background: transparent; cursor: pointer; font-size: 13px; color: var(--fb-panel-text);
          transition: background-color .12s ease, color .12s ease, border-color .12s ease;
        }
        .nps button.on { background: var(--fb-primary); color: var(--fb-primary-text); border-color: var(--fb-primary); }
        .choices { display: flex; gap: 6px; flex-wrap: wrap; border: 1px solid transparent; border-radius: 8px; }
        .choices button {
          padding: 7px 12px; border: 1px solid color-mix(in srgb, var(--fb-panel-text) 20%, transparent);
          border-radius: 999px; background: transparent; cursor: pointer; font-size: 13px; color: var(--fb-panel-text);
          transition: background-color .12s ease, color .12s ease, border-color .12s ease;
        }
        .choices button.on { background: var(--fb-primary); color: var(--fb-primary-text); border-color: var(--fb-primary); }
        textarea {
          width: 100%; height: 64px; resize: none;
          border: 1px solid color-mix(in srgb, var(--fb-panel-text) 20%, transparent);
          border-radius: calc(var(--fb-radius) / 2); padding: 8px;
          font-size: 13px; font-family: inherit; background: transparent; color: var(--fb-panel-text);
        }
        textarea::placeholder { color: color-mix(in srgb, var(--fb-panel-text) 45%, transparent); }
        .submit {
          width: 100%; padding: 9px 0; border: 0; cursor: pointer;
          border-radius: calc(var(--fb-radius) / 2);
          background: var(--fb-primary); color: var(--fb-primary-text); font-size: 14px; font-weight: 600;
          transition: transform .12s ease, filter .12s ease;
        }
        .submit:hover { filter: brightness(1.12); }
        .submit:active { transform: scale(.98); }
        .submit:disabled { opacity: .5; }
        .thanks { text-align: center; padding: 8px 0 4px; font-size: 15px; font-weight: 600; }
        [hidden] { display: none !important; }
        @media (prefers-reduced-motion: reduce) {
          .panel.fb-in, .panel.fb-out, .stars button.on { animation: none; }
          .btn, .stars button, .nps button, .choices button, .submit { transition: none; }
          .btn:hover { transform: none; }
        }
      </style>
      <button class="btn" aria-expanded="false"></button>
      <div class="panel" hidden>
        <h3></h3>
        <div class="qs"></div>
        <button class="submit">Send feedback</button>
      </div>
    `;

    const btn = shadow.querySelector('.btn') as HTMLButtonElement;
    const panel = shadow.querySelector('.panel') as HTMLDivElement;
    btn.textContent = ap.buttonLabel;
    (shadow.querySelector('h3') as HTMLHeadingElement).textContent =
      questions[0] && questions[0].type === 'rating' ? '' : fb.title || 'Feedback';
    const qsRoot = shadow.querySelector('.qs') as HTMLDivElement;
    const submit = shadow.querySelector('.submit') as HTMLButtonElement;

    const answers = new Map<string, string>();
    const wraps: Record<string, HTMLDivElement> = {};

    questions.forEach((q) => {
      const wrap = document.createElement('div');
      wrap.className = 'q';
      wraps[q.id] = wrap;
      const label = document.createElement('div');
      label.className = 'q-label';
      label.textContent = q.label;
      wrap.appendChild(label);

      if (q.type === 'rating') {
        const max = q.max === 10 ? 10 : 5;
        const row = document.createElement('div');
        row.className = max === 10 ? 'nps' : 'stars';
        const btns: HTMLButtonElement[] = [];
        const values: number[] = [];
        for (let v = max === 10 ? 0 : 1; v <= max; v++) values.push(v);
        values.forEach((v) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = max === 10 ? String(v) : '★';
          b.addEventListener('click', () => {
            answers.set(q.id, String(v));
            btns.forEach((other, i) =>
              other.classList.toggle('on', max === 10 ? values[i] === v : values[i] <= v),
            );
          });
          btns.push(b);
          row.appendChild(b);
        });
        wrap.appendChild(row);
      } else if (q.type === 'choice') {
        const row = document.createElement('div');
        row.className = 'choices';
        (q.options || []).forEach((opt) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = opt;
          b.addEventListener('click', () => {
            answers.set(q.id, opt);
            row.querySelectorAll('.choice').forEach((c) => c.classList.remove('on'));
            b.classList.add('on');
          });
          row.appendChild(b);
        });
        wrap.appendChild(row);
      } else {
        const ta = document.createElement('textarea');
        ta.placeholder = q.optional ? 'Optional' : '';
        ta.addEventListener('input', () => {
          if (ta.value.trim()) answers.set(q.id, ta.value.trim());
          else answers.delete(q.id);
        });
        wrap.appendChild(ta);
      }
      qsRoot.appendChild(wrap);
    });

    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    function open() {
      clearTimeout(closeTimer);
      panel.classList.remove('fb-out');
      panel.classList.add('fb-in');
      setTimeout(() => panel.classList.remove('fb-in'), 220);
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      if (panel.hidden) return;
      panel.classList.remove('fb-in');
      panel.classList.add('fb-out');
      closeTimer = setTimeout(() => {
        panel.hidden = true;
        panel.classList.remove('fb-out');
      }, 130);
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', () => {
      if (panel.hidden) open();
      else close();
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !(e.composedPath() as Node[]).includes(host)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    submit.addEventListener('click', () => {
      // Required questions must have an answer.
      const missing = questions.filter((q) => !q.optional && !answers.has(q.id));
      if (missing.length) {
        missing.forEach((q) => wraps[q.id]?.classList.add('invalid'));
        return;
      }
      submit.disabled = true;
      const answerList = questions
        .filter((q) => answers.has(q.id))
        .map((q) => ({ id: q.id, label: q.label, value: answers.get(q.id) as string }));
      const ratingAnswer = questions.find((q) => q.type === 'rating' && answers.has(q.id));
      const textAnswer = questions.find((q) => q.type === 'text' && answers.has(q.id));
      window.TraceUX?.feedback({
        rating: ratingAnswer ? Number(answers.get(ratingAnswer.id)) : 0,
        comment: textAnswer ? (answers.get(textAnswer.id) as string) : '',
        surveyId,
        answers: answerList,
      });
      panel.innerHTML = '<div class="thanks">Thanks for your feedback!</div>';
      setTimeout(close, 1800);
    });

    document.body.appendChild(host);
    if (autoOpen) open();
    return { open };
  }

  // Trigger configuration (from the dashboard): 'always' mounts immediately,
  // 'page' waits for a matching URL pattern, 'action' waits for a matching
  // tracked action (trace-ux-track-id click or window.TraceUX.track).
  let feedbackWidget: { open: () => void } | null = null;
  function matchesPages(patterns: string[]): boolean {
    const path = location.pathname;
    const href = location.href;
    return patterns.some((p) => {
      const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return re.test(path) || re.test(href);
    });
  }
  function mountFeedbackIfConfigured(triggerAction?: string) {
    if (feedbackWidget) {
      if (triggerAction) feedbackWidget.open();
      return;
    }
    if (!cfg.feedback || !cfg.feedback.enabled) return;
    const trigger = cfg.feedback.trigger;
    const mode = trigger?.mode || 'always';
    if (mode === 'action') {
      if (triggerAction && (trigger?.actions || []).includes(triggerAction)) {
        feedbackWidget = mountFeedbackWidget(cfg.feedback, true);
      }
      return;
    }
    if (mode === 'page' && !matchesPages(trigger?.pages || [])) return;
    feedbackWidget = mountFeedbackWidget(cfg.feedback, false);
  }

  try {
    mountFeedbackIfConfigured();
  } catch {
    /* widget must never break the host page */
  }

  // Announcements are intentionally isolated from recording. A failed feed
  // request never affects feedback or the host page.
  async function mountAnnouncementsWidget() {
    if (!cfg.updates?.enabled) return;
    const announcementSiteKey = siteKey as string;
    let visitor = '';
    try {
      const key = `trace_ux_visitor_${announcementSiteKey}`;
      visitor = localStorage.getItem(key) || newId();
      if (visitor) localStorage.setItem(key, visitor);
    } catch { visitor = newId(); }
    const res = await fetch(`${origin}/api/updates/${encodeURIComponent(announcementSiteKey)}?visitor=${encodeURIComponent(visitor)}`);
    if (!res.ok) return;
    const updates = await res.json() as Array<{id:number;title:string;summary:string;body:string;release_label:string;link_url:string;published_at:number;reactions:number;comments:number;liked?:boolean;read?:boolean}>;
    const host = document.createElement('div'); host.id = 'trace-ux-announcements-root'; const shadow = host.attachShadow({mode:'open'});
    const left = cfg.updates.position === 'left'; const unread = updates.filter(u=>!u.read).length; let unreadCount = unread;
    const darkTheme = cfg.updates.appearance?.theme === 'dark';
    const accent = cfg.updates.appearance?.accent || '#2f7d4a';
    const ua = { buttonBg:accent, buttonText:'#ffffff', buttonLabel:cfg.updates.appearance?.button_label||'Announcements', panelBg:darkTheme?'#121b16':'#ffffff', panelText:darkTheme?'#eef5f0':'#142018', accent, actionBg:accent, actionText:'#ffffff', radius:cfg.updates.appearance?.radius||18, maxWidth:cfg.updates.appearance?.max_width||440 };
    shadow.innerHTML = `<style>
      :host{all:initial}*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.au-btn{position:fixed;z-index:2147483000;bottom:${cfg.feedback?.enabled?'68px':'16px'};${left?'left':'right'}:20px;border:0;border-radius:999px;padding:11px 16px;background:#142019;color:#fff;font-weight:650;font-size:14px;box-shadow:0 8px 28px #0004;cursor:pointer}.au-dot{display:inline-grid;place-items:center;margin-left:7px;min-width:18px;height:18px;padding:0 5px;border-radius:10px;background:#66c983;color:#08140c;font-size:11px}.au-panel{position:fixed;z-index:2147483000;bottom:${cfg.feedback?.enabled?'120px':'68px'};${left?'left':'right'}:20px;width:clamp(300px,34vw,440px);max-width:calc(100vw - 24px);max-height:min(700px,78vh);overflow:auto;background:#fff;color:#142018;border:1px solid #14201816;border-radius:18px;box-shadow:0 24px 60px #0004}.au-head{position:sticky;top:0;background:#fff;padding:18px 20px 14px;border-bottom:1px solid #14201816;display:flex;justify-content:space-between;align-items:center}.au-head strong{font-size:17px}.au-close{border:0;background:#f1f4ef;border-radius:50%;width:30px;height:30px;cursor:pointer}.au-list{padding:8px}.au-item{width:100%;text-align:left;border:0;border-bottom:1px solid #14201812;background:#fff;padding:16px 14px;cursor:pointer}.au-label{color:#2f7d4a;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.08em}.au-item h3,.au-detail h2{margin:6px 0;font-size:16px}.au-item p,.au-detail p{margin:0;color:#59665d;font-size:13px;line-height:1.55}.au-meta{display:flex;gap:12px;color:#7b867e;font-size:11px;margin-top:10px}.au-detail{padding:20px}.au-back,.au-like,.au-send{border:0;border-radius:9px;padding:8px 11px;cursor:pointer;font-weight:650}.au-back{background:#f1f4ef}.au-like,.au-send{background:#142019;color:#fff}.au-body{white-space:pre-wrap;margin:16px 0!important;color:#34423a!important}.au-comment{display:flex;gap:7px;margin-top:18px}.au-comment input{flex:1;min-width:0;border:1px solid #14201826;border-radius:9px;padding:9px}.au-empty{padding:35px 20px;text-align:center;color:#6b786f}[hidden]{display:none!important}@media(max-width:560px){.au-panel{left:12px!important;right:12px!important;bottom:12px;width:auto;max-width:none;max-height:88vh;border-radius:20px}.au-btn{bottom:16px}}@media(prefers-reduced-motion:no-preference){.au-panel{animation:au-in .18s ease-out}@keyframes au-in{from{opacity:0;transform:translateY(8px)}}}</style><button class="au-btn" aria-expanded="${unread > 0}">Announcements${unread?`<span class="au-dot">${unread}</span>`:''}</button><section class="au-panel" ${unread ? '' : 'hidden'}><header class="au-head"><strong>Announcements</strong><button class="au-close" aria-label="Close">×</button></header><div class="au-content"></div></section>`;
    const polish = document.createElement('style');
    polish.textContent = `.au-btn{background:${ua.buttonBg}!important;color:${ua.buttonText}!important}.au-panel,.au-head,.au-item{background:${ua.panelBg}!important;color:${ua.panelText}!important}.au-panel{width:clamp(300px,34vw,${ua.maxWidth}px)!important;border-radius:${ua.radius}px!important}.au-label{color:${ua.accent}!important}.au-like,.au-send{background:${ua.actionBg}!important;color:${ua.actionText}!important}.au-like{display:inline-flex!important;align-items:center!important;gap:5px!important}.au-close{display:grid!important;place-items:center!important;background:color-mix(in srgb,${ua.panelText} 8%,${ua.panelBg})!important;color:${ua.panelText}!important;border:1px solid color-mix(in srgb,${ua.panelText} 12%,transparent)!important}.au-close svg{display:block}.au-back{background:color-mix(in srgb,${ua.panelText} 8%,${ua.panelBg})!important;color:${ua.panelText}!important;border:1px solid color-mix(in srgb,${ua.panelText} 14%,transparent)!important;margin-bottom:4px}.au-back:hover{filter:brightness(.96)}.au-thanks{width:100%;padding:11px 13px;border-radius:9px;background:#e9f5ed;color:#24663b;font-size:13px;font-weight:650;text-align:center}`;
    polish.textContent += `.au-panel{bottom:${cfg.feedback?.enabled?'68px':'16px'}!important;transform-origin:bottom ${left?'left':'right'};animation:none!important}.au-panel.au-enter{animation:au-expand .22s cubic-bezier(.2,.8,.2,1)!important}.au-panel.au-leave{animation:au-collapse .16s ease-in forwards!important}@keyframes au-expand{from{opacity:0;transform:translateY(8px) scale(.88)}to{opacity:1;transform:none}}@keyframes au-collapse{to{opacity:0;transform:translateY(8px) scale(.88)}}@media(prefers-reduced-motion:reduce){.au-panel.au-enter,.au-panel.au-leave{animation:none!important}}`;
    shadow.appendChild(polish);
    const panel=shadow.querySelector('.au-panel') as HTMLElement, content=shadow.querySelector('.au-content') as HTMLElement, launch=shadow.querySelector('.au-btn') as HTMLButtonElement;
    if (launch.firstChild) launch.firstChild.textContent = ua.buttonLabel;
    launch.hidden = !panel.hidden;
    const closeButton = shadow.querySelector('.au-close') as HTMLButtonElement;
    closeButton.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    const heartSVG = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 1024 1024"><path fill="currentColor" d="M923 283.6a260 260 0 0 0-56.9-82.8 264.4 264.4 0 0 0-84-55.5A265.3 265.3 0 0 0 679.7 125c-49.3 0-97.4 13.5-139.2 39q-15 9.15-28.5 20.1-13.5-10.95-28.5-20.1c-41.8-25.5-89.9-39-139.2-39-35.5 0-69.9 6.8-102.4 20.3-31.4 13-59.7 31.7-84 55.5a258.4 258.4 0 0 0-56.9 82.8c-13.9 32.3-21 66.6-21 101.9 0 33.3 6.8 68 20.3 103.3 11.3 29.5 27.5 60.1 48.2 91 32.8 48.9 77.9 99.9 133.9 151.6 92.8 85.7 184.7 144.9 188.6 147.3l23.7 15.2c10.5 6.7 24 6.7 34.5 0l23.7-15.2c3.9-2.5 95.7-61.6 188.6-147.3 56-51.7 101.1-102.7 133.9-151.6 20.7-30.9 37-61.5 48.2-91 13.5-35.3 20.3-70 20.3-103.3.1-35.3-7-68.6-20.9-101.9M512 814.8S156 586.7 156 385.5C156 283.6 240.3 201 344.3 201c73.1 0 136.5 40.8 167.7 100.4C543.2 241.8 606.6 201 679.7 201c104 0 188.3 82.6 188.3 184.5 0 201.2-356 429.3-356 429.3"/></svg>';
    new MutationObserver(()=>{const like=content.querySelector('.au-like');if(!like)return;like.childNodes.forEach(node=>{if(node.nodeType===Node.TEXT_NODE&&node.textContent){const clean=node.textContent.replace(/^\s*[♡♥]\s*/, ' ');if(clean!==node.textContent)node.textContent=clean}});if(!like.querySelector('svg'))like.insertAdjacentHTML('afterbegin',heartSVG)}).observe(content,{childList:true,subtree:true});
    const post=(id:number,path:string,body:object)=>fetch(`${origin}/api/updates/${encodeURIComponent(announcementSiteKey)}/${id}/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitor_key:visitor,...body})});
    function feed(){content.innerHTML='';if(!updates.length){content.innerHTML='<div class="au-empty">No announcements yet.</div>';return}updates.forEach(u=>{const b=document.createElement('button');b.className='au-item';b.innerHTML=`<span class="au-label">${escapeHTML(u.release_label||'Update')}</span><h3>${escapeHTML(u.title)}</h3><p>${escapeHTML(u.summary||u.body.slice(0,140))}</p><span class="au-meta">${u.reactions} likes · ${u.comments} comments</span>`;b.onclick=()=>openDetail(u);content.appendChild(b)})}
    function openDetail(u:(typeof updates)[number]){if(!u.read){unreadCount=Math.max(0,unreadCount-1);const dot=launch.querySelector('.au-dot');if(dot){if(unreadCount)dot.textContent=String(unreadCount);else dot.remove()}}detail(u)}
    function detail(u:(typeof updates)[number]){u.read=true;void post(u.id,'read',{});content.innerHTML=`<div class="au-detail"><button class="au-back">← Back</button><div class="au-label">${escapeHTML(u.release_label||'Update')}</div><h2>${escapeHTML(u.title)}</h2><p class="au-body">${escapeHTML(u.body||u.summary)}</p>${u.link_url?`<p><a href="${escapeHTML(u.link_url)}" target="_blank" rel="noopener">Learn more ↗</a></p>`:''}<button class="au-like">${u.liked?'♥ Liked':'♡ Like'} · ${u.reactions}</button><form class="au-comment"><input maxlength="1000" placeholder="Leave a comment" aria-label="Comment"><button class="au-send">Send</button></form></div>`;(content.querySelector('.au-back') as HTMLButtonElement).onclick=feed;const like=content.querySelector('.au-like') as HTMLButtonElement;like.onclick=()=>{u.liked=!u.liked;u.reactions+=u.liked?1:-1;like.textContent=`${u.liked?'♥ Liked':'♡ Like'} · ${u.reactions}`;void post(u.id,'reaction',{liked:u.liked})};const form=content.querySelector('form') as HTMLFormElement;form.onsubmit=async e=>{e.preventDefault();const input=form.querySelector('input') as HTMLInputElement,send=form.querySelector('button') as HTMLButtonElement,body=input.value.trim();if(!body)return;input.disabled=true;send.disabled=true;const response=await post(u.id,'comments',{body}).catch(()=>null);if(!response?.ok){input.disabled=false;send.disabled=false;return}u.comments+=1;form.innerHTML='<div class="au-thanks" role="status">Thanks for your comment.</div>';setTimeout(()=>form.remove(),5000)}}
    function escapeHTML(v:string){const d=document.createElement('div');d.textContent=v;return d.innerHTML}
    function openPanel(){panel.classList.remove('au-leave');panel.hidden=false;panel.classList.add('au-enter');launch.hidden=true;launch.setAttribute('aria-expanded','true');setTimeout(()=>panel.classList.remove('au-enter'),240)}
    function closePanel(){panel.classList.remove('au-enter');panel.classList.add('au-leave');setTimeout(()=>{panel.hidden=true;panel.classList.remove('au-leave');launch.hidden=false;launch.setAttribute('aria-expanded','false')},170)}
    feed();if(!panel.hidden){panel.classList.add('au-enter');setTimeout(()=>panel.classList.remove('au-enter'),240)}launch.onclick=openPanel;closeButton.onclick=closePanel;document.body.appendChild(host);
  }
  void mountAnnouncementsWidget().catch(() => {});

  sendHello();
  store.set('trace_ux_sid', sessionId);
  store.set('trace_ux_sid_ts', String(startedAt));
  store.set('trace_ux_log_seq', String(logSeq));

  startRecording();
  startLogTracking();
  trackPage();

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
