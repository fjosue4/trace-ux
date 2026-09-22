import { Link } from 'react-router-dom';
import { Log } from '../../../api';
import { fmtTime, stripProto, truncate } from '../../../lib/format';
import Badge from '../../../components/ui/Badge';
import { Icon } from '../../../components/ui/Icon';
import { logTimestamp, severityTone } from '../Logs.helpers';

export function LogRow({ log }: { log: Log }) {
  const formattedExtra = formatExtra(log.extra);
  return (
    <tr>
      <td className="muted small">{fmtTime(logTimestamp(log))}</td>
      <td>
        <Badge tone={severityTone(log.severity)}>{log.severity}</Badge>
      </td>
      <td className="logs-message" title={log.message}>
        {truncate(log.message || '—', 100)}
      </td>
      <td className="logs-extra">
        {formattedExtra ? (
          <details>
            <summary>{truncate(formattedExtra.compact, 48)}</summary>
            <pre>{formattedExtra.pretty}</pre>
          </details>
        ) : '—'}
      </td>
      <td className="muted">{log.service_name || 'Browser'}</td>
      <td className="muted small">{log.environment || '—'}</td>
      <td className="muted">{log.site_name ?? '—'}</td>
      <td>
        {log.session_id ? (
          <Link to={`/replay/${log.session_id}`} className="logs-replay" title={log.url ? stripProto(log.url) : 'Open recording'}>
            <Icon name="play" size={11} /> Replay
          </Link>
        ) : (
          <span className="muted small logs-source">API</span>
        )}
      </td>
    </tr>
  );
}

function formatExtra(extra?: string): { compact: string; pretty: string } | null {
  if (!extra) return null;
  try {
    const parsed = JSON.parse(extra);
    return { compact: JSON.stringify(parsed), pretty: JSON.stringify(parsed, null, 2) };
  } catch {
    return { compact: extra, pretty: extra };
  }
}
