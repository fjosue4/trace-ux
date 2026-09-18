import { fmtLocalDateTime } from '../../../../lib/format';
import Badge from '../../../ui/Badge';
import Modal from '../../../ui/Modal';
import { formatReplayOffset, logTone } from '../actionHelpers';
import { ReplayLog } from '../PagesPanel.types';

type ActionDetailModalProps = {
  log: ReplayLog | null;
  firstTs: number;
  onClose: () => void;
};

export function ActionDetailModal({ log, firstTs, onClose }: ActionDetailModalProps) {
  return (
    <Modal open={log !== null} onClose={onClose} title="Log detail">
      {log && (
        <div className="action-log-detail">
          <div className="action-log-detail__meta">
            <Badge tone={logTone(log.severity)}>{log.severity}</Badge>
            <span className="muted small">
              {formatReplayOffset(log.timestamp_ms, firstTs)} · {fmtLocalDateTime(Math.floor(log.timestamp_ms / 1000))}
            </span>
          </div>
          <pre className="action-log-detail__message">{log.message || '—'}</pre>
          {log.url && (
            <a className="action-log-detail__url" href={log.url} target="_blank" rel="noreferrer">
              {log.url}
            </a>
          )}
        </div>
      )}
    </Modal>
  );
}
