import { FormEvent, useEffect, useState } from 'react';
import {
  api,
  SlackIntegration,
  SlackIntegrationUpdate,
  SlackLogMatchMode,
  SlackNotificationKind,
  SlackRoutingMode,
} from '../../../api';

export type WebhookDraft = { value: string; clear: boolean };

const emptyDraft: WebhookDraft = { value: '', clear: false };

export function useIntegrations() {
  const [integration, setIntegration] = useState<SlackIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [testingKind, setTestingKind] = useState<SlackNotificationKind | 'common' | null>(null);

  const [routingMode, setRoutingMode] = useState<SlackRoutingMode>('single');
  const [ticketsEnabled, setTicketsEnabled] = useState(false);
  const [logsEnabled, setLogsEnabled] = useState(false);
  const [systemEnabled, setSystemEnabled] = useState(false);
  const [logMatchMode, setLogMatchMode] = useState<SlackLogMatchMode>('contains');
  const [logMatchValue, setLogMatchValue] = useState('');

  const [common, setCommon] = useState<WebhookDraft>(emptyDraft);
  const [tickets, setTickets] = useState<WebhookDraft>(emptyDraft);
  const [logs, setLogs] = useState<WebhookDraft>(emptyDraft);
  const [system, setSystem] = useState<WebhookDraft>(emptyDraft);

  function applyIntegration(v: SlackIntegration) {
    setIntegration(v);
    setRoutingMode(v.routing_mode);
    setTicketsEnabled(v.tickets_enabled);
    setLogsEnabled(v.logs_enabled);
    setSystemEnabled(v.system_enabled);
    setLogMatchMode(v.log_match_mode);
    setLogMatchValue(v.log_match_value);
    // Drafts always reset to "keep" after a load or save: the server never
    // hands back anything a text field could show.
    setCommon(emptyDraft);
    setTickets(emptyDraft);
    setLogs(emptyDraft);
    setSystem(emptyDraft);
  }

  useEffect(() => {
    let cancelled = false;
    api
      .getSlackIntegration()
      .then((v) => {
        if (!cancelled) applyIntegration(v);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load Slack settings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const update: SlackIntegrationUpdate = {
        routing_mode: routingMode,
        tickets_enabled: ticketsEnabled,
        logs_enabled: logsEnabled,
        system_enabled: systemEnabled,
        log_match_mode: logMatchMode,
        log_match_value: logMatchValue,
        common_webhook: common.value.trim() || undefined,
        clear_common_webhook: common.clear || undefined,
        tickets_webhook: tickets.value.trim() || undefined,
        clear_tickets_webhook: tickets.clear || undefined,
        logs_webhook: logs.value.trim() || undefined,
        clear_logs_webhook: logs.clear || undefined,
        system_webhook: system.value.trim() || undefined,
        clear_system_webhook: system.clear || undefined,
      };
      const saved = await api.updateSlackIntegration(update);
      applyIntegration(saved);
      setNotice('Slack settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Slack settings.');
    } finally {
      setBusy(false);
    }
  }

  async function test(kind?: SlackNotificationKind) {
    setError('');
    setNotice('');
    setTestingKind(kind ?? 'common');
    try {
      await api.testSlackWebhook(kind);
      setNotice('Test message sent — check the Slack channel.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slack did not accept the test message.');
    } finally {
      setTestingKind(null);
    }
  }

  return {
    integration,
    loading,
    error,
    notice,
    busy,
    testingKind,
    routingMode,
    setRoutingMode,
    ticketsEnabled,
    setTicketsEnabled,
    logsEnabled,
    setLogsEnabled,
    systemEnabled,
    setSystemEnabled,
    logMatchMode,
    setLogMatchMode,
    logMatchValue,
    setLogMatchValue,
    common,
    setCommon,
    tickets,
    setTickets,
    logs,
    setLogs,
    system,
    setSystem,
    save,
    test,
  };
}
