/**
 * TraceUX tracker: records DOM event streams with rrweb and ships them in
 * compressed batches to a TraceUX server. Loaded as:
 *   <script async src="https://your-server/t.js" data-site="SITE_KEY"></script>
 *
 * Privacy: all form inputs are masked, elements with class `trux-block` are
 * removed from the recording, `trux-mask` masks their text, and Do Not Track /
 * localStorage.trux_optout=1 disables tracking entirely.
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

type TruxConfig = {
  sample_rate: number;
  checkout_interval_ms: number;
  mask_inputs: boolean;
  flush_interval_ms: number;
  flush_batch_size: number;
  recording_enabled?: boolean;
  feedback?: FeedbackCfg;
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
}

declare global {
  interface Window {
    TraceUX?: TraceUXApi;
  }
}

const DEFAULTS: TruxConfig = {
  sample_rate: 1,
  checkout_interval_ms: 30_000,
  mask_inputs: true,
  flush_interval_ms: 5_000,
  flush_batch_size: 20,
  recording_enabled: true, // dashboard can turn recording off per site
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
    if (navigator.doNotTrack === '1' || localStorage.getItem('trux_optout') === '1') return;
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
  let sessionId = store.get('trux_sid');
  let seq = Number(store.get('trux_seq') || '0');
  let pageIdx = Number(store.get('trux_page') || '-1');
  let activeMs = Number(store.get('trux_active') || '0');
  let startedAt = Date.now();
  const stale =
    !sessionId || startedAt - Number(store.get('trux_sid_ts') || '0') > SESSION_TTL_MS;
  // A session that already hit the 2h cap must not swallow this page load:
  // start a fresh one right away instead of recording into the old session
  // until the first tick notices.
  if (stale || activeMs >= MAX_SESSION_MS) {
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
    store.set('trux_seq', String(seq));
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
    store.set('trux_page', String(pageIdx));
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
            if (buffer.length >= cfg.flush_batch_size) flush();
          },
          checkoutEveryNms: cfg.checkout_interval_ms,
          maskAllInputs: cfg.mask_inputs,
          // Elements carrying trux-mask as a class OR a bare attribute have their
          // text masked, wherever they appear in the page.
          maskTextClass: 'trux-mask',
          maskTextSelector: '.trux-mask,[trux-mask],[data-trux-mask]',
          blockClass: 'trux-block',
          ignoreClass: 'trux-ignore',
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
  };

  // Tracked clicks: any element with a ws-track-id attribute reports itself as
  // seekable activity ("webshots-track").
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('[ws-track-id]');
      if (el) {
        const trackId = el.getAttribute('ws-track-id') || '';
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
  // Enabled and fully configured per site from the Webshots dashboard (served
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
    host.id = 'ws-feedback-root';
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
      <button class="btn" aria-expanded="false">${ap.buttonLabel}</button>
      <div class="panel" hidden>
        <h3></h3>
        <div class="qs"></div>
        <button class="submit">Send feedback</button>
      </div>
    `;

    const btn = shadow.querySelector('.btn') as HTMLButtonElement;
    const panel = shadow.querySelector('.panel') as HTMLDivElement;
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
      window.Webshots?.feedback({
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
  // tracked action (ws-track-id click or window.Webshots.track).
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

  // Starts a fresh visit. `finalize` ships the tail of the outgoing session
  // first (pending events + final ping) — required for the 2h cap split, where
  // the visit is still live and its buffered events would otherwise carry the
  // NEW session id. Wake-from-dead sessions skip it: endSession already flushed.
  function newSession(finalize = false) {
    if (finalize && !stopped) {
      flush(true);
      ping(true);
    }
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
      newSession(true);
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
