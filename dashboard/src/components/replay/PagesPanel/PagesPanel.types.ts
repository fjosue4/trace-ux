import { CustomEvent, Feedback, Log, Session, SessionPage, Ticket } from '../../../api';

export type PagesPanelProps = {
  session: Pick<Session, 'started_at' | 'duration_ms'>;
  activity: CustomEvent[];
  logs: ReplayLog[];
  pages: SessionPage[];
  tickets: Ticket[];
  feedback: Feedback[];
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
    }
  | {
      kind: 'ticket';
      key: string;
      ts: number;
      ticketId: number;
      subject: string;
      status: Ticket['status'];
      order: number;
    }
  | {
      kind: 'feedback';
      key: string;
      ts: number;
      feedbackId: number;
      rating: number;
      comment: string;
      order: number;
    };
