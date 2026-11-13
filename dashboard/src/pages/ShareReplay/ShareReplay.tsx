import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import Logo from '../../components/ui/Logo';
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
      <header className="share-replay-intro">
        <div className="share-replay-brand">
          <Logo className="share-replay-logo" title="TraceUX" />
        </div>
        <div className="share-replay-heading">
          <div>
            <h1>Your visit</h1>
            <p className="share-replay-sub">This private demo link is limited to this recording and expires automatically.</p>
          </div>
          <span className="share-replay-tag">Temporary demo replay</span>
        </div>
      </header>
      {error ? (
        <EmptyState title="This replay isn't available" description={error} />
      ) : !session ? (
        <Loading label={progress} />
      ) : (
        <div className="share-replay-layout">
          <div className="share-replay-player">
            <ReplayPlayer
              key={session.id}
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
            // Public bearer link: the visitor's page-by-page path, tickets and
            // feedback are withheld here for the same reason referrers and
            // identity fields are -- this link needs no login to open.
            pages={[]}
            tickets={[]}
            feedback={[]}
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
