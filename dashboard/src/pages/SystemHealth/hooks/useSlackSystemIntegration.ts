import { FormEvent, useEffect, useState } from 'react';
import { api, SlackSystemIntegration, SlackSystemIntegrationUpdate } from '../../../api';
import { emptyWebhookDraft, WebhookDraft } from '../../../components/integrations/WebhookField';

export function useSlackSystemIntegration() {
  const [integration, setIntegration] = useState<SlackSystemIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [webhook, setWebhook] = useState<WebhookDraft>(emptyWebhookDraft);
  const [signingSecret, setSigningSecret] = useState<WebhookDraft>(emptyWebhookDraft);

  function applyIntegration(v: SlackSystemIntegration) {
    setIntegration(v);
    setEnabled(v.enabled);
    setWebhook(emptyWebhookDraft);
    setSigningSecret(emptyWebhookDraft);
  }

  useEffect(() => {
    let cancelled = false;
    api
      .getSlackSystemIntegration()
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
      const update: SlackSystemIntegrationUpdate = {
        enabled,
        webhook: webhook.value.trim() || undefined,
        clear_webhook: webhook.clear || undefined,
        signing_secret: signingSecret.value.trim() || undefined,
        clear_signing_secret: signingSecret.clear || undefined,
      };
      const saved = await api.updateSlackSystemIntegration(update);
      applyIntegration(saved);
      setNotice('Slack settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Slack settings.');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setError('');
    setNotice('');
    setTesting(true);
    try {
      await api.testSlackSystemWebhook();
      setNotice('Test message sent — check the Slack channel.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slack did not accept the test message.');
    } finally {
      setTesting(false);
    }
  }

  const dirty = integration !== null &&
    (enabled !== integration.enabled ||
      webhook.clear ||
      webhook.value.trim() !== '' ||
      signingSecret.clear ||
      signingSecret.value.trim() !== '');

  return {
    integration,
    loading,
    error,
    notice,
    busy,
    dirty,
    testing,
    enabled,
    setEnabled,
    webhook,
    setWebhook,
    signingSecret,
    setSigningSecret,
    save,
    test,
  };
}
