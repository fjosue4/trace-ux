import { FormEvent, useEffect, useState } from 'react';
import { api, LogSeverity, Service } from '../../../../api';
import Button from '../../../../components/ui/Button';
import Card from '../../../../components/ui/Card';
import EmptyState from '../../../../components/ui/EmptyState';
import Loading from '../../../../components/ui/Loading';
import Notice from '../../../../components/ui/Notice';
import Switch from '../../../../components/ui/Switch';
import { Field, Input, Select } from '../../../../components/ui/fields';
import { Icon } from '../../../../components/ui/Icon';
import { fmtTime } from '../../../../lib/format';

const severityOptions: Array<{ value: LogSeverity; label: string }> = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
];

type Props = {
  siteId: number;
  isAdmin: boolean;
  siteSeverities: LogSeverity[];
};

export function ServicesTab({ siteId, isAdmin, siteSeverities }: Props) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState<{ service: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      setServices(await api.listServices(siteId));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load services.');
    }
  }

  useEffect(() => {
    setServices(null);
    setNewKey(null);
    load();
  }, [siteId]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.createService(siteId, name.trim());
      setName('');
      setNewKey({ service: result.service.name, value: result.api_key });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create service.');
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey.value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function update(service: Service, update: Pick<Service, 'name' | 'inherit_severities' | 'severities'>) {
    setError('');
    try {
      await api.updateService(siteId, service.id, update);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update service.');
      throw e;
    }
  }

  async function rotate(service: Service) {
    setError('');
    try {
      const result = await api.rotateServiceKey(siteId, service.id);
      setNewKey({ service: service.name, value: result.api_key });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rotate the service key.');
    }
  }

  async function revoke(service: Service) {
    setError('');
    try {
      await api.revokeServiceKey(siteId, service.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke the service key.');
    }
  }

  const endpoint = `${location.origin}/api/logs/ingest`;
  const example = `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-TraceUX-Log-Key: $TRACE_UX_LOG_KEY" \\
  -d '{"logs":[{"severity":"error","message":"Payment request failed","environment":"production","extra":{"request_id":"req_123","status_code":502}}]}'`;

  return (
    <div className="services-tab">
      <Card className="services-intro">
        <div className="services-intro__head">
          <div>
            <h2>Services</h2>
            <p className="muted small">
              Send backend or external-service logs into the same stream as browser logs. Each
              service gets its own revocable API key and inherits the site severity selection by default.
            </p>
          </div>
          {isAdmin && (
            <form className="services-create" onSubmit={create}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Service name"
                maxLength={100}
                aria-label="Service name"
              />
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                <Icon name="plus" size={13} />
                {busy ? 'Creating…' : 'Add service'}
              </Button>
            </form>
          )}
        </div>
        <pre className="site-performance-key__example">{example}</pre>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      {newKey && (
        <Notice tone="success">
          <div className="service-new-key">
            <span><strong>{newKey.service} key created.</strong> Copy it now; the full value is shown only once.</span>
            <code>{newKey.value}</code>
            <Button variant="secondary" size="sm" onClick={copyKey}>
              <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copied' : 'Copy key'}
            </Button>
          </div>
        </Notice>
      )}

      {services === null ? (
        <Loading />
      ) : services.length === 0 ? (
        <EmptyState
          title="No services yet"
          description="Add a backend or external service to generate its log ingestion key."
          icon={<Icon name="code" size={20} />}
        />
      ) : (
        <div className="services-list">
          {services.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              isAdmin={isAdmin}
              siteSeverities={siteSeverities}
              onUpdate={update}
              onRotate={rotate}
              onRevoke={revoke}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard({
  service,
  isAdmin,
  siteSeverities,
  onUpdate,
  onRotate,
  onRevoke,
}: {
  service: Service;
  isAdmin: boolean;
  siteSeverities: LogSeverity[];
  onUpdate: (service: Service, update: Pick<Service, 'name' | 'inherit_severities' | 'severities'>) => Promise<void>;
  onRotate: (service: Service) => Promise<void>;
  onRevoke: (service: Service) => Promise<void>;
}) {
  const [name, setName] = useState(service.name);
  const [inherit, setInherit] = useState(service.inherit_severities);
  const [severities, setSeverities] = useState<LogSeverity[]>(service.severities);
  const [saving, setSaving] = useState(false);
  const effective = inherit ? siteSeverities : severities;
  const dirty = name.trim() !== service.name || inherit !== service.inherit_severities ||
    JSON.stringify(severities) !== JSON.stringify(service.severities);

  useEffect(() => {
    setName(service.name);
    setInherit(service.inherit_severities);
    setSeverities(service.severities);
  }, [service]);

  async function save() {
    setSaving(true);
    try {
      await onUpdate(service, { name: name.trim(), inherit_severities: inherit, severities });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="service-card">
      <div className="service-card__head">
        <div>
          <strong>{service.name}</strong>
          <span className="muted small">
            <code>{service.key_hint}</code> · Created {fmtTime(service.created_at)} ·{' '}
            {service.revoked_at ? `Revoked ${fmtTime(service.revoked_at)}` : service.last_used_at ? `Last used ${fmtTime(service.last_used_at)}` : 'Not used yet'}
          </span>
        </div>
        <span className={`chip${service.revoked_at ? '' : ' chip--accent'}`}>
          {service.revoked_at ? 'Revoked' : 'Active'}
        </span>
      </div>

      <div className="service-card__fields">
        <Field label="Service name">
          <Input value={name} onChange={(event) => setName(event.target.value)} disabled={!isAdmin} maxLength={100} />
        </Field>
        <div className="field service-severity-field">
          <div className="service-severity-field__head">
            <span className="field-label">Severity levels</span>
            <Switch
              checked={inherit}
              disabled={!isAdmin}
              onChange={(value) => {
                if (!value && inherit) setSeverities(siteSeverities);
                setInherit(value);
              }}
              label="Use site levels"
            />
          </div>
          <Select
            multiple
            value={effective}
            disabled={!isAdmin || inherit}
            emptyLabel="No levels selected"
            options={severityOptions}
            onChange={(value) => setSeverities(value as LogSeverity[])}
          />
          <span className="field-hint">
            {inherit
              ? `Using this site's levels: ${effective.join(', ') || 'none'}. Turn off to customize.`
              : 'Custom levels for this service.'}
          </span>
        </div>
      </div>

      {isAdmin && (
        <div className="service-card__actions">
          <div>
            <Button variant="ghost" size="sm" disabled={!dirty || saving || !name.trim()} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onRotate(service)}>
              {service.revoked_at ? 'Generate new key' : 'Rotate key'}
            </Button>
            {!service.revoked_at && (
              <Button variant="dangerGhost" size="sm" onClick={() => onRevoke(service)}>Revoke key</Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
