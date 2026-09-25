import { Link } from 'react-router-dom';
import { useUser } from '../../App';
import PageHeader from '../../components/ui/PageHeader';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import MetaCard from '../../components/replay/MetaCard';
import PagesPanel from '../../components/replay/PagesPanel';
import ReplayPlayer from '../../components/replay/ReplayPlayer';
import { Icon } from '../../components/ui/Icon';
import { useReplay } from './hooks/useReplay';
import './Replay.scss';

export default function Replay() {
  const { user } = useUser();
  const isAdmin = user.role === 'admin';
  const {
    backTo,
    meta,
    events,
    error,
    progress,
    loaded,
    autoplay,
    confirmingDelete,
    setConfirmingDelete,
    deleting,
    deleteError,
    currentTime,
    setCurrentTime,
    firstTs,
    playerRef,
    removeSession,
    onPlaybackTime,
    onSeekOutsideBuffer,
    buffering,
    durationMs,
    rebuildToken,
    windowStartMs,
  } = useReplay();

  if (error) {
    return (
      <main className="page">
        <Notice tone="error">{error}</Notice>
      </main>
    );
  }
  if (!meta) {
    return (
      <main className="page">
        <Loading label={progress || 'Loading…'} />
      </main>
    );
  }

  const { session, custom_events: activity, logs, tickets, feedback } = meta;

  return (
    <main className="page page--wide">
      <PageHeader
        leading={
          <Link to={backTo} className="btn btn--secondary btn--sm">
            ← All sessions
          </Link>
        }
        actions={
          isAdmin && (
            <Button
              variant="danger"
              size="sm"
              disabled={!!session.active}
              title={
                session.active
                  ? 'Recording is in progress — it can be deleted once completed'
                  : 'Delete recording'
              }
              onClick={() => setConfirmingDelete(true)}
            >
              <Icon name="trash" size={13} />
              Delete
            </Button>
          )
        }
      />

      {deleteError && <Notice tone="error">{deleteError}</Notice>}

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this recording?"
        description="This permanently removes the recording and all of its events. This cannot be undone."
        confirmLabel="Delete recording"
        busy={deleting}
        onConfirm={removeSession}
        onClose={() => setConfirmingDelete(false)}
      />

      <div className="replay-grid">
        <div className="replay-main">
          <ReplayPlayer
            ref={playerRef}
            events={events}
            loaded={loaded}
            progress={progress}
            firstTs={firstTs.current}
            autoplay={autoplay}
            fallbackW={session.viewport_w}
            fallbackH={session.viewport_h}
            onTimeChange={onPlaybackTime}
            onSeekOutsideBuffer={onSeekOutsideBuffer}
            durationMs={durationMs}
            buffering={buffering}
            rebuildToken={rebuildToken}
            windowStartMs={windowStartMs}
          />
          <MetaCard session={session} />
        </div>
        <aside className="replay-side-col">
          <PagesPanel
            session={session}
            activity={activity}
            logs={logs}
            pages={meta.pages}
            tickets={tickets}
            feedback={feedback}
            eventsReady={loaded}
            currentTimeMs={currentTime}
            onSeekMs={(ms) => playerRef.current?.seekToOffset(ms)}
            firstTs={firstTs.current}
          />
        </aside>
      </div>
    </main>
  );
}
