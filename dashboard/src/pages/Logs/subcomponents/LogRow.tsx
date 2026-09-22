import { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Log } from '../../../api';
import { fmtTime, stripProto, truncate } from '../../../lib/format';
import Badge from '../../../components/ui/Badge';
import { Icon } from '../../../components/ui/Icon';
import { formatExtra, logTimestamp, severityTone } from '../Logs.helpers';

// The whole row opens the detail modal; the table cells stay one-line previews.
export function LogRow({ log, onOpen }: { log: Log; onOpen: (log: Log) => void }) {
  const formattedExtra = formatExtra(log.extra);

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(log);
    }
  }

  return (
    <tr className="logs-row" tabIndex={0} onClick={() => onOpen(log)} onKeyDown={onKeyDown} aria-label={`Open ${log.severity} log details`}>
      <td className="muted small">{fmtTime(logTimestamp(log))}</td>
      <td>
        <Badge tone={severityTone(log.severity)}>{log.severity}</Badge>
      </td>
      <td className="logs-message">
        {truncate(log.message || '—', 100)}
      </td>
      <td className="logs-extra">
        {formattedExtra ? <span className="logs-extra__preview">{truncate(formattedExtra.compact, 80)}</span> : '—'}
      </td>
      <td className="muted">{log.service_name || 'Browser'}</td>
      <td className="muted small">{log.environment || '—'}</td>
      <td className="muted">{log.site_name ?? '—'}</td>
      <td>
        {log.session_id ? (
          <Link
            to={`/replay/${log.session_id}`}
            className="logs-replay"
            title={log.url ? stripProto(log.url) : 'Open recording'}
            onClick={(event) => event.stopPropagation()}
          >
            <Icon name="play" size={11} /> Replay
          </Link>
        ) : (
          <span className="muted small logs-source">API</span>
        )}
      </td>
    </tr>
  );
}
