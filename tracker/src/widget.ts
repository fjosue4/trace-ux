// The unified TraceUX widget: one launcher, one panel, and the enabled sections.
//
// "What's new" (announcements), "Support" (tickets), and "Feedback" (the survey) used to be
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
import notificationSoundURL from './assets/notification.mp3';
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
  tickets_enabled: boolean;
  position?: string;
  anchor?: string; // bottom | middle
  title?: string;
  updates_label?: string;
  feedback_label?: string;
  tickets_label?: string;
  poll_interval_ms?: number;
  ticket_poll_interval_ms?: number;
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
  status?: string;
  updated_at?: number;
  liked?: boolean;
  commented?: boolean;
  read?: boolean;
};

type TicketStatus = 'open' | 'in_progress' | 'under_review' | 'closed';
type Ticket = {
  id: number;
  subject: string;
  status: TicketStatus;
  name?: string;
  email?: string;
  user_id?: string;
  session_id?: string;
  page_url?: string;
  message_count: number;
  last_message_at: number;
  last_message_author: 'visitor' | 'staff';
  created_at: number;
  updated_at: number;
};
type TicketMessage = {
  id: number;
  ticket_id: number;
  author: 'visitor' | 'staff';
  user_id: number;
  author_name?: string;
  body: string;
  created_at: number;
};
type TicketThread = { ticket: Ticket; messages: TicketMessage[] };
type WidgetSocketEvent = {
  type: string;
  id?: number;
  announcement?: Announcement;
  ticket?: Ticket;
  message?: TicketMessage;
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
    visitorKey: string;
  }) => void;
  newId: () => string;
  /** The current recording session, attached to newly opened tickets. */
  sessionId: () => string;
  /** The current tracker identity; a non-empty user id skips the email field. */
  identity: () => { userId: string };
};

export type WidgetHandle = {
  open: (section?: 'updates' | 'tickets' | 'feedback') => void;
  close: () => void;
  destroy: () => void;
};

type Section = 'updates' | 'tickets' | 'feedback';
type SectionDefinition = {
  id: Section;
  label: string;
  build: () => HTMLElement;
};

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
  lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="m5.6 5.6 4.3 4.3M14.1 14.1l4.3 4.3M18.4 5.6l-4.3 4.3M9.9 14.1l-4.3 4.3"/>',
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

function createNotificationSound(): () => void {
  let audio: HTMLAudioElement | null = null;

  return () => {
    if (typeof Audio === 'undefined') return;
    try {
      if (!audio) {
        audio = new Audio(notificationSoundURL);
        audio.preload = 'auto';
      } else {
        audio.currentTime = 0;
      }
      // A notification can arrive without a prior gesture on the host page.
      // Autoplay policies may reject it; that should never affect the widget.
      void audio.play().catch(() => {});
    } catch {
      // Audio is an enhancement; unsupported media must not break the widget.
    }
  };
}

// ---- widget ----------------------------------------------------------------

export function mountUnifiedWidget(host: WidgetHost): WidgetHandle | null {
  const cfg = host.config;
  if (!cfg.enabled) return null;

  const ap = cfg.appearance || {};
  const accent = ap.accent || '#2f7d4a';
  const dark = ap.theme === 'dark';
  const position = cfg.position === 'left' ? 'left' : 'right';
  // Sent as its own field, not as extra values in `position`, so a tracker
  // older than side anchors reads the side it understands and ignores this.
  const anchor = cfg.anchor === 'middle' ? 'middle' : 'bottom';
  const sections: SectionDefinition[] = [
    cfg.updates_enabled && { id: 'updates', label: cfg.updates_label || "What's new", build: buildUpdatesList },
    cfg.tickets_enabled && { id: 'tickets', label: cfg.tickets_label || 'Support', build: buildTicketsView },
    cfg.feedback_enabled && { id: 'feedback', label: cfg.feedback_label || 'Feedback', build: buildFeedback },
  ].filter(Boolean) as SectionDefinition[];
  if (!sections.length) return null;

  // Visitor key: stable per browser + site, used for likes/reads/comments.
  let visitor = '';
  try {
    const storageKey = `trace_ux_visitor_${host.siteKey}`;
    visitor = localStorage.getItem(storageKey) || host.newId();
    if (visitor.length < 8 || visitor.length > 100) visitor = host.newId();
    localStorage.setItem(storageKey, visitor);
  } catch {
    visitor = host.newId();
  }

  const root = el('div', 'root');
  const container = el('div');
  container.id = 'trace-ux-widget-root';
  // Keep our own chrome out of the customer's recording. Replaying it is
  // worthless — it is our UI, not their page — and it actively misleads: the
  // badge is a text node inside a shadow root, and rrweb replays those
  // mutations additively, so a count of 1 plays back as 1, 11, 110. It would
  // also copy announcement bodies and whatever the visitor typed into a
  // support ticket into the session blob a second time.
  container.className = 'trace-ux-block';
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

  // The corner is a class, not a `direction` flip. An earlier build set
  // `direction: rtl` on .root and anchored with `inset-inline-end`, but the
  // launcher, panel and toast are all position: fixed and each carried an
  // explicit `direction: ltr` so their contents read normally — and a logical
  // inset resolves against the box's *own* direction, so inset-inline-end
  // always meant `right` and the widget never left the right corner.
  if (position === 'left') root.classList.add('root--left');
  if (anchor === 'middle') root.classList.add('root--middle');

  // ---- state ----
  let announcements: Announcement[] = [];
  let seenIds = new Set<number>();
  let section: Section = sections[0].id;
  let panelOpen = false;
  let submitted = false;
  let destroyed = false;
	let tickets: Ticket[] = [];
	let ticketThread: TicketThread | null = null;
	type TicketView = { kind: 'list' } | { kind: 'thread'; id: number } | { kind: 'new' };
	let ticketView: TicketView = { kind: 'list' };
	let ticketLoading = false;
	let ticketError = '';
	let lastTicketFetch = 0;
	let hasLiveTicket = false;
	let ticketRetryPending = false;
	let ticketInterval = Math.max(15_000, cfg.ticket_poll_interval_ms || 15_000);
	const ticketBaseInterval = ticketInterval;
	let ticketTimer: ReturnType<typeof setTimeout> | undefined;
	let ticketRequest = 0;
	// Anything typed but not sent yet. Every ticket view is thrown away and
	// rebuilt on each repaint — a background poll, a tab switch, the panel
	// closing on a click elsewhere on the page — so a draft that lives only in
	// the DOM is lost on all of them. Keeping it here is what survives.
	let ticketDraft = { subject: '', email: '', body: '' };
	const ticketReplyDrafts = new Map<number, string>();

	// Mirrors a field into the draft and seeds it from whatever is already there.
	const bindDraft = (
		field: HTMLInputElement | HTMLTextAreaElement,
		name: string,
		read: () => string,
		write: (value: string) => void,
	) => {
		field.name = name;
		field.value = read();
		field.addEventListener('input', () => write(field.value));
	};
	let widgetSocket: WebSocket | null = null;
	let widgetSocketRetryTimer: ReturnType<typeof setTimeout> | undefined;
	let widgetSocketRetryCount = 0;
	let widgetSocketConnected = false;

	const ticketStorageKey = `trace_ux_tickets_${host.siteKey}`;
	const ticketReadStorageKey = `trace_ux_ticket_reads_${host.siteKey}`;
	const ticketReadMarkers = new Map<number, number>();
	const ticketToastMarkers = new Map<number, number>();
	const ticketNotificationRequests = new Set<number>();
	try {
		const stored = JSON.parse(localStorage.getItem(ticketReadStorageKey) || '{}') as Record<string, unknown>;
		Object.entries(stored).forEach(([id, count]) => {
			if (typeof count === 'number' && Number.isFinite(count) && count >= 0) ticketReadMarkers.set(Number(id), count);
		});
	} catch {
		/* unread markers are optional; the live widget still works without storage */
	}
	function hasTicketHistory() {
		try {
			return localStorage.getItem(ticketStorageKey) === '1';
		} catch {
			return false;
		}
	}
	function markTicketHistory() {
		try {
			localStorage.setItem(ticketStorageKey, '1');
		} catch {
			/* storage is optional; the in-memory thread still works */
		}
	}
	function isTicketUnread(ticket: Ticket) {
		return ticket.last_message_author === 'staff' && ticket.message_count > (ticketReadMarkers.get(ticket.id) || 0);
	}
	function unreadTicketCount() {
		return tickets.filter(isTicketUnread).length;
	}
	function markTicketRead(ticket: Ticket) {
		const current = ticketReadMarkers.get(ticket.id) || 0;
		if (ticket.message_count <= current) return;
		ticketReadMarkers.set(ticket.id, ticket.message_count);
		try {
			const stored: Record<string, number> = {};
			ticketReadMarkers.forEach((count, id) => { stored[String(id)] = count; });
			localStorage.setItem(ticketReadStorageKey, JSON.stringify(stored));
		} catch {
			/* storage is optional */
		}
		syncBadges();
	}

  const unreadCount = () => announcements.filter((a) => !a.read).length;
  const playNotificationSound = createNotificationSound();

  // ---- launcher ----
  const launcher = el('button', 'launcher');
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
  const builtInIcon = cfg.updates_enabled ? ICONS.megaphone : cfg.tickets_enabled ? ICONS.lifebuoy : ICONS.spark;
  const useDefaultMark = () => {
    launcher.classList.remove('launcher--icon');
    launcherIcon.replaceChildren(svg(builtInIcon));
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
    launcherIcon.appendChild(svg(builtInIcon));
    launcher.append(launcherIcon, launcherLabel, launcherBadge);
  }

  // ---- panel shell ----
  const panel = el('div', 'panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', cfg.title || 'Help and updates');
  panel.hidden = true;
  // The panel grows out of the launcher, so the origin follows where the
  // launcher actually is. Mid-edge that is the side, not the bottom corner.
  panel.style.transformOrigin =
    anchor === 'middle'
      ? position === 'left' ? 'left center' : 'right center'
      : position === 'left' ? 'bottom left' : 'bottom right';

  const head = el('div', 'panel__head');
  const title = el('h2', 'panel__title', cfg.title || 'Help & updates');
  const closeBtn = el('button', 'icon-btn');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(svg(ICONS.close));
  head.append(title, closeBtn);

  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const tabMarker = el('div', 'tabs__marker');
  const updatesCount = el('span', 'tab__count');
  updatesCount.hidden = true;
  const ticketsCount = el('span', 'tab__count');
  ticketsCount.hidden = true;
  const tabButtons = new Map<Section, HTMLButtonElement>();
  sections.forEach((item) => {
    const tab = el('button', 'tab');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.appendChild(document.createTextNode(item.label));
    if (item.id === 'updates') tab.appendChild(updatesCount);
    if (item.id === 'tickets') tab.appendChild(ticketsCount);
    tabButtons.set(item.id, tab);
    tab.addEventListener('click', () => {
      const currentIndex = sections.findIndex((candidate) => candidate.id === section);
      const nextIndex = sections.findIndex((candidate) => candidate.id === item.id);
      showSection(item.id, nextIndex >= currentIndex ? 1 : -1);
    });
    tabs.appendChild(tab);
  });
  tabs.appendChild(tabMarker);
  tabs.hidden = sections.length < 2;

  const body = el('div', 'body');
  panel.append(head, tabs, body);
  root.append(panel, launcher);

  // ---- toast: a newly published post announcing itself ----
  const toast = el('div', 'panel');
  toast.hidden = true;
  // Toasts stay in the bottom corner whatever the launcher does. One animating
  // out of a mid-edge tab would cover the tab itself, and a toast is transient
  // where the tab is permanent.
  toast.style.transformOrigin = position === 'left' ? 'bottom left' : 'bottom right';
  toast.setAttribute('role', 'status');
  root.appendChild(toast);

  // ---- animation helpers ----
  // A bottom-corner panel rises; a mid-edge one comes out of the side. Moving
  // the wrong axis reads as the panel detaching from its launcher rather than
  // unfolding from it. `dur()` already collapses both to an instant state
  // change under prefers-reduced-motion.
  const OPEN_FROM = anchor === 'middle'
    ? position === 'left' ? 'translateX(-10px) scale(.96)' : 'translateX(10px) scale(.96)'
    : 'translateY(10px) scale(.96)';
  const CLOSE_TO = anchor === 'middle'
    ? position === 'left' ? 'translateX(-8px) scale(.96)' : 'translateX(8px) scale(.96)'
    : 'translateY(8px) scale(.96)';

  function animateIn(node: HTMLElement) {
    return animate(
      node,
      { opacity: [0, 1], transform: [OPEN_FROM, 'none'] },
      { duration: dur(0.26), ease: EASE_OUT },
    );
  }
  function animateOut(node: HTMLElement) {
    return animate(
      node,
      { opacity: [1, 0], transform: ['none', CLOSE_TO] },
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
    body.classList.toggle('body--ticket-thread', next.classList.contains('ticket-view--thread'));
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
    const n = unreadCount() + unreadTicketCount();
    launcherBadge.hidden = n === 0;
    launcherBadge.textContent = String(n);
    if (hasCustomIcon) {
      launcher.setAttribute('aria-label', n ? `${launcherText} (${n} unread)` : launcherText);
    }
    const announcementsUnread = unreadCount();
    updatesCount.hidden = announcementsUnread === 0;
    updatesCount.textContent = String(announcementsUnread);
    const ticketsUnread = unreadTicketCount();
    ticketsCount.hidden = ticketsUnread === 0;
    ticketsCount.textContent = String(ticketsUnread);
  }

  function moveTabMarker(animated = true) {
    const active = tabButtons.get(section);
    if (!active || tabs.hidden) return;
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

    if (a.commented) {
      const already = el('div', 'inline-note', 'You already commented on this update.');
      detail.appendChild(already);
      view.appendChild(detail);
      return view;
    }

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
        // 409 is the one-comment-per-visitor rule; 429 is the per-announcement
        // ceiling. Neither is transient, so neither should read as "try again".
        const note = el('div', 'inline-note',
          res && res.status === 409
            ? 'You already commented on this update.'
            : res && res.status === 429
              ? 'This update has reached its comment limit.'
              : 'That comment could not be sent. Please try again.');
        composer.after(note);
        animateIn(note);
        setTimeout(() => note.remove(), 6000);
        return;
      }
      a.comments += 1;
      a.commented = true;
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

  // ---- tickets --------------------------------------------------------------
  function ticketStatusLabel(status: TicketStatus): string {
    switch (status) {
      case 'in_progress': return 'In progress';
      case 'under_review': return 'Under review';
      case 'closed': return 'Closed';
      default: return 'Open';
    }
  }

  function ticketRelativeTime(unix: number): string {
    if (!unix) return '';
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function ticketRequester(ticket: Ticket): string {
    return ticket.name || ticket.email || 'You';
  }

  function ticketURL(path = ''): string {
    return `${host.origin}/api/support/${encodeURIComponent(host.siteKey)}/tickets${path}`;
  }

  function postTicket(path: string, payload: object): Promise<Response> {
    return fetch(ticketURL(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // user_id names the visitor for whoever reads this in the dashboard. It is
      // asserted by the host page and never authorizes anything; an explicit
      // value in payload still wins.
      body: JSON.stringify({ visitor_key: visitor, user_id: host.identity().userId || '', ...payload }),
    });
  }

  function repaintTicketView() {
    if (destroyed || !panelOpen || section !== 'tickets') return;
    // Replacing the view moves focus to the panel, so remember which field the
    // visitor was in and where the caret sat, and put both back afterwards. A
    // reply arriving on the poll must not interrupt someone mid-sentence.
    const focused = shadow.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const focusName = focused && focused.name && body.contains(focused) ? focused.name : '';
    const caret = focusName && typeof focused?.selectionStart === 'number' ? focused.selectionStart : null;

    const next = buildTicketsView();
    body.classList.toggle('body--ticket-thread', next.classList.contains('ticket-view--thread'));
    body.replaceChildren(next);

    if (!focusName) return;
    const restored = body.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${focusName}"]`);
    if (!restored) return;
    restored.focus();
    if (caret === null) return;
    try {
      restored.setSelectionRange(caret, caret);
    } catch {
      /* number and email inputs reject setSelectionRange in some browsers */
    }
  }

  function buildTicketsList(): HTMLElement {
    const view = el('div', 'view ticket-view');
    if (ticketError) view.appendChild(el('div', 'ticket-error', ticketError));
    if (!tickets.length) {
      const empty = el('div', 'empty ticket-empty');
      const mark = el('div', 'empty__mark');
      mark.appendChild(svg(ICONS.lifebuoy));
      const start = el('button', 'submit', 'Start a ticket');
      start.type = 'button';
      start.addEventListener('click', () => {
        ticketError = '';
        ticketView = { kind: 'new' };
        swapView(buildTicketsView, 1);
      });
      empty.append(
        mark,
        el('p', 'empty__title', 'How can we help?'),
        el('p', 'empty__note', 'Send a message to the support team and keep the conversation here.'),
        start,
      );
      view.appendChild(empty);
      return view;
    }

    const items: HTMLElement[] = [];
    tickets.forEach((ticket) => {
      const item = el('button', 'item ticket-item');
      item.type = 'button';
      const top = el('div', 'item__top');
      top.append(
        el('span', 'ticket-item__subject', ticket.subject),
        el('span', `ticket-status ticket-status--${ticket.status}`, ticketStatusLabel(ticket.status)),
      );
      const excerpt = el('p', 'item__excerpt', ticket.last_message_author === 'visitor'
        ? 'Waiting for a reply from support'
        : 'Last reply from support');
      const meta = el('div', 'item__meta');
      meta.append(
        el('span', undefined, ticketRequester(ticket)),
        el('span', undefined, '·'),
        el('span', undefined, ticketRelativeTime(ticket.last_message_at)),
      );
      item.append(top, excerpt, meta);
      item.addEventListener('click', () => openTicketThread(ticket.id));
      items.push(item);
      view.appendChild(item);
    });

    const footer = el('div', 'ticket-footer');
    const newTicket = el('button', 'submit', 'New ticket');
    newTicket.type = 'button';
    newTicket.addEventListener('click', () => {
      ticketError = '';
      ticketView = { kind: 'new' };
      swapView(buildTicketsView, 1);
    });
    footer.appendChild(newTicket);
    view.appendChild(footer);
    queueMicrotask(() => stagger(items));
    return view;
  }

  function buildTicketMessage(message: TicketMessage): HTMLElement {
    const bubble = el('div', `ticket-message ticket-message--${message.author}`);
    const author = message.author === 'staff' ? message.author_name || 'Support' : 'You';
    bubble.append(
      el('div', 'ticket-message__author', author),
      el('p', 'ticket-message__body', message.body),
      el('div', 'ticket-message__time', ticketRelativeTime(message.created_at)),
    );
    return bubble;
  }

  function buildTicketThread(): HTMLElement {
    const view = el('div', 'view ticket-view ticket-view--thread');
    const detail = el('div', 'ticket-thread');
    const back = el('button', 'back');
    back.type = 'button';
    back.append(svg(ICONS.back), document.createTextNode('All tickets'));
    back.addEventListener('click', () => {
      ticketView = { kind: 'list' };
      ticketThread = null;
      ticketError = '';
      swapView(buildTicketsView, -1);
    });
    detail.appendChild(back);

    if (!ticketThread) {
      detail.appendChild(el('p', 'ticket-loading', ticketError || 'Loading ticket…'));
      view.appendChild(detail);
      return view;
    }

    const ticket = ticketThread.ticket;
    const heading = el('div', 'ticket-thread__heading');
    heading.append(
      el('span', 'eyebrow', `Ticket #${ticket.id}`),
      el('span', `ticket-status ticket-status--${ticket.status}`, ticketStatusLabel(ticket.status)),
    );
    detail.appendChild(heading);
    detail.appendChild(el('h3', 'detail__title', ticket.subject));
    const meta = el('div', 'ticket-thread__meta');
    meta.append(el('span', undefined, ticketRelativeTime(ticket.created_at)));
    detail.appendChild(meta);

    const messages = el('div', 'ticket-messages');
    ticketThread.messages.forEach((message) => {
      messages.appendChild(buildTicketMessage(message));
    });
    detail.appendChild(messages);

    if (ticket.status === 'closed') {
      detail.appendChild(el('div', 'ticket-closed', 'This ticket is closed.'));
    } else {
      const composer = el('form', 'ticket-composer');
      const input = el('textarea', 'ticket-composer__input');
      input.maxLength = 4000;
      input.placeholder = 'Reply to support…';
      input.setAttribute('aria-label', 'Reply to support');
      bindDraft(
        input,
        'reply',
        () => ticketReplyDrafts.get(ticket.id) || '',
        (v) => ticketReplyDrafts.set(ticket.id, v),
      );
      const actions = el('div', 'ticket-composer__actions');
      const error = el('div', 'ticket-error');
      error.hidden = true;
      const send = el('button', 'submit', 'Send');
      send.type = 'submit';
      actions.append(error, send);
      composer.append(input, actions);
      composer.addEventListener('submit', async (event) => {
        event.preventDefault();
        const bodyText = input.value.trim();
        if (!bodyText) {
          error.textContent = 'Write a message first.';
          error.hidden = false;
          return;
        }
        input.disabled = true;
        send.disabled = true;
        const res = await postTicket(`/${ticket.id}/messages`, { body: bodyText }).catch(() => null);
        if (!res || !res.ok) {
          error.textContent = res?.status === 409 ? 'This ticket is closed.' : res?.status === 429 ? 'This ticket has reached its message limit.' : 'That reply could not be sent.';
          error.hidden = false;
          input.disabled = false;
          send.disabled = false;
          return;
        }
        try {
          ticketThread = (await res.json()) as TicketThread;
          ticketReplyDrafts.delete(ticket.id);
          tickets = tickets.map((item) => item.id === ticket.id ? ticketThread?.ticket || item : item);
          syncBadges();
          ticketError = '';
          repaintTicketView();
          scrollTicketMessagesToLatest();
        } catch {
          error.textContent = 'That reply could not be displayed.';
          error.hidden = false;
          input.disabled = false;
          send.disabled = false;
        }
      });
      detail.appendChild(composer);
    }
    view.appendChild(detail);
    return view;
  }

  function buildNewTicket(): HTMLElement {
    const view = el('div', 'view ticket-view');
    const form = el('form', 'ticket-new');
    const back = el('button', 'back');
    back.type = 'button';
    back.append(svg(ICONS.back), document.createTextNode('All tickets'));
    back.addEventListener('click', () => {
      ticketView = { kind: 'list' };
      ticketError = '';
      swapView(buildTicketsView, -1);
    });
    form.appendChild(back);
    form.appendChild(el('h3', 'detail__title', 'Start a ticket'));
    form.appendChild(el('p', 'ticket-new__intro', 'Tell us what you need help with and we’ll follow up here.'));

    const subject = el('input', 'field');
    subject.type = 'text';
    subject.maxLength = 120;
    subject.required = true;
    subject.placeholder = 'What can we help with?';
    subject.setAttribute('aria-label', 'Subject');
    bindDraft(subject, 'subject', () => ticketDraft.subject, (v) => (ticketDraft.subject = v));
    const subjectLabel = el('label', 'ticket-new__field');
    subjectLabel.append(el('span', undefined, 'Subject'), subject);
    form.appendChild(subjectLabel);

    const userId = host.identity().userId || '';
    const hasUserId = userId.trim() !== '';
    let email: HTMLInputElement | undefined;
    if (!hasUserId) {
      email = el('input', 'field');
      email.type = 'email';
      email.maxLength = 200;
      email.required = true;
      email.placeholder = 'you@example.com';
      email.setAttribute('aria-label', 'Email');
      bindDraft(email, 'email', () => ticketDraft.email, (v) => (ticketDraft.email = v));
      const emailLabel = el('label', 'ticket-new__field');
      emailLabel.append(el('span', undefined, 'Email'), email);
      form.appendChild(emailLabel);
    }

    const message = el('textarea', 'ticket-new__message');
    message.maxLength = 4000;
    message.required = true;
    message.placeholder = 'Describe the issue…';
    message.setAttribute('aria-label', 'Message');
    bindDraft(message, 'body', () => ticketDraft.body, (v) => (ticketDraft.body = v));
    const messageLabel = el('label', 'ticket-new__field');
    messageLabel.append(el('span', undefined, 'Message'), message);
    form.appendChild(messageLabel);

    const error = el('div', 'ticket-error');
    error.hidden = true;
    const submit = el('button', 'submit', 'Send ticket');
    submit.type = 'submit';
    form.append(error, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const subjectText = subject.value.trim();
      const messageText = message.value.trim();
      const emailText = email?.value.trim() || '';
      const emailOK = hasUserId || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailText);
      if (!subjectText || subjectText.length > 120 || !messageText || messageText.length > 4000 || !emailOK) {
        error.textContent = !emailOK ? 'Enter a valid email address.' : 'Add a subject and message before sending.';
        error.hidden = false;
        return;
      }
      error.hidden = true;
      submit.disabled = true;
      const res = await postTicket('', {
        user_id: userId,
        email: emailText,
        subject: subjectText,
        body: messageText,
        session_id: host.sessionId(),
        page_url: location.href,
      }).catch(() => null);
      if (!res || !res.ok) {
        error.textContent = res?.status === 429 ? 'You’ve reached the ticket limit for this visitor.' : 'That ticket could not be created.';
        error.hidden = false;
        submit.disabled = false;
        return;
      }
      try {
        const created = (await res.json()) as Ticket;
        ticketDraft = { subject: '', email: '', body: '' };
        markTicketHistory();
        tickets = [created, ...tickets.filter((item) => item.id !== created.id)];
        hasLiveTicket = true;
        ticketView = { kind: 'thread', id: created.id };
        ticketThread = null;
        ticketError = '';
        scheduleTicketPoll();
        repaintTicketView();
        await loadTicketThread(created.id, false);
      } catch {
        error.textContent = 'The ticket was created, but could not be displayed.';
        error.hidden = false;
        submit.disabled = false;
      }
    });
    view.appendChild(form);
    return view;
  }

  function scrollTicketMessagesToLatest() {
    requestAnimationFrame(() => {
      if (destroyed || !panelOpen || section !== 'tickets' || ticketView.kind !== 'thread') return;
      const messageList = body.querySelector<HTMLElement>('.ticket-messages');
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    });
  }

  function buildTicketsView(): HTMLElement {
    if (ticketView.kind === 'new') return buildNewTicket();
    if (ticketView.kind === 'thread') return buildTicketThread();
    return buildTicketsList();
  }

  function openTicketThread(id: number) {
    const ticket = tickets.find((item) => item.id === id);
    if (ticket) markTicketRead(ticket);
    ticketView = { kind: 'thread', id };
    ticketThread = null;
    ticketError = '';
    ticketLoading = true;
    swapView(buildTicketsView, 1);
    void loadTicketThread(id, false);
  }

  async function loadTicketThread(id: number, render = true) {
    if (destroyed || !cfg.tickets_enabled) return;
    const request = ++ticketRequest;
    ticketLoading = true;
    if (render) repaintTicketView();
    let res: Response;
    try {
      res = await fetch(`${ticketURL(`/${id}`)}?visitor=${encodeURIComponent(visitor)}`);
    } catch {
      if (request === ticketRequest) {
        ticketLoading = false;
        ticketError = 'Could not load this ticket.';
        repaintTicketView();
      }
      return;
    }
    if (request !== ticketRequest || destroyed) return;
    if (!res.ok) {
      ticketLoading = false;
      ticketError = res.status === 404 ? 'This ticket is no longer available.' : 'Could not load this ticket.';
      repaintTicketView();
      return;
    }
    try {
      ticketThread = (await res.json()) as TicketThread;
      ticketLoading = false;
      ticketError = '';
      if (panelOpen && section === 'tickets' && ticketView.kind === 'thread' && ticketView.id === id) {
        markTicketRead(ticketThread.ticket);
      }
      if (ticketView.kind === 'thread' && ticketView.id === id) {
        repaintTicketView();
        scrollTicketMessagesToLatest();
      }
    } catch {
      ticketLoading = false;
      ticketError = 'Could not load this ticket.';
      repaintTicketView();
    }
  }

  async function loadTickets() {
    if (!cfg.tickets_enabled || destroyed) return;
    let res: Response;
    try {
      res = await fetch(`${ticketURL()}?visitor=${encodeURIComponent(visitor)}`);
    } catch {
      return;
    }
    if (res.status === 429) {
      ticketRetryPending = true;
      ticketInterval = Math.min(ticketInterval * 2, 15 * 60_000);
      scheduleTicketPoll();
      return;
    }
    if (!res.ok) return;
    let next: Ticket[];
    try {
      next = (await res.json()) as Ticket[];
    } catch {
      return;
    }
    if (!Array.isArray(next) || destroyed) return;
    ticketInterval = ticketBaseInterval;
    ticketRetryPending = false;
    tickets = next;
    hasLiveTicket = next.some((ticket) => ticket.status !== 'closed');
    lastTicketFetch = Date.now();
    syncBadges();
    if (panelOpen && section === 'tickets') {
      if (ticketView.kind === 'thread') {
        void loadTicketThread(ticketView.id, false);
      } else if (ticketView.kind === 'list') {
        // The compose form shows nothing the ticket list feeds, so a poll has
        // no reason to rebuild it underneath whoever is filling it in.
        repaintTicketView();
      }
    }
    if (!panelOpen) {
      const unread = next.find(
        (ticket) => isTicketUnread(ticket) && ticketToastMarkers.get(ticket.id) !== ticket.message_count,
      );
      if (unread) void loadTicketNotification(unread);
    }
    scheduleTicketPoll();
  }

  function scheduleTicketPoll() {
    clearTimeout(ticketTimer);
    if (widgetSocketConnected || !cfg.tickets_enabled || destroyed || (!hasLiveTicket && !ticketRetryPending)) return;
    ticketTimer = setTimeout(async () => {
      if (destroyed) return;
      if (document.visibilityState === 'visible') await loadTickets();
      else scheduleTicketPoll();
    }, ticketInterval);
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
        visitorKey: visitor,
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
      // Only auto-close when feedback is the whole widget; with multiple sections
      // enabled the visitor may still want to read the updates.
      if (sections.length < 2) setTimeout(() => closePanel(), 2200);
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
    const selected = sections.find((item) => item.id === next);
    if (!selected) return;
    section = next;
    tabButtons.forEach((tab, id) => tab.setAttribute('aria-selected', String(id === next)));
    swapView(selected.build, dir);
    if (sections.length > 1) moveTabMarker();
    if (next === 'tickets') {
      // A cached thread renders its messages immediately from swapView above,
      // with no fetch to hang a scroll off afterward — reopening the panel or
      // switching back into this tab must still land on the latest message.
      if (ticketView.kind === 'thread') scrollTicketMessagesToLatest();
      if (Date.now() - lastTicketFetch > 30_000) void loadTickets();
    }
  }

  // ---- open / close ----
  function openPanel(target?: Section) {
    hideToast();
    if (target && sections.some((item) => item.id === target)) {
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
    if (sections.length > 1) requestAnimationFrame(() => moveTabMarker(false));
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

  // ---- toast for freshly published updates or support replies ----
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function hideToast() {
    if (toast.hidden) return;
    clearTimeout(toastTimer);
    void animateOut(toast).finished.then(() => {
      toast.hidden = true;
    });
  }

  function showPreviewToast(
    labelText: string,
    titleText: string,
    excerptText: string,
    actionText: string,
    onOpen: () => void,
  ) {
    if (panelOpen || destroyed) return;
    const wrap = el('div', 'detail');
    wrap.style.padding = '16px 18px';

    const header = el('div', 'item__top');
    header.appendChild(el('span', 'eyebrow', labelText));
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
    open.setAttribute('aria-label', actionText);
    open.appendChild(el('h3', 'item__title', titleText));
    if (excerptText) open.appendChild(el('p', 'item__excerpt', excerptText));
    open.appendChild(el('p', 'detail__link', actionText));
    open.addEventListener('click', onOpen);

    wrap.append(header, open);
    toast.replaceChildren(wrap);
    toast.hidden = false;
    playNotificationSound();
    clearTimeout(toastTimer);
    animateIn(toast);
  }

  function showToast(a: Announcement) {
    const excerpt = (a.summary || a.body || '').trim();
    showPreviewToast(a.release_label || 'New update', a.title, excerpt, 'Read update', () => {
      hideToast();
      openPanel('updates');
      openDetail(a);
    });
  }

  function showTicketToast(ticket: Ticket, message: string) {
    showPreviewToast(
      'Support reply',
      ticket.subject,
      message.trim() || 'Support replied to your ticket.',
      'Open conversation',
      () => {
        hideToast();
        openPanel('tickets');
        openTicketThread(ticket.id);
      },
    );
  }

  async function loadTicketNotification(ticket: Ticket) {
    if (
      destroyed ||
      panelOpen ||
      !isTicketUnread(ticket) ||
      ticketToastMarkers.get(ticket.id) === ticket.message_count ||
      ticketNotificationRequests.has(ticket.id)
    ) return;

    ticketNotificationRequests.add(ticket.id);
    try {
      const res = await fetch(`${ticketURL(`/${ticket.id}`)}?visitor=${encodeURIComponent(visitor)}`);
      if (!res.ok || destroyed) return;
      const thread = (await res.json()) as TicketThread;
      if (!thread || !Array.isArray(thread.messages)) return;
      const latest = thread.messages[thread.messages.length - 1];
      if (!latest || latest.author !== 'staff') return;

      const displayTicket = thread.ticket?.id === ticket.id ? thread.ticket : ticket;
      if (panelOpen || destroyed || !isTicketUnread(displayTicket)) return;
      if (ticketToastMarkers.get(ticket.id) === displayTicket.message_count) return;
      ticketToastMarkers.set(ticket.id, displayTicket.message_count);
      showTicketToast(displayTicket, latest.body);
    } catch {
      // The next ticket poll can retry the preview without affecting the widget.
    } finally {
      ticketNotificationRequests.delete(ticket.id);
    }
  }

  function repaintUpdatesListIfVisible() {
    if (panelOpen && section === 'updates' && body.querySelector('.item, .empty')) {
      body.replaceChildren(buildUpdatesList());
    }
  }

  function upsertTicketFromSocket(ticket: Ticket) {
    tickets = [ticket, ...tickets.filter((item) => item.id !== ticket.id)].sort(
      (a, b) => b.last_message_at - a.last_message_at || b.id - a.id,
    );
    hasLiveTicket = tickets.some((item) => item.status !== 'closed');
    syncBadges();
    if (!panelOpen || section !== 'tickets') return;
    if (ticketView.kind === 'list') {
      repaintTicketView();
      return;
    }
    // The open thread renders from its own copy of the ticket, so a change
    // that arrives while it is on screen — support moving it to closed, say —
    // has to be written back and the view rebuilt. Without this the pill goes
    // stale and, worse, a closed ticket keeps offering a reply box whose next
    // message the server rejects. Rebuilding is safe: a repaint carries the
    // unsent draft and the caret across.
    if (ticketView.kind !== 'thread' || ticketView.id !== ticket.id || !ticketThread) return;
    const statusChanged = ticketThread.ticket.status !== ticket.status;
    ticketThread = { ...ticketThread, ticket };
    if (statusChanged) repaintTicketView();
  }

  function removeTicketFromSocket(id: number) {
    tickets = tickets.filter((item) => item.id !== id);
    hasLiveTicket = tickets.some((item) => item.status !== 'closed');
    if (ticketView.kind === 'thread' && ticketView.id === id) {
      ticketView = { kind: 'list' };
      ticketThread = null;
      ticketError = 'This ticket is no longer available.';
    }
    syncBadges();
    if (panelOpen && section === 'tickets') repaintTicketView();
  }

  function appendTicketMessageToView(message: TicketMessage): boolean {
    if (!ticketThread || ticketThread.messages.some((item) => item.id === message.id)) return false;
    ticketThread = { ...ticketThread, messages: [...ticketThread.messages, message] };
    const messageList = body.querySelector<HTMLElement>('.ticket-messages');
    if (messageList) {
      messageList.appendChild(buildTicketMessage(message));
      messageList.scrollTop = messageList.scrollHeight;
    }
    return true;
  }

  function handleWidgetSocketEvent(event: WidgetSocketEvent) {
    if (event.type.startsWith('announcement.')) {
      const announcement = event.announcement;
      if (event.type === 'announcement.deleted' || event.type === 'announcement.archived') {
        const id = event.id || announcement?.id;
        if (!id) return;
        announcements = announcements.filter((item) => item.id !== id);
        seenIds.delete(id);
        syncBadges();
        repaintUpdatesListIfVisible();
        return;
      }
      if (!announcement || (announcement.status && announcement.status !== 'published')) return;
      const previous = announcements.find((item) => item.id === announcement.id);
      const merged = previous ? { ...announcement, read: previous.read } : announcement;
      const isFresh = !seenIds.has(merged.id);
      seenIds.add(merged.id);
      announcements = [merged, ...announcements.filter((item) => item.id !== merged.id)].sort(
        (a, b) => b.published_at - a.published_at || (b.updated_at || 0) - (a.updated_at || 0) || b.id - a.id,
      );
      syncBadges();
      repaintUpdatesListIfVisible();
      if (!panelOpen && event.type === 'announcement.published' && isFresh) showToast(merged);
      return;
    }

    if (!event.type.startsWith('ticket.')) return;
    if (event.type === 'ticket.deleted') {
      if (event.id) removeTicketFromSocket(event.id);
      return;
    }
    const ticket = event.ticket;
    if (!ticket) return;
    if (event.type === 'ticket.created') markTicketHistory();
    upsertTicketFromSocket(ticket);

    if (event.type !== 'ticket.message' || !event.message) return;
    const message = event.message;
    const viewingThisThread =
      panelOpen && section === 'tickets' && ticketView.kind === 'thread' && ticketView.id === ticket.id;
    if (viewingThisThread && ticketThread) {
      // upsertTicketFromSocket above already wrote the fresh ticket back and
      // rebuilt the view if the status moved, so all that is left is the bubble.
      appendTicketMessageToView(message);
      if (message.author === 'staff') markTicketRead(ticket);
      return;
    }

    if (message.author === 'staff' && !panelOpen && isTicketUnread(ticket)) {
      if (ticketToastMarkers.get(ticket.id) !== ticket.message_count) {
        ticketToastMarkers.set(ticket.id, ticket.message_count);
        showTicketToast(ticket, message.body);
      }
    }
  }

  function widgetSocketURL(): string {
    const url = new URL(`/api/widget/${encodeURIComponent(host.siteKey)}/socket`, host.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('visitor', visitor);
    url.searchParams.set(
      'channels',
      [cfg.updates_enabled && 'updates', cfg.tickets_enabled && 'tickets'].filter(Boolean).join(','),
    );
    return url.toString();
  }

  function scheduleWidgetSocketRetry() {
    if (destroyed || widgetSocketRetryTimer || document.visibilityState !== 'visible') return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(widgetSocketRetryCount, 5));
    widgetSocketRetryCount += 1;
    widgetSocketRetryTimer = setTimeout(() => {
      widgetSocketRetryTimer = undefined;
      connectWidgetSocket();
    }, delay);
  }

  function connectWidgetSocket() {
    if (
      destroyed ||
      (!cfg.updates_enabled && !cfg.tickets_enabled) ||
      typeof WebSocket === 'undefined' ||
      (widgetSocket && (widgetSocket.readyState === WebSocket.CONNECTING || widgetSocket.readyState === WebSocket.OPEN))
    ) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(widgetSocketURL());
    } catch {
      scheduleWidgetSocketRetry();
      return;
    }
    widgetSocket = socket;
    socket.addEventListener('open', () => {
      if (widgetSocket !== socket || destroyed) {
        socket.close();
        return;
      }
      widgetSocketConnected = true;
      widgetSocketRetryCount = 0;
      clearTimeout(widgetSocketRetryTimer);
      widgetSocketRetryTimer = undefined;
      clearTimeout(timer);
      clearTimeout(ticketTimer);
      // Reconcile the short interval between the initial HTTP load and the
      // socket handshake. Later changes arrive as socket payloads directly.
      if (cfg.updates_enabled) void loadAnnouncements(true);
      if (cfg.tickets_enabled) void loadTickets();
    });
    socket.addEventListener('message', (event) => {
      if (widgetSocket !== socket || destroyed || typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data) as WidgetSocketEvent;
        if (payload && typeof payload.type === 'string') handleWidgetSocketEvent(payload);
      } catch {
        // Ignore malformed messages; the HTTP fallback remains available.
      }
    });
    socket.addEventListener('close', () => {
      if (widgetSocket !== socket) return;
      widgetSocket = null;
      widgetSocketConnected = false;
      if (destroyed) return;
      if (document.visibilityState === 'visible') {
        if (cfg.updates_enabled) void loadAnnouncements(false);
        if (cfg.tickets_enabled && hasTicketHistory()) void loadTickets();
      }
      scheduleNext();
      scheduleTicketPoll();
      scheduleWidgetSocketRetry();
    });
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
    if (widgetSocketConnected) return;
    timer = setTimeout(async () => {
      if (destroyed) return;
      if (document.visibilityState === 'visible') await loadAnnouncements(false);
      scheduleNext();
    }, interval);
  }

  const onVisibility = () => {
    if (destroyed) return;
    if (document.visibilityState === 'visible') {
      if (!widgetSocket) connectWidgetSocket();
      if (!widgetSocketConnected) {
        void loadAnnouncements(false);
        if (cfg.tickets_enabled && hasTicketHistory() && Date.now() - lastTicketFetch > 30_000) void loadTickets();
      }
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const post = (id: number, path: string, payload: object) =>
    fetch(`${host.origin}/api/updates/${encodeURIComponent(host.siteKey)}/${id}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // user_id names the visitor for whoever reads this in the dashboard. It is
      // asserted by the host page and never authorizes anything; an explicit
      // value in payload still wins.
      body: JSON.stringify({ visitor_key: visitor, user_id: host.identity().userId || '', ...payload }),
    });

  // ---- go ----
  document.body.appendChild(container);
  animate(
    launcher,
    { opacity: [0, 1], transform: ['translateY(12px) scale(.9)', 'none'] },
    { duration: dur(0.4), ease: EASE_OUT },
  );

  if (cfg.updates_enabled || cfg.tickets_enabled) connectWidgetSocket();
  if (cfg.updates_enabled) {
    void loadAnnouncements(true).then(scheduleNext);
  }
  if (cfg.tickets_enabled) void loadTickets();

  return {
    open: (target) => openPanel(target),
    close: () => closePanel(),
    destroy: () => {
      destroyed = true;
      clearTimeout(timer);
      clearTimeout(ticketTimer);
      clearTimeout(toastTimer);
      clearTimeout(widgetSocketRetryTimer);
      widgetSocketRetryTimer = undefined;
      widgetSocket?.close();
      widgetSocket = null;
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('visibilitychange', onVisibility);
      container.remove();
    },
  };
}
