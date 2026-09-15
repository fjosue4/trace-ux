import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Site, Ticket, TicketStatus, TicketThread } from '../../../api';
import { ticketPollIntervalMs } from '../Tickets.constants';
import { sortTickets, ticketMatchesFilters } from '../Tickets.helpers';
import { DashboardTicketEvent, SiteSelection, StatusSelection } from '../Tickets.types';

export function useTickets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteSel, setSiteSel] = useState<SiteSelection>('all');
  const [statusSel, setStatusSel] = useState<StatusSelection>('all');
  const [items, setItems] = useState<Ticket[] | null>(null);
  const [thread, setThread] = useState<TicketThread | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Ticket | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const selectedId = Number(searchParams.get('ticket')) || null;
  const selectedIdRef = useRef<number | null>(selectedId);
  const siteSelRef = useRef<SiteSelection>(siteSel);
  const statusSelRef = useRef<StatusSelection>(statusSel);
  const refreshTicketsRef = useRef<() => void>(() => {});
  const refreshThreadRef = useRef<() => void>(() => {});
  const dashboardSocketConnectedRef = useRef(false);

  selectedIdRef.current = selectedId;
  siteSelRef.current = siteSel;
  statusSelRef.current = statusSel;

  const siteOptions = useMemo(
    () => [{ value: 'all', label: 'All sites' }, ...sites.map((site) => ({ value: String(site.id), label: site.name }))],
    [sites],
  );

  useEffect(() => {
    api.listSites().then(setSites).catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError('');

    const fetchTickets = async (initial: boolean) => {
      try {
        const rows = await api.listTickets(siteSel === 'all' ? null : siteSel, statusSel === 'all' ? '' : statusSel);
        if (!cancelled) setItems(rows);
      } catch {
        // A transient polling failure should not replace a usable inbox. Show
        // the error only for the initial load, when there is no data yet.
        if (!cancelled && initial) setError('Could not load tickets.');
      }
    };

    const refresh = () => {
      if (!cancelled && document.visibilityState === 'visible') void fetchTickets(false);
    };
    refreshTicketsRef.current = refresh;
    void fetchTickets(true);
    const poll = window.setInterval(() => {
      if (!dashboardSocketConnectedRef.current) refresh();
    }, ticketPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (refreshTicketsRef.current === refresh) refreshTicketsRef.current = () => {};
    };
  }, [siteSel, statusSel]);

  useEffect(() => {
    if (!selectedId) {
      setThread(null);
      setLoadingThread(false);
      refreshThreadRef.current = () => {};
      return;
    }
    let cancelled = false;
    setLoadingThread(true);
    const fetchThread = async (initial: boolean) => {
      try {
        const value = await api.getTicket(selectedId);
        if (!cancelled) setThread(value);
      } catch {
        // Keep the current conversation visible if a background poll fails.
        if (!cancelled && initial) {
          setThread(null);
          setError('Could not load that ticket.');
        }
      } finally {
        if (!cancelled && initial) setLoadingThread(false);
      }
    };

    const refresh = () => {
      if (!cancelled && document.visibilityState === 'visible') void fetchThread(false);
    };
    refreshThreadRef.current = refresh;
    void fetchThread(true);
    const poll = window.setInterval(() => {
      if (!dashboardSocketConnectedRef.current) refresh();
    }, ticketPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (refreshThreadRef.current === refresh) refreshThreadRef.current = () => {};
    };
  }, [selectedId]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;
    let retryDelay = 1_000;
    let socket: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (disposed) return;
      retryTimer = window.setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15_000);
    };

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const nextSocket = new WebSocket(`${protocol}//${window.location.host}/api/tickets/socket`);
      socket = nextSocket;
      nextSocket.addEventListener('open', () => {
        if (disposed || socket !== nextSocket) {
          nextSocket.close();
          return;
        }
        dashboardSocketConnectedRef.current = true;
        retryDelay = 1_000;
        // Reconcile anything that changed while a previous connection was
        // down before relying on direct event updates again.
        refreshTicketsRef.current();
        refreshThreadRef.current();
      });
      nextSocket.addEventListener('message', (event) => {
        if (disposed || socket !== nextSocket || typeof event.data !== 'string') return;
        let payload: DashboardTicketEvent;
        try {
          payload = JSON.parse(event.data) as DashboardTicketEvent;
        } catch {
          return;
        }
        if (!payload.type?.startsWith('ticket.')) return;

        if (payload.type === 'ticket.deleted') {
          const id = Number(payload.id);
          if (!Number.isFinite(id) || id <= 0) return;
          setItems((current) => current?.filter((item) => item.id !== id) ?? current);
          if (selectedIdRef.current === id) {
            setThread(null);
            setSearchParams({});
          }
          return;
        }

        const ticket = payload.ticket;
        if (!ticket) return;
        setItems((current) => {
          if (!current) return current;
          const remaining = current.filter((item) => item.id !== ticket.id);
          if (!ticketMatchesFilters(ticket, siteSelRef.current, statusSelRef.current)) return remaining;
          return sortTickets([ticket, ...remaining]).slice(0, 100);
        });

        if (selectedIdRef.current !== ticket.id) return;
        const incomingMessage = payload.message;
        if (payload.type === 'ticket.message' && incomingMessage) {
          setThread((current) => {
            if (!current || current.ticket.id !== ticket.id) return current;
            if (current.messages.some((item) => item.id === incomingMessage.id)) return { ...current, ticket };
            return { ...current, ticket, messages: [...current.messages, incomingMessage] };
          });
        } else {
          setThread((current) => (current && current.ticket.id === ticket.id ? { ...current, ticket } : current));
        }
      });
      nextSocket.addEventListener('error', () => nextSocket.close());
      nextSocket.addEventListener('close', () => {
        if (socket !== nextSocket) return;
        dashboardSocketConnectedRef.current = false;
        scheduleReconnect();
      });
    };

    connect();
    return () => {
      disposed = true;
      dashboardSocketConnectedRef.current = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
      socket = null;
    };
  }, [setSearchParams]);

  function openTicket(id: number) {
    setSearchParams({ ticket: String(id) });
  }

  async function updateStatus(status: TicketStatus) {
    if (!thread || status === thread.ticket.status) return;
    try {
      const updated = await api.updateTicket(thread.ticket.id, status);
      setThread((current) => (current ? { ...current, ticket: updated } : current));
      setItems((current) => current?.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)) ?? current);
    } catch {
      setError('Could not update the ticket status.');
    }
  }

  async function reply(body: string) {
    if (!thread) return;
    setSending(true);
    try {
      const updated = await api.replyToTicket(thread.ticket.id, body);
      setThread(updated);
      setItems((current) => current?.map((item) => (item.id === updated.ticket.id ? updated.ticket : item)) ?? current);
    } finally {
      setSending(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteTicket(pendingDelete.id);
      setItems((current) => current?.filter((item) => item.id !== pendingDelete.id) ?? current);
      if (selectedId === pendingDelete.id) setSearchParams({});
      setPendingDelete(null);
      setThread(null);
    } catch {
      setError('Could not delete the ticket.');
    } finally {
      setDeleting(false);
    }
  }

  return {
    sites,
    siteSel,
    setSiteSel,
    statusSel,
    setStatusSel,
    items,
    thread,
    loadingThread,
    sending,
    error,
    pendingDelete,
    setPendingDelete,
    deleting,
    filtersOpen,
    setFiltersOpen,
    selectedId,
    siteOptions,
    openTicket,
    updateStatus,
    reply,
    confirmDelete,
  };
}
