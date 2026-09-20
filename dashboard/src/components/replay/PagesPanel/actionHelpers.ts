import { fmtLocalDateTime } from '../../../lib/format';
import { Action, ReplayLog } from './PagesPanel.types';

export function formatReplayOffset(timestamp: number, firstTs: number): string {
  const totalSeconds = Math.max(0, Math.round((timestamp - firstTs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

// A URL is far more readable as its path than as an absolute address, and the
// hash matters: in-page anchors are the most common navigation on a marketing
// site and are otherwise indistinguishable from one another.
export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {
    return url;
  }
}

function widgetClickLabel(trackId: string): string {
  const [kind, subject, verb] = trackId.split(':');
  if (kind === 'launcher') return subject === 'close' ? 'Widget closed' : 'Widget opened';
  if (kind === 'panel') return 'Widget panel closed';
  if (kind === 'tab') return `Opened widget ${subject || 'section'}`;
  if (kind === 'updates') return 'Returned to widget updates';
  if (kind === 'tickets') return 'Returned to widget tickets';
  if (kind === 'announcement') {
    if (verb === 'link') return `Opened announcement #${subject}`;
    if (verb === 'like') return `Liked announcement #${subject}`;
    if (verb === 'comment') return `Commented on announcement #${subject}`;
    return `Opened announcement #${subject}`;
  }
  if (kind === 'ticket') {
    if (subject === 'new') return verb === 'submit' ? 'Created a ticket' : 'Started a new ticket';
    if (verb === 'reply') return `Replied to ticket #${subject}`;
    return `Opened ticket #${subject}`;
  }
  if (kind === 'feedback') {
    return subject === 'submit' ? 'Submitted feedback' : `Selected feedback ${subject}`;
  }
  return trackId ? `Widget · ${trackId}` : 'Widget click';
}

function customLabel(action: Extract<Action, { kind: 'custom' }>): string {
  if (action.name === 'widget_click') return widgetClickLabel(action.trackId);
  const target = action.trackId || 'element';
  return action.name === 'click'
    ? `Clicked ${target}`
    : action.trackId
      ? `${action.name} · ${action.trackId}`
      : action.name;
}

// The row's visible text. Shared with the search index so a query always
// matches what is actually on screen.
export function actionLabel(action: Action): string {
  if (action.kind === 'custom') return customLabel(action);
  if (action.kind === 'page') return `${action.first ? 'Opened' : 'Navigated to'} ${pagePath(action.url)}`;
  if (action.kind === 'ticket') return `Ticket created${action.subject ? `: ${action.subject}` : ''}`;
  if (action.kind === 'feedback') return 'Feedback given';
  return action.message || 'Browser log';
}

export function actionSearchText(action: Action): string {
  const label = actionLabel(action);
  const common = `action actions activity activities ${fmtLocalDateTime(Math.floor(action.ts / 1000))}`;

  if (action.kind === 'custom') {
    const clickTerms = action.name === 'click' ? 'click clicks clicked' : '';
    return `${label} ${common} custom custom-action custom event custom events ${clickTerms} ${action.name} ${action.trackId}`.toLowerCase();
  }

  if (action.kind === 'page') {
    return `${label} ${common} page pages page visit page visits visit visits visited navigation navigated opened ${action.title} ${action.url} ${pagePath(action.url)}`.toLowerCase();
  }

  if (action.kind === 'ticket') {
    return `${label} ${common} ticket tickets support ticket created ${action.subject} ${action.status}`.toLowerCase();
  }

  if (action.kind === 'feedback') {
    return `${label} ${common} feedback survey rating review ${action.rating} ${action.comment}`.toLowerCase();
  }

  return `${label} ${common} log logs browser log browser logs console ${action.severity} ${action.message} ${action.url}`.toLowerCase();
}

export function logIcon(severity: ReplayLog['severity']): 'code' | 'warn' | 'x' {
  return severity === 'error' ? 'x' : severity === 'warn' ? 'warn' : 'code';
}

export function logTone(severity: ReplayLog['severity']): 'accent' | 'neutral' | 'danger' {
  return severity === 'error' ? 'danger' : severity === 'warn' ? 'accent' : 'neutral';
}
