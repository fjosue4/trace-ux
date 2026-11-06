import { useUser } from '../../App';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { fmtTime } from '../../lib/format';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import MetaCard from '../../components/replay/MetaCard';
import PagesPanel from '../../components/replay/PagesPanel';
import ReplayPlayer from '../../components/replay/ReplayPlayer';
import BrowserBar, { useBrowserPage } from '../../components/replay/BrowserBar';
import { SessionPage } from '../../api';
import { Icon } from '../../components/ui/Icon';
import { useReplay } from './hooks/useReplay';
import { useSessionExport } from './hooks/useSessionExport';
import SessionExportProgress from './SessionExportProgress';
import ExportForAIButton from './ExportForAIButton';
import './Replay.scss';

// Stable while the session loads, so the page lookup's memo is not rebuilt
// on every render.
const NO_PAGES: SessionPage[] = [];

export default function Replay() {
  const { user } = useUser();
  const isAdmin = user.role === 'admin';
  const { sessionId } = useParams();
  const navigate = useNavigate();
  // Set when the recording was opened from a Sessions list filtered by
  // action: the actions panel starts out searching for the same text.
  const [params] = useSearchParams();
  const actionQuery = params.get('action') ?? '';
  const { exporting, downloading, exportError, exportStatus, exportSession, cancelExport, dismissExport, onDownloadStart } = useSessionExport(sessionId);
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
    repositioning,
    durationMs,
    rebuildToken,
    windowStartMs,
  } = useReplay();
  const browser = useBrowserPage({
    pages: meta?.pages ?? NO_PAGES,
    events,
    firstTs: firstTs.current,
    currentTimeMs: currentTime,
    fallbackURL: meta?.session.initial_url,
  });
  const seekTo = (offsetMs: number | null) =>
    offsetMs === null ? undefined : () => playerRef.current?.seekToOffset(offsetMs);

  // The Sessions crumb returns to the list the replay was opened from,
  // filters included.
  const crumbs = (current: string) => <Breadcrumbs items={[{ label: 'Sessions', to: backTo }, { label: current }]} />;

  if (error) {
    return (
      <main className="page">
        {crumbs('Recording')}
        <Notice tone="error">{error}</Notice>
      </main>
    );
  }
  if (!meta) {
    return (
      <main className="page">
        {crumbs('Recording')}
        <Loading label={progress || 'Loading…'} />
      </main>
    );
  }

  const { session, custom_events: activity, logs, tickets, feedback } = meta;

  return (
    <main className="page page--wide">
      {deleteError && <Notice tone="error">{deleteError}</Notice>}
      {exportError && <Notice tone="error">{exportError}</Notice>}
      <SessionExportProgress
        status={exportStatus}
        preparing={exporting}
        onCancel={cancelExport}
        onDismiss={dismissExport}
        onDownload={onDownloadStart}
      />

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
            key={session.id}
            ref={playerRef}
            header={
              // The recorded browser stands in for the page header: its tab
              // names the recording, and closing it (red light or tab ×) goes
              // back to the list the recording was opened from.
              <BrowserBar
                page={browser.page}
                title={fmtTime(session.started_at)}
                onClose={() => navigate(backTo)}
                closeLabel="Close recording and return to Sessions"
                onBack={seekTo(browser.previousAt)}
                onForward={seekTo(browser.nextAt)}
                onReload={seekTo(browser.currentAt)}
              />
            }
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
            repositioning={repositioning}
            rebuildToken={rebuildToken}
            windowStartMs={windowStartMs}
          />
          <MetaCard session={session} />
        </div>
        <aside className="replay-side-col">
          <PagesPanel
            session={session}
            actions={
              <>
                <ExportForAIButton
                  state={exporting ? 'preparing' : downloading ? 'saving' : 'idle'}
                  disabled={exporting || downloading || deleting}
                  onExport={exportSession}
                />
                {isAdmin && (
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    disabled={!!session.active || exporting || downloading || deleting}
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
                )}
              </>
            }
            activity={activity}
            logs={logs}
            pages={meta.pages}
            tickets={tickets}
            feedback={feedback}
            eventsReady={loaded}
            currentTimeMs={currentTime}
            onSeekMs={(ms) => playerRef.current?.seekToOffset(ms)}
            initialQuery={actionQuery}
            firstTs={firstTs.current}
          />
        </aside>
      </div>
    </main>
  );
}
