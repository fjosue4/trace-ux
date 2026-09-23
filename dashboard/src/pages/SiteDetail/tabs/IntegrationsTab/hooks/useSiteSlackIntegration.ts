import { FormEvent, useEffect, useState } from 'react';
import {
  api,
  SiteSlackIntegration,
  SiteSlackIntegrationUpdate,
  SiteSlackNotificationKind,
  SlackLogMatch,
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
  const [logMatches, setLogMatches] = useState<SlackLogMatch[]>([]);

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
    setLogMatches(savedLogMatches(v));
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
        log_matches: cleanLogMatches(logMatches),
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
      JSON.stringify(cleanLogMatches(logMatches)) !== JSON.stringify(cleanLogMatches(savedLogMatches(integration))) ||
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
    logMatches,
    setLogMatches,
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

/** The saved rules, reading the single pattern of a server that predates
 *  rule lists as a one-rule list. */
function savedLogMatches(v: SiteSlackIntegration): SlackLogMatch[] {
  if (v.log_matches) return v.log_matches.map((rule) => ({ ...rule, severities: rule.severities ?? [] }));
  return v.log_match_value ? [{ mode: v.log_match_mode, value: v.log_match_value, severities: [] }] : [];
}

/** What the server will keep: rows with neither a pattern nor a severity are
 *  "every log" and would drown out the other rules, so they are dropped. */
function cleanLogMatches(rules: SlackLogMatch[]): SlackLogMatch[] {
  return rules
    .map((rule) => ({ mode: rule.mode, value: rule.value.trim() ? rule.value : '', severities: rule.severities ?? [] }))
    .filter((rule) => rule.value !== '' || rule.severities.length > 0);
}
