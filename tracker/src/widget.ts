// The unified TraceUX widget: one launcher, one panel, two sections.
//
// "What's new" (announcements) and "Feedback" (the survey) used to be two
// independent shadow-DOM widgets stacked on top of each other in the corner of
// the page. They are now one surface. When a site enables both, the panel
// carries a tab strip; when it enables only one, the tab strip is omitted and
// the panel opens straight into whichever section exists.
//
// Everything visitor-facing is built with createElement/textContent rather
// than innerHTML — announcement titles, bodies and labels are operator-authored
// text arriving over the wire, and the widget renders them inside the host
// page's document.
import { animate } from 'motion/mini';
import { widgetCSS } from './widget-styles';

export type WidgetAppearanceCfg = {
  theme?: 'light' | 'dark';
  accent?: string;
  button_bg?: string;
  button_text?: string;
  panel_bg?: string;
  panel_text?: string;
  radius?: number;
  max_width?: number;
  spacing?: number;
  icon_url?: string;
  launcher_text?: string;
};

export type WidgetCfg = {
  enabled: boolean;
  updates_enabled: boolean;
  feedback_enabled: boolean;
  position?: string;
  title?: string;
  updates_label?: string;
  feedback_label?: string;
  poll_interval_ms?: number;
  appearance?: WidgetAppearanceCfg;
};

export type WidgetQuestion = {
  id: string;
  label: string;
  type: 'rating' | 'text' | 'choice';
  max?: number;
  options?: string[];
  optional?: boolean;
};

export type WidgetSurvey = {
  title?: string;
  type?: string;
  survey_id?: string;
  questions?: WidgetQuestion[];
};

export type Announcement = {
  id: number;
  title: string;
  summary: string;
  body: string;
  release_label: string;
  link_url: string;
  published_at: number;
  reactions: number;
  comments: number;
  liked?: boolean;
  read?: boolean;
};

export type WidgetHost = {
  origin: string;
  siteKey: string;
  config: WidgetCfg;
  survey: WidgetSurvey;
  /** Routes through the tracker so the response is linked to the recording. */
  submitFeedback: (input: {
    rating: number;
    comment: string;
    surveyId: string;
    answers: { id: string; label?: string; value: string }[];
  }) => void;
  newId: () => string;
};

export type WidgetHandle = {
  open: (section?: 'updates' | 'feedback') => void;
  close: () => void;
  destroy: () => void;
};

type Section = 'updates' | 'feedback';

// ---- motion ----------------------------------------------------------------

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1];
const EASE_POP: [number, number, number, number] = [0.34, 1.4, 0.64, 1];

function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Duration helper: collapses every animation to an instant state change when
 *  the visitor has asked for reduced motion. */
function dur(seconds: number): number {
  return reducedMotion() ? 0 : seconds;
}

// ---- small DOM helpers ------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svg(paths: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '2');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = paths; // static, authored here — never visitor or API data
  return node;
}

const ICONS = {
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  comment: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 20.5l1.5-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>',
  megaphone: '<path d="m3 11 15-7v16L3 13zM3 11v2a3 3 0 0 0 3 3h1v-6H6a3 3 0 0 0-3 1z"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
};

/** Only ever attach http(s) links. The server already validates link_url, but
 *  the widget runs on someone else's page and re-checks before writing an href. */
function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw, location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---- widget ----------------------------------------------------------------

export function mountUnifiedWidget(host: WidgetHost): WidgetHandle | null {
  const cfg = host.config;
  if (!cfg.enabled) return null;

  const ap = cfg.appearance || {};
  const accent = ap.accent || '#2f7d4a';
  const dark = ap.theme === 'dark';
  const position = cfg.position === 'left' ? 'left' : 'right';

  // Visitor key: stable per browser + site, used for likes/reads/comments.
  let visitor = '';
  try {
    const storageKey = `trace_ux_visitor_${host.siteKey}`;
    visitor = localStorage.getItem(storageKey) || host.newId();
    localStorage.setItem(storageKey, visitor);
  } catch {
    visitor = host.newId();
  }

  const root = el('div', 'root');
  const container = el('div');
  container.id = 'trace-ux-widget-root';
  const shadow = container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = widgetCSS();
  shadow.appendChild(style);
  shadow.appendChild(root);

  root.style.setProperty('--w-accent', accent);
  root.style.setProperty('--w-button-bg', ap.button_bg || accent);
  root.style.setProperty('--w-button-text', ap.button_text || '#ffffff');
  root.style.setProperty('--w-panel-bg', ap.panel_bg || (dark ? '#121b16' : '#ffffff'));
  root.style.setProperty('--w-panel-text', ap.panel_text || (dark ? '#eef5f0' : '#142018'));
  root.style.setProperty('--w-radius', `${ap.radius || 18}px`);
  root.style.setProperty('--w-max-width', `${ap.max_width || 440}px`);
  root.style.setProperty('--w-space', `${ap.spacing || 16}px`);
  root.style.setProperty('direction', position === 'left' ? 'rtl' : 'ltr');

  // Everything inside the panel reads left-to-right; only the corner the
  // widget anchors to flips, which is what the logical `inset-inline-end`
  // properties in the stylesheet key off.
  const ltr = <T extends HTMLElement>(node: T): T => {
    node.style.direction = 'ltr';
    return node;
  };

  // ---- state ----
  let announcements: Announcement[] = [];
  let seenIds = new Set<number>();
  let section: Section = cfg.updates_enabled ? 'updates' : 'feedback';
  let panelOpen = false;
  let submitted = false;
  let destroyed = false;

  const bothSections = cfg.updates_enabled && cfg.feedback_enabled;
  const unreadCount = () => announcements.filter((a) => !a.read).length;

  // ---- launcher ----
  const launcher = ltr(el('button', 'launcher'));
  launcher.type = 'button';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-haspopup', 'dialog');

  // With a custom icon the launcher is the icon: a 48x48 mark, no text label.
  // Without one it stays a labelled pill so the visitor knows what it opens.
  const hasCustomIcon = !!ap.icon_url;
  const launcherText = ap.launcher_text || 'Help & updates';
  const launcherIcon = el('span', 'launcher__icon');
  const launcherBadge = el('span', 'launcher__badge');
  launcherBadge.hidden = true;

  const launcherLabel = el('span', undefined, launcherText);

  // Falling back to the built-in mark also restores the labelled pill, so a
  // broken image never leaves a blank circle in the corner of the page.
  const useDefaultMark = () => {
    launcher.classList.remove('launcher--icon');
    launcherIcon.replaceChildren(svg(cfg.updates_enabled ? ICONS.megaphone : ICONS.spark));
    if (!launcher.contains(launcherLabel)) launcherIcon.after(launcherLabel);
  };

  if (hasCustomIcon) {
    launcher.classList.add('launcher--icon');
    const img = el('img');
    img.src = host.origin + (ap.icon_url as string);
    img.alt = '';
    // A custom icon that fails to load must not leave an empty circle.
    img.addEventListener('error', useDefaultMark);
    launcherIcon.appendChild(img);
    launcher.append(launcherIcon, launcherBadge);
    // The label still names the control for assistive tech.
    launcher.setAttribute('aria-label', launcherText);
  } else {
    launcherIcon.appendChild(svg(cfg.updates_enabled ? ICONS.megaphone : ICONS.spark));
    launcher.append(launcherIcon, launcherLabel, launcherBadge);
  }

  // ---- panel shell ----
  const panel = ltr(el('div', 'panel'));
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', cfg.title || 'Help and updates');
  panel.hidden = true;
  panel.style.transformOrigin = position === 'left' ? 'bottom left' : 'bottom right';

  const head = el('div', 'panel__head');
  const title = el('h2', 'panel__title', cfg.title || 'Help & updates');
  const closeBtn = el('button', 'icon-btn');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(svg(ICONS.close));
  head.append(title, closeBtn);

  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const tabUpdates = el('button', 'tab');
  const tabFeedback = el('button', 'tab');
  const tabMarker = el('div', 'tabs__marker');
  const updatesCount = el('span', 'tab__count');
  updatesCount.hidden = true;

  tabUpdates.type = 'button';
  tabUpdates.setAttribute('role', 'tab');
  tabUpdates.append(document.createTextNode(cfg.updates_label || "What's new"), updatesCount);
  tabFeedback.type = 'button';
  tabFeedback.setAttribute('role', 'tab');
  tabFeedback.textContent = cfg.feedback_label || 'Feedback';
  tabs.append(tabUpdates, tabFeedback, tabMarker);
  tabs.hidden = !bothSections;

  const body = el('div', 'body');
  panel.append(head, tabs, body);
  root.append(panel, launcher);

  // ---- toast: a newly published post announcing itself ----
  const toast = ltr(el('div', 'panel'));
  toast.hidden = true;
  toast.style.transformOrigin = position === 'left' ? 'bottom left' : 'bottom right';
  toast.setAttribute('role', 'status');
  root.appendChild(toast);

  // ---- animation helpers ----
  function animateIn(node: HTMLElement) {
    return animate(
      node,
      { opacity: [0, 1], transform: ['translateY(10px) scale(.96)', 'none'] },
      { duration: dur(0.26), ease: EASE_OUT },
    );
  }
  function animateOut(node: HTMLElement) {
    return animate(
      node,
      { opacity: [1, 0], transform: ['none', 'translateY(8px) scale(.96)'] },
      { duration: dur(0.15), ease: EASE_IN },
    );
  }
  /** Cross-fades a view swap so list -> detail -> list reads as movement
   *  rather than a jump. `dir` is 1 going deeper, -1 coming back: going deeper
   *  settles from slightly small, coming back from slightly large, which reads
   *  as depth without moving anything sideways.
   *
   *  Deliberately no translate: the body is a vertical scroll container, so a
   *  translated full-width child extends its scroll box and the panel flashes
   *  a horizontal scrollbar mid-transition. Scaling about the centre cannot
   *  overflow on either axis. */
  function swapView(build: () => HTMLElement, dir: 1 | -1) {
    const next = build();
    body.replaceChildren(next);
    body.scrollTop = 0;
    animate(
      next,
      { opacity: [0, 1], transform: [`scale(${dir === 1 ? 0.975 : 1.02})`, 'none'] },
      { duration: dur(0.26), ease: EASE_OUT },
    );
    return next;
  }
  function stagger(nodes: HTMLElement[]) {
    if (reducedMotion()) return;
    nodes.slice(0, 8).forEach((node, i) => {
      animate(
        node,
        { opacity: [0, 1], transform: ['scale(.985)', 'none'] },
        { duration: 0.28, delay: 0.03 + i * 0.035, ease: EASE_OUT },
      );
    });
  }

  function syncBadges() {
    const n = unreadCount();
    launcherBadge.hidden = n === 0;
    launcherBadge.textContent = String(n);
    if (hasCustomIcon) {
      launcher.setAttribute('aria-label', n ? `${launcherText} (${n} unread)` : launcherText);
    }
    updatesCount.hidden = n === 0;
    updatesCount.textContent = String(n);
  }

  function moveTabMarker(animated = true) {
    const active = section === 'updates' ? tabUpdates : tabFeedback;
    const width = active.offsetWidth;
    const offset = active.offsetLeft - tabs.offsetLeft;
    tabMarker.style.width = `${width}px`;
    if (!animated || reducedMotion()) {
      tabMarker.style.transform = `translateX(${offset}px)`;
      return;
    }
    animate(tabMarker, { transform: `translateX(${offset}px)` }, { duration: 0.32, ease: EASE_OUT });
  }

  // ---- announcements: list ----
  function buildUpdatesList(): HTMLElement {
    const view = el('div', 'view');
    if (!announcements.length) {
      const empty = el('div', 'empty');
      const mark = el('div', 'empty__mark');
      mark.appendChild(svg(ICONS.megaphone));
      empty.append(
        mark,
        el('p', 'empty__title', 'Nothing new yet'),
        el('p', 'empty__note', "Product updates will show up here as soon as they're published."),
      );
      view.appendChild(empty);
      return view;
    }
    const items: HTMLElement[] = [];
    announcements.forEach((a) => {
      const item = el('button', 'item');
      item.type = 'button';

      const top = el('div', 'item__top');
      top.appendChild(el('span', 'eyebrow', a.release_label || 'Update'));
      if (!a.read) top.appendChild(el('span', 'item__dot'));
      item.appendChild(top);

      item.appendChild(el('h3', 'item__title', a.title));
      const excerpt = (a.summary || a.body || '').trim();
      if (excerpt) item.appendChild(el('p', 'item__excerpt', excerpt));

      const meta = el('div', 'item__meta');
      const likes = el('span');
      likes.append(svg(ICONS.heart), document.createTextNode(String(a.reactions)));
      const comments = el('span');
      comments.append(svg(ICONS.comment), document.createTextNode(String(a.comments)));
      meta.append(likes, comments);
      item.appendChild(meta);

      item.addEventListener('click', () => openDetail(a));
      items.push(item);
      view.appendChild(item);
    });
    queueMicrotask(() => stagger(items));
    return view;
  }

  // ---- announcements: detail ----
  function buildDetail(a: Announcement): HTMLElement {
    const view = el('div', 'view');
    const detail = el('div', 'detail');

    const back = el('button', 'back');
    back.type = 'button';
    back.append(svg(ICONS.back), document.createTextNode('All updates'));
    back.addEventListener('click', () => showSection('updates', -1));
    detail.appendChild(back);

    detail.appendChild(el('div', 'eyebrow', a.release_label || 'Update'));
    detail.appendChild(el('h3', 'detail__title', a.title));
    const bodyText = (a.body || a.summary || '').trim();
    if (bodyText) detail.appendChild(el('p', 'detail__body', bodyText));

    const href = a.link_url ? safeHref(a.link_url) : null;
    if (href) {
      const link = el('a', 'detail__link', 'Learn more');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.appendChild(svg(ICONS.external));
      detail.appendChild(link);
    }

    // Reactions + comments stay the per-announcement engagement surface.
    const actions = el('div', 'detail__actions');
    const like = el('button', 'like');
    like.type = 'button';
    const heart = svg(ICONS.heart);
    heart.classList.add('like__heart');
    const likeCount = document.createTextNode('');
    like.append(heart, likeCount);
    const paintLike = () => {
      like.classList.toggle('on', !!a.liked);
      heart.setAttribute('fill', a.liked ? 'currentColor' : 'none');
      likeCount.textContent = plural(a.reactions, 'like', 'likes');
      like.setAttribute('aria-pressed', a.liked ? 'true' : 'false');
    };
    paintLike();
    like.addEventListener('click', () => {
      a.liked = !a.liked;
      a.reactions = Math.max(0, a.reactions + (a.liked ? 1 : -1));
      paintLike();
      if (a.liked) {
        animate(heart, { transform: ['scale(1)', 'scale(1.32)', 'scale(1)'] }, { duration: dur(0.36), ease: EASE_POP });
      }
      void post(a.id, 'reaction', { liked: a.liked });
    });
    actions.appendChild(like);
    detail.appendChild(actions);

    const composer = el('form', 'composer');
    const input = el('input', 'field');
    input.type = 'text';
    input.maxLength = 1000;
    input.placeholder = 'Leave a comment';
    input.setAttribute('aria-label', 'Comment');
    const send = el('button', 'send', 'Send');
    send.type = 'submit';
    composer.append(input, send);
    composer.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      send.disabled = true;
      const res = await post(a.id, 'comments', { body: text }).catch(() => null);
      if (!res || !res.ok) {
        input.disabled = false;
        send.disabled = false;
        // 429 here is the per-visitor comment cap, not a transient failure.
        const note = el('div', 'inline-note', res && res.status === 429
          ? "You've already sent the maximum number of comments on this update."
          : 'That comment could not be sent. Please try again.');
        composer.after(note);
        animateIn(note);
        setTimeout(() => note.remove(), 6000);
        return;
      }
      a.comments += 1;
      const done = el('div', 'inline-note', 'Thanks — your comment was sent.');
      composer.replaceWith(done);
      animateIn(done);
    });
    detail.appendChild(composer);

    view.appendChild(detail);
    return view;
  }

  function openDetail(a: Announcement) {
    if (!a.read) {
      a.read = true;
      syncBadges();
      void post(a.id, 'read', {});
    }
    swapView(() => buildDetail(a), 1);
  }

  // ---- feedback ----
  function buildFeedback(): HTMLElement {
    const view = el('div', 'view');
    if (submitted) {
      view.appendChild(buildThanks());
      return view;
    }
    const survey = host.survey || {};
    const questions: WidgetQuestion[] =
      survey.type === 'custom' && survey.questions && survey.questions.length
        ? survey.questions
        : [
            {
              id: 'rating',
              label: survey.title || 'How was your experience?',
              type: 'rating',
              max: survey.type === 'nps' ? 10 : 5,
            },
            { id: 'comment', label: 'Anything else?', type: 'text', optional: true },
          ];

    const form = el('div', 'form');
    if (survey.type === 'custom' && survey.title) {
      form.appendChild(el('p', 'form__intro', survey.title));
    }

    const answers = new Map<string, string>();
    const wraps: Record<string, HTMLDivElement> = {};

    questions.forEach((q) => {
      const wrap = el('div', 'q');
      wraps[q.id] = wrap;
      wrap.appendChild(el('div', 'q__label', q.label));

      if (q.type === 'rating') {
        const max = q.max === 10 ? 10 : 5;
        const row = el('div', max === 10 ? 'nps' : 'stars');
        const values: number[] = [];
        for (let v = max === 10 ? 0 : 1; v <= max; v++) values.push(v);
        const buttons: HTMLButtonElement[] = [];
        values.forEach((v) => {
          const b = el('button');
          b.type = 'button';
          b.textContent = max === 10 ? String(v) : '★';
          b.setAttribute('aria-label', `${v}`);
          b.addEventListener('click', () => {
            answers.set(q.id, String(v));
            wrap.classList.remove('invalid');
            buttons.forEach((other, i) =>
              other.classList.toggle('on', max === 10 ? values[i] === v : values[i] <= v),
            );
            if (max !== 10) {
              animate(b, { transform: ['scale(1)', 'scale(1.3)', 'scale(1)'] }, { duration: dur(0.32), ease: EASE_POP });
            }
          });
          buttons.push(b);
          row.appendChild(b);
        });
        wrap.appendChild(row);
      } else if (q.type === 'choice') {
        const row = el('div', 'choices');
        (q.options || []).forEach((opt) => {
          const b = el('button', undefined, opt);
          b.type = 'button';
          b.addEventListener('click', () => {
            answers.set(q.id, opt);
            wrap.classList.remove('invalid');
            Array.from(row.children).forEach((c) => c.classList.remove('on'));
            b.classList.add('on');
          });
          row.appendChild(b);
        });
        wrap.appendChild(row);
      } else {
        const ta = el('textarea');
        ta.placeholder = q.optional ? 'Optional' : 'Tell us more';
        ta.maxLength = 2000;
        ta.setAttribute('aria-label', q.label);
        ta.addEventListener('input', () => {
          const v = ta.value.trim();
          if (v) answers.set(q.id, v);
          else answers.delete(q.id);
          if (v) wrap.classList.remove('invalid');
        });
        wrap.appendChild(ta);
      }
      form.appendChild(wrap);
    });

    const submit = el('button', 'submit', 'Send feedback');
    submit.type = 'button';
    submit.addEventListener('click', () => {
      const missing = questions.filter((q) => !q.optional && !answers.has(q.id));
      if (missing.length) {
        missing.forEach((q) => {
          const wrap = wraps[q.id];
          wrap.classList.add('invalid');
          animate(
            wrap,
            { transform: ['translateX(0)', 'translateX(-5px)', 'translateX(5px)', 'translateX(0)'] },
            { duration: dur(0.3), ease: EASE_OUT },
          );
        });
        return;
      }
      submit.disabled = true;
      const answerList = questions
        .filter((q) => answers.has(q.id))
        .map((q) => ({ id: q.id, label: q.label, value: answers.get(q.id) as string }));
      const ratingQ = questions.find((q) => q.type === 'rating' && answers.has(q.id));
      const textQ = questions.find((q) => q.type === 'text' && answers.has(q.id));
      host.submitFeedback({
        rating: ratingQ ? Number(answers.get(ratingQ.id)) : 0,
        comment: textQ ? (answers.get(textQ.id) as string) : '',
        surveyId: survey.survey_id || 'default',
        answers: answerList,
      });
      submitted = true;
      const thanks = buildThanks();
      view.replaceChildren(thanks);
      animateIn(thanks);
      const mark = thanks.querySelector('.done__mark') as HTMLElement | null;
      if (mark) {
        animate(mark, { transform: ['scale(.6)', 'scale(1)'] }, { duration: dur(0.42), ease: EASE_POP });
      }
      // Only auto-close when feedback is the whole widget; with both sections
      // enabled the visitor may still want to read the updates.
      if (!bothSections) setTimeout(() => closePanel(), 2200);
    });
    form.appendChild(submit);

    view.appendChild(form);
    return view;
  }

  function buildThanks(): HTMLElement {
    const done = el('div', 'done');
    const mark = el('div', 'done__mark');
    mark.appendChild(svg(ICONS.check));
    done.append(
      mark,
      el('p', 'done__title', 'Thanks for the feedback'),
      el('p', 'done__note', 'It goes straight to the team.'),
    );
    return done;
  }

  // ---- section switching ----
  function showSection(next: Section, dir: 1 | -1 = 1) {
    section = next;
    tabUpdates.setAttribute('aria-selected', String(next === 'updates'));
    tabFeedback.setAttribute('aria-selected', String(next === 'feedback'));
    swapView(() => (next === 'updates' ? buildUpdatesList() : buildFeedback()), dir);
    if (bothSections) moveTabMarker();
  }

  tabUpdates.addEventListener('click', () => showSection('updates', -1));
  tabFeedback.addEventListener('click', () => showSection('feedback', 1));

  // ---- open / close ----
  function openPanel(target?: Section) {
    hideToast();
    if (target && ((target === 'updates' && cfg.updates_enabled) || (target === 'feedback' && cfg.feedback_enabled))) {
      section = target;
    }
    if (panelOpen) {
      showSection(section);
      return;
    }
    panelOpen = true;
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    showSection(section);
    if (bothSections) requestAnimationFrame(() => moveTabMarker(false));
    animateIn(panel);
    animate(launcher, { transform: ['none', 'scale(.94)', 'none'] }, { duration: dur(0.22), ease: EASE_OUT });
  }

  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    launcher.setAttribute('aria-expanded', 'false');
    void animateOut(panel).finished.then(() => {
      if (!panelOpen) panel.hidden = true;
    });
  }

  launcher.addEventListener('click', () => (panelOpen ? closePanel() : openPanel()));
  closeBtn.addEventListener('click', () => closePanel());

  const onDocClick = (e: MouseEvent) => {
    if (!panelOpen) return;
    if (!(e.composedPath() as Node[]).includes(container)) closePanel();
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && panelOpen) closePanel();
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);

  // ---- toast for freshly published updates ----
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function hideToast() {
    if (toast.hidden) return;
    clearTimeout(toastTimer);
    void animateOut(toast).finished.then(() => {
      toast.hidden = true;
    });
  }

  function showToast(a: Announcement) {
    if (panelOpen || destroyed) return;
    const wrap = el('div', 'detail');
    wrap.style.padding = '16px 18px';

    const header = el('div', 'item__top');
    header.appendChild(el('span', 'eyebrow', a.release_label || 'New update'));
    const dismiss = el('button', 'icon-btn');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.style.marginInlineStart = 'auto';
    dismiss.appendChild(svg(ICONS.close));
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      hideToast();
    });
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.appendChild(dismiss);

    const open = el('button', 'item');
    open.type = 'button';
    open.style.padding = '0';
    open.style.borderBottom = '0';
    open.appendChild(el('h3', 'item__title', a.title));
    const excerpt = (a.summary || a.body || '').trim();
    if (excerpt) open.appendChild(el('p', 'item__excerpt', excerpt));
    open.appendChild(el('p', 'detail__link', 'Read update'));
    open.addEventListener('click', () => {
      hideToast();
      openPanel('updates');
      openDetail(a);
    });

    wrap.append(header, open);
    toast.replaceChildren(wrap);
    toast.hidden = false;
    animateIn(toast);
  }

  // ---- polling ----
  const baseInterval = Math.max(5_000, cfg.poll_interval_ms || 300_000);
  let interval = baseInterval;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function loadAnnouncements(initial: boolean) {
    if (!cfg.updates_enabled || destroyed) return;
    let res: Response;
    try {
      res = await fetch(
        `${host.origin}/api/updates/${encodeURIComponent(host.siteKey)}?visitor=${encodeURIComponent(visitor)}`,
      );
    } catch {
      return;
    }
    if (res.status === 429) {
      // The feed is rate limited per source address; a shared NAT can trip it.
      // Back off rather than keeping the endpoint under pressure.
      interval = Math.min(interval * 2, 15 * 60_000);
      return;
    }
    if (!res.ok) return;
    interval = baseInterval;

    let next: Announcement[];
    try {
      next = (await res.json()) as Announcement[];
    } catch {
      return;
    }
    if (!Array.isArray(next) || destroyed) return;

    // Anything unread that we had not seen on a previous poll is "new" and
    // earns a preview. On first load nothing is announced this way — the
    // unread badge already tells that story without hijacking the page.
    const fresh = next.filter((a) => !a.read && !seenIds.has(a.id));
    announcements = next;
    seenIds = new Set(next.map((a) => a.id));
    syncBadges();

    if (panelOpen && section === 'updates' && body.querySelector('.item, .empty')) {
      body.replaceChildren(buildUpdatesList());
    }
    if (!initial && fresh.length) showToast(fresh[0]);
  }

  function scheduleNext() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (destroyed) return;
      if (document.visibilityState === 'visible') await loadAnnouncements(false);
      scheduleNext();
    }, interval);
  }

  const onVisibility = () => {
    if (destroyed) return;
    if (document.visibilityState === 'visible') void loadAnnouncements(false);
  };
  document.addEventListener('visibilitychange', onVisibility);

  const post = (id: number, path: string, payload: object) =>
    fetch(`${host.origin}/api/updates/${encodeURIComponent(host.siteKey)}/${id}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_key: visitor, ...payload }),
    });

  // ---- go ----
  document.body.appendChild(container);
  animate(
    launcher,
    { opacity: [0, 1], transform: ['translateY(12px) scale(.9)', 'none'] },
    { duration: dur(0.4), ease: EASE_OUT },
  );

  if (cfg.updates_enabled) {
    void loadAnnouncements(true).then(scheduleNext);
  }

  return {
    open: (target) => openPanel(target),
    close: () => closePanel(),
    destroy: () => {
      destroyed = true;
      clearTimeout(timer);
      clearTimeout(toastTimer);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('visibilitychange', onVisibility);
      container.remove();
    },
  };
}
