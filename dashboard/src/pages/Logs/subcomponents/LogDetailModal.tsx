import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Log } from '../../../api';
import { stripProto } from '../../../lib/format';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { Icon } from '../../../components/ui/Icon';
import { DetailEmpty, DetailMeta, DetailPane } from '../../../components/ui/DetailModal';
import { formatExtra, logTimestampMs, severityTone } from '../Logs.helpers';

type CopyTarget = 'message' | 'extra' | 'log' | 'link';

// Full view of one log row: the table truncates message and extra, so this is
// the only place either is shown complete.
export function LogDetailModal({ log, onClose }: { log: Log | null; onClose: () => void }) {
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyError, setCopyError] = useState('');

  useEffect(() => {
    setCopied(null);
    setCopyError('');
  }, [log?.id]);

  const extra = log ? formatExtra(log.extra) : null;

  async function copy(target: CopyTarget, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyError('');
      setCopied(target);
      window.setTimeout(() => setCopied((current) => (current === target ? null : current)), 1600);
    } catch {
      setCopyError('Could not copy to the clipboard.');
    }
  }

  function copyWholeLog() {
    if (!log) return;
    let parsedExtra: unknown = log.extra || null;
    try {
      parsedExtra = log.extra ? JSON.parse(log.extra) : null;
    } catch {
      // Keep the raw string when extra is not valid JSON.
    }
    const record = {
      time: new Date(logTimestampMs(log)).toISOString(),
      severity: log.severity,
      message: log.message,
      service: log.service_name || 'Browser',
      environment: log.environment || null,
      site: log.site_name ?? null,
      session_id: log.session_id || null,
      url: log.url || null,
      extra: parsedExtra,
    };
    copy('log', JSON.stringify(record, null, 2));
  }

  return (
    <Modal
      open={log !== null}
      onClose={onClose}
      title="Log details"
      className="detail-modal log-detail"
      footer={log && (
        <>
          {copyError && <span className="log-detail__copy-error small">{copyError}</span>}
          {log.session_id && (
            <Link to={`/replay/${log.session_id}`} className="btn btn--secondary btn--sm">
              <Icon name="play" size={12} /> Open replay
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={() => copy('link', `${window.location.origin}/logs/log/${log.id}`)}>
            <Icon name={copied === 'link' ? 'check' : 'copy'} size={13} /> {copied === 'link' ? 'Copied' : 'Copy link'}
          </Button>
          <Button variant="secondary" size="sm" onClick={copyWholeLog}>
            <Icon name={copied === 'log' ? 'check' : 'copy'} size={13} /> {copied === 'log' ? 'Copied' : 'Copy log as JSON'}
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>Close</Button>
        </>
      )}
    >
      {log && (
        <>
          <DetailMeta
            items={[
              { label: 'Time', value: formatFullTime(logTimestampMs(log)) },
              { label: 'Level', value: <Badge tone={severityTone(log.severity)}>{log.severity}</Badge> },
              { label: 'Service', value: log.service_name || 'Browser' },
              { label: 'Environment', value: log.environment || '—' },
              { label: 'Site', value: log.site_name ?? '—' },
              {
                label: 'Source',
                title: log.url || undefined,
                value: log.session_id ? (log.url ? stripProto(log.url) : 'Browser session') : 'API',
              },
            ]}
          />

          <div className="log-detail__panes">
            <DetailPane
              label="Message"
              actions={
                <Button variant="ghost" size="sm" onClick={() => copy('message', log.message)} disabled={!log.message}>
                  <Icon name={copied === 'message' ? 'check' : 'copy'} size={13} /> {copied === 'message' ? 'Copied' : 'Copy'}
                </Button>
              }
            >
              <pre className="log-detail__message">{log.message || '—'}</pre>
            </DetailPane>
            <DetailPane
              label="Extra"
              actions={
                <Button variant="ghost" size="sm" onClick={() => extra && copy('extra', extra.pretty)} disabled={!extra}>
                  <Icon name={copied === 'extra' ? 'check' : 'copy'} size={13} /> {copied === 'extra' ? 'Copied' : 'Copy'}
                </Button>
              }
            >
              {extra ? (
                <pre className="log-detail__extra">{extra.pretty}</pre>
              ) : (
                <DetailEmpty>No extra data was sent with this log.</DetailEmpty>
              )}
            </DetailPane>
          </div>
        </>
      )}
    </Modal>
  );
}

function formatFullTime(ms: number): string {
  if (!ms) return '—';
  const date = new Date(ms);
  const local = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${local}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}
