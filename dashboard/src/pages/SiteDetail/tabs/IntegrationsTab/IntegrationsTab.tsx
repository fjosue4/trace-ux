import Card from '../../../../components/ui/Card';
import Button from '../../../../components/ui/Button';
import Notice from '../../../../components/ui/Notice';
import Loading from '../../../../components/ui/Loading';
import Switch from '../../../../components/ui/Switch';
import { Icon } from '../../../../components/ui/Icon';
import { Field, Select } from '../../../../components/ui/fields';
import { WebhookField } from '../../../../components/integrations/WebhookField';
import { SlackRequestUrl } from '../../../../components/integrations/SlackRequestUrl';
import { SlackRoutingMode } from '../../../../api';
import { useSiteSlackIntegration } from './hooks/useSiteSlackIntegration';
import { LogMatchList } from './subcomponents/LogMatchList';
import { IntegrationsTabProps } from './IntegrationsTab.types';
import './IntegrationsTab.scss';

// Tickets, logs (browser and service), and flagged custom events all belong to this site,
// so its Slack webhook(s) are configured here rather than shared across the
// whole instance. System health has no site to attach to and stays on the
// System health page instead.
export function IntegrationsTab({ siteId, isAdmin }: IntegrationsTabProps) {
  const {
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
  } = useSiteSlackIntegration(siteId);

  if (!isAdmin) {
    return (
      <Card className="hub-config card--static">
        <h2>Integrations</h2>
        <Notice tone="info">Only administrators can change this site's configuration.</Notice>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="hub-config">
        <Loading />
      </Card>
    );
  }

  const isSingle = routingMode === 'single';

  return (
    <form className="stack site-integrations" onSubmit={save}>
      <Card className="site-integrations__card">
        <div className="site-integrations__card-head">
          <div className="site-integrations__card-title">
            <Icon name="slack" size={18} />
            <h3>Slack</h3>
          </div>
        </div>
        <p className="muted small">Send this site's activity to Slack: new tickets, matched logs, and flagged custom events.</p>

        <Field label="Webhook routing" hint="One shared webhook, or a separate webhook per notification type.">
          <Select
            ariaLabel="Webhook routing"
            value={routingMode}
            onChange={(v) => setRoutingMode(v as SlackRoutingMode)}
            options={[
              { value: 'single', label: 'One webhook for all notifications' },
              { value: 'per_notification', label: 'Separate webhook per notification' },
            ]}
          />
        </Field>

        {isSingle && (
          <WebhookField
            label="Slack webhook"
            hint="An incoming webhook URL from a Slack app — https://hooks.slack.com/services/…"
            view={integration?.common_webhook ?? { configured: false }}
            draft={common}
            onChange={setCommon}
          />
        )}
        <SlackRequestUrl />
      </Card>

      <Card className="site-integrations__card">
        <div className="site-integrations__card-head">
          <h3>New support tickets</h3>
          <Switch checked={ticketsEnabled} onChange={setTicketsEnabled} />
        </div>
        <p className="muted small">Notify when a visitor or staff member opens a new support ticket, with a direct link to it.</p>
        {!isSingle && (
          <WebhookField
            label="Tickets webhook"
            hint="https://hooks.slack.com/services/…"
            view={integration?.tickets_webhook ?? { configured: false }}
            draft={tickets}
            onChange={setTickets}
          />
        )}
        {ticketsEnabled && (
          <div className="site-integrations__row">
            <Button type="button" variant="secondary" size="sm" disabled={testingKind !== null} onClick={() => test('tickets')}>
              {testingKind === 'tickets' ? 'Sending…' : 'Send test message'}
            </Button>
          </div>
        )}
      </Card>

      <Card className="site-integrations__card">
        <div className="site-integrations__card-head">
          <h3>Logs</h3>
          <Switch checked={logsEnabled} onChange={setLogsEnabled} />
        </div>
        <p className="muted small">
          Notify for this site's logs, from the browser and from its connected services, that already pass their
          own log settings. Those settings are always the first filter; the matches below narrow them further, each
          by severity, message, or both.
        </p>
        {!isSingle && (
          <WebhookField
            label="Logs webhook"
            hint="https://hooks.slack.com/services/…"
            view={integration?.logs_webhook ?? { configured: false }}
            draft={logs}
            onChange={setLogs}
          />
        )}
        {logsEnabled && <LogMatchList rules={logMatches} onChange={setLogMatches} />}
        {logsEnabled && (
          <div className="site-integrations__row">
            <Button type="button" variant="secondary" size="sm" disabled={testingKind !== null} onClick={() => test('logs')}>
              {testingKind === 'logs' ? 'Sending…' : 'Send test message'}
            </Button>
          </div>
        )}

        <div className="site-integrations__subsection">
          <div className="site-integrations__card-head">
            <h4>Custom events</h4>
            <Switch checked={customEnabled} onChange={setCustomEnabled} />
          </div>
          <p className="muted small">
            Notify for custom events this page explicitly flags with <code>notify: true</code> —{' '}
            <code>track(name, trackId, {'{'} notify: true {'}'})</code> or a <code>trace-ux-track-notify="true"</code>{' '}
            click. Independent of the log matches above: there is no matcher here, every flagged event notifies.
          </p>
          {!isSingle && (
            <WebhookField
              label="Custom events webhook"
              hint="https://hooks.slack.com/services/…"
              view={integration?.custom_webhook ?? { configured: false }}
              draft={custom}
              onChange={setCustom}
            />
          )}
          {customEnabled && (
            <div className="site-integrations__row">
              <Button type="button" variant="secondary" size="sm" disabled={testingKind !== null} onClick={() => test('custom')}>
                {testingKind === 'custom' ? 'Sending…' : 'Send test message'}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {dirty && (
        <div className="site-integrations__save">
          <Button type="submit" disabled={busy} title="Save unsaved changes">
            {busy ? 'Saving…' : 'Save configuration'}
          </Button>
        </div>
      )}
    </form>
  );
}
