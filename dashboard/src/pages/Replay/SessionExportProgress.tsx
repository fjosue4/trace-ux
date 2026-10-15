import { SessionExportStatus } from '../../api';
import { fmtBytes } from '../../lib/format';
import Button from '../../components/ui/Button';
import { InlineSpinner } from '../../components/ui/Loading';
import { Icon } from '../../components/ui/Icon';

type Props = {
  status: SessionExportStatus | null;
  preparing: boolean;
  onCancel: () => void;
  onDismiss: () => void;
  onDownload: () => void;
};

export default function SessionExportProgress({ status, preparing, onCancel, onDismiss, onDownload }: Props) {
  if (!preparing && status?.state !== 'ready') return null;
  const ready = status?.state === 'ready';
  const determinate = Boolean(status && status.chunks_total > 0);
  // Completing the final chunk precedes flushing/closing the file. Only a
  // ready response can show 100% and offer a download.
  const percent = ready ? 100 : determinate
    ? Math.min(99, Math.floor((status!.chunks_done / status!.chunks_total) * 100))
    : 0;

  return (
    <section className="session-export" aria-label="Export for AI">
      <div className="session-export__head">
        <div className="session-export__copy" role="status" aria-live="polite" aria-atomic="true">
          <strong>
            {ready ? 'Export ready' : <><InlineSpinner /> Preparing export…</>}
            {!ready && determinate && ` ${status!.chunks_done.toLocaleString()} of ${status!.chunks_total.toLocaleString()} chunks (${percent}%)`}
          </strong>
          <span className="muted small">
            {ready
              ? `${fmtBytes(status!.bytes)} · Download starts automatically. Available for 5 minutes.`
              : 'Working in small batches to reduce CPU use. You can keep using the replay.'}
          </span>
        </div>
        {ready ? (
          <div className="session-export__actions">
            <a className="btn btn--secondary btn--sm" href={status!.download_url} download onClick={onDownload}>Download JSON</a>
            <button type="button" className="icon-btn" aria-label="Hide export status" title="Hide export status" onClick={onDismiss}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel export</Button>
        )}
      </div>
      <div
        className={`session-export__track${!ready && !determinate ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-label="Session export preparation progress"
        aria-valuemin={ready || determinate ? 0 : undefined}
        aria-valuemax={ready || determinate ? 100 : undefined}
        aria-valuenow={ready || determinate ? percent : undefined}
      >
        <span style={ready || determinate ? { width: `${percent}%` } : undefined} />
      </div>
    </section>
  );
}
