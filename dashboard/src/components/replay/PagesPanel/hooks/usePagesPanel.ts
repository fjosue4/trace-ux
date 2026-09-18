import { useEffect, useMemo, useRef, useState } from 'react';
import { actionSearchText } from '../actionHelpers';
import { Action, PagesPanelProps, ReplayLog } from '../PagesPanel.types';

export function usePagesPanel({
  activity,
  logs,
  pages,
  tickets,
  feedback,
  firstTs,
  currentTimeMs,
}: Pick<PagesPanelProps, 'activity' | 'logs' | 'pages' | 'tickets' | 'feedback' | 'firstTs' | 'currentTimeMs'>) {
  const [selectedLog, setSelectedLog] = useState<ReplayLog | null>(null);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLOListElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const actions = useMemo<Action[]>(() => {
    const customActions: Action[] = activity.map((item, index) => ({
      kind: 'custom',
      key: `custom-${item.ts}-${index}`,
      ts: item.ts,
      name: item.name,
      trackId: item.track_id,
      order: index,
    }));
    const logActions: Action[] = logs.map((item, index) => ({
      kind: 'log',
      key: `log-${item.id}`,
      ts: item.timestamp_ms,
      severity: item.severity,
      message: item.message,
      url: item.url,
      log: item,
      order: index,
    }));
    // Every URL change is an action: the first page load opens the feed, and
    // each later entry (including in-page hash navigation) is its own row.
    const pageActions: Action[] = pages.map((page, index) => ({
      kind: 'page',
      key: `page-${page.idx}-${page.entered_at}`,
      ts: page.entered_at * 1000, // stored in seconds, same client clock
      url: page.url,
      title: page.title,
      first: index === 0,
      order: index,
    }));
    // Tickets and feedback are stored server-side with a unix-seconds
    // created_at (receive time), not the visitor-clock milliseconds the rest
    // of the feed uses -- converted here so they sort and seek correctly
    // alongside custom events, logs and pages.
    const ticketActions: Action[] = tickets.map((t, index) => ({
      kind: 'ticket',
      key: `ticket-${t.id}`,
      ts: t.created_at * 1000,
      ticketId: t.id,
      subject: t.subject,
      status: t.status,
      order: index,
    }));
    const feedbackActions: Action[] = feedback.map((f, index) => ({
      kind: 'feedback',
      key: `feedback-${f.id}`,
      ts: f.created_at * 1000,
      feedbackId: f.id,
      rating: f.rating,
      comment: f.comment,
      order: index,
    }));
    return [...customActions, ...logActions, ...pageActions, ...ticketActions, ...feedbackActions].sort(
      (a, b) => a.ts - b.ts || a.order - b.order,
    );
  }, [activity, logs, pages, tickets, feedback]);

  // One searchable string per action. Kept alongside the row rather than
  // recomputed in the filter so the same text can back a server-side search
  // over actions and pages later.
  const searchable = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of actions) {
      map[a.key] = actionSearchText(a);
    }
    return map;
  }, [actions]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => {
      const terms = needle.split(/\s+/).filter(Boolean);
      return terms.length
        ? actions.filter((a) => terms.every((term) => searchable[a.key].includes(term)))
        : actions;
    },
    [actions, needle, searchable],
  );

  // The row the playhead is currently inside: the last action at or before it.
  const activeKey = useMemo(() => {
    let key: string | null = null;
    for (const a of actions) {
      if (a.ts - firstTs <= currentTimeMs) key = a.key;
      else break; // actions are sorted, so the rest are in the future
    }
    return key;
  }, [actions, currentTimeMs, firstTs]);

  // Follow playback, but only scroll the feed itself — never the page — and
  // stay put while the viewer is reading a filtered list.
  useEffect(() => {
    if (!activeKey || needle) return;
    const row = rowRefs.current[activeKey];
    const list = listRef.current;
    if (!row || !list) return;
    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top >= listBox.top && rowBox.bottom <= listBox.bottom) return; // already visible
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({
      top: list.scrollTop + (rowBox.top - listBox.top) - listBox.height / 2 + rowBox.height / 2,
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [activeKey, needle]);

  function setRowRef(key: string, node: HTMLLIElement | null) {
    rowRefs.current[key] = node;
  }

  return {
    selectedLog,
    setSelectedLog,
    query,
    setQuery,
    listRef,
    setRowRef,
    actions,
    visible,
    activeKey,
  };
}
