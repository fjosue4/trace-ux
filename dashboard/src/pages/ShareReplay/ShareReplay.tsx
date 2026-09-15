import Loading from '../../components/ui/Loading';
import Notice from '../../components/ui/Notice';
import PagesPanel from '../../components/replay/PagesPanel';
import ReplayPlayer from '../../components/replay/ReplayPlayer';
import { useShareReplay } from './hooks/useShareReplay';
import '../Replay/Replay.scss';

// Public viewer for the short-lived demo capability. It mounts the same
// ReplayPlayer as the dashboard, but never the authenticated app shell, and
// never requests the richer session metadata endpoints.
export default function ShareReplay() {
  const { session, events, error, progress, loaded, activity, logs, currentTime, setCurrentTime, firstTs, playerRef } = useShareReplay();

  return (
    <main className="page page--wide share-replay-page">
      <div className="share-replay-intro">
        <p className="share-replay-eyebrow">Temporary Trace UX demo replay</p>
        <h1>Your visit</h1>
        <p className="muted">This private demo link is limited to this recording and expires automatically.</p>
      </div>
      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : !session ? (
        <Loading label={progress} />
      ) : (
        <div className="share-replay-layout">
          <div className="share-replay-player">
            <ReplayPlayer
              ref={playerRef}
              events={events}
              loaded={loaded}
              progress={progress}
              firstTs={firstTs.current}
              fallbackW={session.viewport_w}
              fallbackH={session.viewport_h}
              onTimeChange={setCurrentTime}
            />
          </div>
          <PagesPanel
            session={session}
            activity={activity}
            logs={logs}
            // Public bearer link: the visitor's page-by-page path is withheld
            // here for the same reason referrers and identity fields are.
            pages={[]}
            currentTimeMs={currentTime}
            eventsReady={loaded}
            firstTs={firstTs.current}
            onSeekMs={(ms) => playerRef.current?.seekToOffset(ms)}
          />
        </div>
      )}
    </main>
  );
}
