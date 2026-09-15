import { Link } from 'react-router-dom';
import { Log } from '../../../api';
import { fmtTime, stripProto, truncate } from '../../../lib/format';
import Badge from '../../../components/ui/Badge';
import { Icon } from '../../../components/ui/Icon';
import { logTimestamp, severityTone } from '../Logs.helpers';

export function LogRow({ log }: { log: Log }) {
  return (
    <tr>
      <td className="muted small">{fmtTime(logTimestamp(log))}</td>
      <td>
        <Badge tone={severityTone(log.severity)}>{log.severity}</Badge>
      </td>
      <td className="logs-message" title={log.message}>
        {truncate(log.message || '—', 100)}
      </td>
      <td className="muted">{log.site_name ?? '—'}</td>
      <td className="muted small" title={log.url}>
        {log.url ? truncate(stripProto(log.url), 32) : '—'}
      </td>
      <td>
        <Link to={`/replay/${log.session_id}`} className="logs-replay" title="Open recording">
          <Icon name="play" size={11} />
          Replay
        </Link>
      </td>
    </tr>
  );
}
