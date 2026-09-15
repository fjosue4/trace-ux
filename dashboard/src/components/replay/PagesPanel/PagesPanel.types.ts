import { CustomEvent, Log, Session, SessionPage } from '../../../api';

export type PagesPanelProps = {
  session: Pick<Session, 'started_at' | 'duration_ms'>;
  activity: CustomEvent[];
  logs: ReplayLog[];
  pages: SessionPage[];
  eventsReady: boolean;
  firstTs: number;
  currentTimeMs: number;
  onSeekMs: (offsetMs: number) => void;
};

export type ReplayLog = Pick<Log, 'id' | 'timestamp_ms' | 'severity' | 'message' | 'url'>;

export type Action =
  | {
      kind: 'custom';
      key: string;
      ts: number;
      name: string;
      trackId: string;
      order: number;
    }
  | {
      kind: 'log';
      key: string;
      ts: number;
      severity: ReplayLog['severity'];
      message: string;
      url: string;
      log: ReplayLog;
      order: number;
    }
  | {
      kind: 'page';
      key: string;
      ts: number;
      url: string;
      title: string;
      first: boolean;
      order: number;
    };
