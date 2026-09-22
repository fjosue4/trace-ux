import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, LogSeverity, PerformanceKey, Service } from '../../../../api';
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
  legacyPerformanceKeys: PerformanceKey[];
};

export function ServicesTab({ siteId, isAdmin, siteSeverities, legacyPerformanceKeys }: Props) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState<{ service: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedExample, setCopiedExample] = useState<'logs' | 'performance' | null>(null);
  const [legacyKeys, setLegacyKeys] = useState<PerformanceKey[]>(legacyPerformanceKeys);

  useEffect(() => {
    setLegacyKeys(legacyPerformanceKeys);
  }, [legacyPerformanceKeys]);

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

  async function copyExample(kind: 'logs' | 'performance', example: string) {
    try {
      await navigator.clipboard.writeText(example);
      setCopiedExample(kind);
      window.setTimeout(() => setCopiedExample((current) => (current === kind ? null : current)), 1600);
    } catch {
      setError('Could not copy the example.');
    }
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

  async function removeLegacyKey(key: PerformanceKey) {
    if (!window.confirm(`Remove legacy performance key ${key.key_hint}? Any backend using it will stop sending performance data.`)) return;
    setError('');
    try {
      await api.deletePerformanceKey(siteId, key.id);
      setLegacyKeys((keys) => keys.filter((item) => item.id !== key.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the legacy performance key.');
    }
  }

  const logsExample = `curl -X POST "${location.origin}/api/logs/ingest" \\
  -H "Content-Type: application/json" \\
  -H "X-TraceUX-Service-Key: $TRACE_UX_SERVICE_KEY" \\
  -d '{"logs":[{"severity":"error","message":"Payment request failed","environment":"production","extra":{"request_id":"req_123","status_code":502}}]}'`;
  const performanceExample = `curl -X POST "${location.origin}/api/performance/ingest" \\
  -H "Content-Type: application/json" \\
  -H "X-TraceUX-Service-Key: $TRACE_UX_SERVICE_KEY" \\
  -d '{"observations":[{"environment":"production","version":"1.4.0","endpoint":"GET /orders","duration_ms":184,"status_code":200}]}'`;

  return (
    <div className="services-tab">
      <Card className="services-intro">
        <div className="services-intro__head">
          <div>
            <h2>Services</h2>
            <p className="muted small">
              Connect a backend or external service once, then use the same revocable API key for
              logs and performance. The key identifies both this site and the service automatically.
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
              <Button type="submit" disabled={busy || !name.trim()}>
                <Icon name="plus" size={13} />
                {busy ? 'Creating…' : 'Add service'}
              </Button>
            </form>
          )}
        </div>
        <div className="services-examples">
          <div>
            <div className="services-examples__head">
              <strong>Send logs</strong>
              <Button variant="ghost" size="sm" onClick={() => copyExample('logs', logsExample)}>
                <Icon name={copiedExample === 'logs' ? 'check' : 'copy'} size={13} /> {copiedExample === 'logs' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <pre>{logsExample}</pre>
          </div>
          <div>
            <div className="services-examples__head">
              <strong>Send performance</strong>
              <div className="services-examples__actions">
                <Link to="/performance">Open Performance</Link>
                <Button variant="ghost" size="sm" onClick={() => copyExample('performance', performanceExample)}>
                  <Icon name={copiedExample === 'performance' ? 'check' : 'copy'} size={13} /> {copiedExample === 'performance' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            <pre>{performanceExample}</pre>
          </div>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      {newKey && (
        <Notice tone="success">
          <div className="service-new-key">
            <span><strong>{newKey.service} key created.</strong> Use it for logs and performance. Copy it now; the full value is shown only once.</span>
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
          description="Add a backend or external service to generate one key for logs and performance."
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

      {legacyKeys.length > 0 && (
        <Card className="legacy-keys">
          <div className="legacy-keys__head">
            <strong>Legacy performance keys</strong>
            <span className="muted small">
              Site-level keys from before services still send performance data to the site-addressed
              endpoint. Move those backends to a service key, then remove these.
            </span>
          </div>
          <div className="legacy-keys__rows">
            {legacyKeys.map((key) => (
              <div className="legacy-keys__row" key={key.id}>
                <code>{key.key_hint}</code>
                <span className="muted small">
                  Created {fmtTime(key.created_at)} · {key.last_used_at ? `Last used ${fmtTime(key.last_used_at)}` : 'Not used yet'}
                </span>
                {isAdmin && (
                  <Button variant="dangerGhost" size="sm" onClick={() => removeLegacyKey(key)}>
                    <Icon name="trash" size={13} /> Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
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
            <span className="field-label">Log severity levels</span>
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
            <Button variant="primary" size="sm" disabled={!dirty || saving || !name.trim()} onClick={save}>
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
