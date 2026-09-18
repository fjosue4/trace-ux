import { FormEvent, useEffect, useState } from 'react';
import {
  api,
  SiteSlackIntegration,
  SiteSlackIntegrationUpdate,
  SiteSlackNotificationKind,
  SlackLogMatchMode,
  SlackRoutingMode,
} from '../../../../../api';
import { emptyWebhookDraft, WebhookDraft } from '../../../../../components/integrations/WebhookField';

export function useSiteSlackIntegration(siteId: number) {
  const [integration, setIntegration] = useState<SiteSlackIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [testingKind, setTestingKind] = useState<SiteSlackNotificationKind | 'common' | null>(null);

  const [routingMode, setRoutingMode] = useState<SlackRoutingMode>('single');
  const [ticketsEnabled, setTicketsEnabled] = useState(false);
  const [logsEnabled, setLogsEnabled] = useState(false);
  const [customEnabled, setCustomEnabled] = useState(false);
  const [logMatchMode, setLogMatchMode] = useState<SlackLogMatchMode>('contains');
  const [logMatchValue, setLogMatchValue] = useState('');

  const [common, setCommon] = useState<WebhookDraft>(emptyWebhookDraft);
  const [tickets, setTickets] = useState<WebhookDraft>(emptyWebhookDraft);
  const [logs, setLogs] = useState<WebhookDraft>(emptyWebhookDraft);
  const [custom, setCustom] = useState<WebhookDraft>(emptyWebhookDraft);

  function applyIntegration(v: SiteSlackIntegration) {
    setIntegration(v);
    setRoutingMode(v.routing_mode);
    setTicketsEnabled(v.tickets_enabled);
    setLogsEnabled(v.logs_enabled);
    setCustomEnabled(v.custom_enabled);
    setLogMatchMode(v.log_match_mode);
    setLogMatchValue(v.log_match_value);
    // Drafts always reset to "keep" after a load or save: the server never
    // hands back anything a text field could show.
    setCommon(emptyWebhookDraft);
    setTickets(emptyWebhookDraft);
    setLogs(emptyWebhookDraft);
    setCustom(emptyWebhookDraft);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getSiteSlackIntegration(siteId)
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
  }, [siteId]);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const update: SiteSlackIntegrationUpdate = {
        routing_mode: routingMode,
        tickets_enabled: ticketsEnabled,
        logs_enabled: logsEnabled,
        custom_enabled: customEnabled,
        log_match_mode: logMatchMode,
        log_match_value: logMatchValue,
        common_webhook: common.value.trim() || undefined,
        clear_common_webhook: common.clear || undefined,
        tickets_webhook: tickets.value.trim() || undefined,
        clear_tickets_webhook: tickets.clear || undefined,
        logs_webhook: logs.value.trim() || undefined,
        clear_logs_webhook: logs.clear || undefined,
        custom_webhook: custom.value.trim() || undefined,
        clear_custom_webhook: custom.clear || undefined,
      };
      const saved = await api.updateSiteSlackIntegration(siteId, update);
      applyIntegration(saved);
      setNotice('Slack settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Slack settings.');
    } finally {
      setBusy(false);
    }
  }

  async function test(kind?: SiteSlackNotificationKind) {
    setError('');
    setNotice('');
    setTestingKind(kind ?? 'common');
    try {
      await api.testSiteSlackWebhook(siteId, kind);
      setNotice('Test message sent — check the Slack channel.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slack did not accept the test message.');
    } finally {
      setTestingKind(null);
    }
  }

  const draftChanged = (draft: WebhookDraft) => draft.clear || draft.value.trim() !== '';
  const dirty =
    integration !== null &&
    (routingMode !== integration.routing_mode ||
      ticketsEnabled !== integration.tickets_enabled ||
      logsEnabled !== integration.logs_enabled ||
      customEnabled !== integration.custom_enabled ||
      logMatchMode !== integration.log_match_mode ||
      logMatchValue !== integration.log_match_value ||
      draftChanged(common) ||
      draftChanged(tickets) ||
      draftChanged(logs) ||
      draftChanged(custom));

  return {
    integration,
    loading,
    error,
    notice,
    busy,
    dirty,
    testingKind,
    routingMode,
    setRoutingMode,
    ticketsEnabled,
    setTicketsEnabled,
    logsEnabled,
    setLogsEnabled,
    customEnabled,
    setCustomEnabled,
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
    custom,
    setCustom,
    save,
    test,
  };
}
