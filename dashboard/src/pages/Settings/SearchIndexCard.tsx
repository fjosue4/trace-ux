import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Notice from '../../components/ui/Notice';
import Switch from '../../components/ui/Switch';
import { fmtBytes, fmtDuration, fmtTime } from '../../lib/format';
import { useSearchIndex } from './hooks/useSearchIndex';

export default function SearchIndexCard() {
  const {
    status,
    loading,
    busy,
    error,
    confirmingOff,
    setConfirmingOff,
    toggle,
    disable,
    retry,
  } = useSearchIndex();

  const determinate = Boolean(status && status.sessions_total > 0);
  const percent = status && determinate
    ? Math.max(0, Math.min(100, (status.sessions_done / status.sessions_total) * 100))
    : 0;
  const indexing = Boolean(status?.enabled && (status.state === 'building' || status.state === 'off'));

  return (
    <>
      <Card className="settings__search-index">
        <div className="settings__search-index-head">
          <div>
            <h3>Session search index</h3>
            <p className="muted small">
              Indexes pages, clicks and browser logs so searches return in milliseconds. Uses extra disk space.
            </p>
          </div>
          <Switch
            checked={status?.enabled ?? false}
            onChange={toggle}
            label="Fast session search"
            disabled={loading || busy || status === null}
          />
        </div>

        {error && <Notice tone="error">{error}</Notice>}
        {status?.error && (
          <Notice tone="error">
            <span>{status.error}</span>{' '}
            <Button size="sm" variant="secondary" disabled={busy} onClick={retry}>
              Retry
            </Button>
          </Notice>
        )}
        {status?.overflowed && !status.error && (
          <Notice tone="warn">
            One session is too large for the fast index, so searches are using the standard method. Delete that session, then turn the index off and back on to rebuild it.
          </Notice>
        )}

        {indexing && !status?.error && (
          <div className="search-index-progress">
            <div className="search-index-progress__copy">
              <strong>
                {determinate
                  ? `Indexing sessions… ${status!.sessions_done.toLocaleString()} of ${status!.sessions_total.toLocaleString()} (${Math.round(percent)}%)`
                  : 'Preparing index…'}
              </strong>
              <span className="muted small">
                {status?.started_at ? `Started ${fmtTime(status.started_at)}` : 'Starting in the background'}
                {status?.eta_seconds ? ` · about ${fmtDuration(status.eta_seconds * 1000)} left` : ''}
              </span>
            </div>
            <div
              className={`search-index-progress__track${determinate ? '' : ' is-indeterminate'}`}
              role="progressbar"
              aria-label="Session search indexing progress"
              aria-valuemin={determinate ? 0 : undefined}
              aria-valuemax={determinate ? 100 : undefined}
              aria-valuenow={determinate ? Math.round(percent) : undefined}
            >
              <span style={determinate ? { width: `${percent}%` } : undefined} />
            </div>
            <p className="muted small">Search uses the standard method until indexing finishes.</p>
          </div>
        )}

        {status && !indexing && !status.error && (
          <p className="search-index-status muted small">
            {status.state === 'ready' && (
              status.enabled
                ? status.overflowed
                  ? <>Index paused · searches use the standard method</>
                  : <>Ready · {status.sessions_total.toLocaleString()} sessions indexed · {fmtBytes(status.bytes)}</>
                : <>Preparing to remove index…</>
            )}
            {status.state === 'building' && !status.enabled && <>Stopping indexing…</>}
            {status.state === 'dropping' && (
              <>Removing index… {fmtBytes(status.bytes_freed)} freed so far</>
            )}
            {status.state === 'off' && status.reason === 'low_disk' && (
              <>Turned off automatically to free disk space on {fmtTime(status.reason_at)}.</>
            )}
            {status.state === 'off' && status.reason !== 'low_disk' && (
              <>Off · searches use the standard method</>
            )}
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmingOff}
        title="Turn off fast session search?"
        description="Searches for rare terms will be slow again. You can turn this back on at any time; rebuilding takes a few minutes."
        confirmLabel="Turn off"
        busy={busy}
        onConfirm={disable}
        onClose={() => setConfirmingOff(false)}
      />
    </>
  );
}
