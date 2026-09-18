import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import Switch from '../../components/ui/Switch';
import { Icon } from '../../components/ui/Icon';
import { Field, Input, Select } from '../../components/ui/fields';
import { SlackLogMatchMode, SlackRoutingMode } from '../../api';
import { useIntegrations } from './hooks/useIntegrations';
import { WebhookField } from './subcomponents/WebhookField';
import './Integrations.scss';

export default function Integrations() {
  const {
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
  } = useIntegrations();

  if (loading) {
    return (
      <main className="page">
        <PageHeader title="Integrations" />
        <Loading />
      </main>
    );
  }

  const isSingle = routingMode === 'single';

  return (
    <main className="page integrations">
      <PageHeader
        title="Integrations"
        subtitle="Send TraceUX activity to Slack: new tickets, matched browser logs, and system health alerts."
        leading={<Icon name="integrations" size={20} />}
      />

      <form className="stack" onSubmit={save}>
        <Card className="integrations__card">
          <div className="integrations__card-head">
            <Icon name="slack" size={18} />
            <h3>Slack</h3>
          </div>

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
        </Card>

        <Card className="integrations__card">
          <div className="integrations__card-head">
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
            <div className="integrations__row">
              <Button type="button" variant="secondary" size="sm" disabled={testingKind !== null} onClick={() => test('tickets')}>
                {testingKind === 'tickets' ? 'Sending…' : 'Send test message'}
              </Button>
            </div>
          )}
        </Card>

        <Card className="integrations__card">
          <div className="integrations__card-head">
            <h3>Browser logs</h3>
            <Switch checked={logsEnabled} onChange={setLogsEnabled} />
          </div>
          <p className="muted small">
            Notify for browser logs that already pass a site's own log settings — a site's severity selection is always the first
            filter, this only narrows it further.
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
          {logsEnabled && (
            <div className="integrations__grid">
              <Field label="Match mode">
                <Select
                  ariaLabel="Log match mode"
                  value={logMatchMode}
                  onChange={(v) => setLogMatchMode(v as SlackLogMatchMode)}
                  options={[
                    { value: 'contains', label: 'Contains' },
                    { value: 'exact', label: 'Exact match' },
                  ]}
                />
              </Field>
              <Field label="Message pattern" hint="Blank matches every log that passes the site's severity settings.">
                <Input value={logMatchValue} onChange={(e) => setLogMatchValue(e.target.value)} placeholder="e.g. TypeError" />
              </Field>
            </div>
          )}
          {logsEnabled && (
            <div className="integrations__row">
              <Button type="button" variant="secondary" size="sm" disabled={testingKind !== null} onClick={() => test('logs')}>
                {testingKind === 'logs' ? 'Sending…' : 'Send test message'}
              </Button>
            </div>
          )}
        </Card>

        <Card className="integrations__card">
          <div className="integrations__card-head">
            <h3>System health</h3>
            <Switch checked={systemEnabled} onChange={setSystemEnabled} />
          </div>
          <p className="muted small">
            Notify when CPU, RAM, or disk usage on the TraceUX server rises above 90%. One alert per incident, not one per check —
            the same metric can alert again after it recovers.
          </p>
          {!isSingle && (
            <WebhookField
              label="System health webhook"
              hint="https://hooks.slack.com/services/…"
              view={integration?.system_webhook ?? { configured: false }}
              draft={system}
              onChange={setSystem}
            />
          )}
          {systemEnabled && (
            <div className="integrations__row">
              <Button type="button" variant="secondary" size="sm" disabled={testingKind !== null} onClick={() => test('system')}>
                {testingKind === 'system' ? 'Sending…' : 'Send test message'}
              </Button>
            </div>
          )}
        </Card>

        {notice && <Notice tone="success">{notice}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="integrations__save">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </main>
  );
}
