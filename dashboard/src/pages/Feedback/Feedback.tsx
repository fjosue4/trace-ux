import { useState } from 'react';
import { Feedback as FeedbackType } from '../../api';
import { Link } from 'react-router-dom';
import { fmtTime, truncate } from '../../lib/format';
import { useUser } from '../../App';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import CreateTicketModal from '../../components/tickets/CreateTicketModal';
import { Icon } from '../../components/ui/Icon';
import { Select } from '../../components/ui/fields';
import { useFeedback } from './hooks/useFeedback';
import { Stars } from './subcomponents/Stars';
import './Feedback.scss';

// In-app feedback & survey responses collected by the tracker widget and
// window.TraceUX.feedback(). Rows link straight to the session replay.
export default function Feedback() {
  const { user } = useUser();
  const [ticketFor, setTicketFor] = useState<FeedbackType | null>(null);
  const { sites, summaries, items, error, siteSel, setSiteSel, surveySel, setSurveySel, pendingDelete, setPendingDelete, deleting, confirmDelete } =
    useFeedback();

  return (
    <main className="page">
      <PageHeader
        title="Feedback"
        subtitle="In-app responses from your sites — click a row's session to watch the moment it happened."
      />

      <div className="filters">
        <Select
          className="site-picker"
          ariaLabel="Site"
          value={String(siteSel)}
          onChange={(v) => setSiteSel(v === 'all' ? 'all' : Number(v))}
          options={[
            { value: 'all', label: 'All sites' },
            ...(sites ?? []).map((s) => ({ value: String(s.id), label: s.name })),
          ]}
        />
        <Select
          className="site-picker"
          ariaLabel="Survey"
          value={surveySel}
          onChange={setSurveySel}
          options={[
            { value: 'all', label: 'All surveys' },
            ...summaries.map((s) => ({ value: s.survey_id, label: s.survey_id })),
          ]}
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {summaries.length > 0 && (
        <div className="feedback-summary">
          {summaries.map((s) => (
            <Card key={s.survey_id} className="feedback-card">
              <span className="feedback-card__label">{s.survey_id}</span>
              <div className="feedback-card__row">
                <strong className="feedback-card__num">{s.count}</strong>
                <span className="muted small">responses</span>
              </div>
              <span className="feedback-card__avg">
                {s.average <= 5 ? (
                  <Stars rating={Math.round(s.average)} />
                ) : (
                  <span className="chip">{s.average.toFixed(1)}/10</span>
                )}
              </span>
            </Card>
          ))}
        </div>
      )}

      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          title="No feedback yet"
          description='Enable the in-app widget by adding data-feedback="1" to the snippet, or call window.TraceUX.feedback({ rating: 5 }).'
        />
      ) : (
        <Table
          className="feedback-table"
          fixed
          widths={['12%', '10%', '28%', '9%', '13%', '12%', '100px', ...(user.role === 'admin' ? ['52px'] : [])]}
          headers={['Rating', 'Survey', 'Comment', 'Session', 'Device', 'Received', '', ...(user.role === 'admin' ? [''] : [])]}
        >
          {items.map((f) => (
            <tr key={f.id}>
              <td>{f.rating <= 5 ? <Stars rating={f.rating} /> : <span className="chip">{f.rating}/10</span>}</td>
              <td className="mono small">{f.survey_id}</td>
              <td title={f.comment} className="feedback-comment">
                {f.comment ? truncate(f.comment, 60) : '—'}
              </td>
              <td>
                {f.session_id ? (
                  <Link to={`/replay/${f.session_id}`} className="feedback-session" title="Open replay">
                    <Icon name="play" size={11} />
                    Replay
                  </Link>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="muted">{[f.browser, f.device].filter(Boolean).join(' · ') || '—'}</td>
              <td className="muted">{fmtTime(f.created_at)}</td>
              <td>
                {f.visitor_key ? (
                  <Button size="sm" variant="secondary" onClick={() => setTicketFor(f)}>Start a ticket</Button>
                ) : (
                  <span className="muted small" title="This response predates visitor keys, so there is no widget to deliver a ticket to">—</span>
                )}
              </td>
              {user.role === 'admin' && (
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    onClick={() => setPendingDelete(f)}
                    aria-label="Delete feedback"
                    title="Delete"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}

      {ticketFor && (
        <CreateTicketModal
          showModal
          toggleModalOpen={() => setTicketFor(null)}
          siteId={ticketFor.site_id}
          visitorKey={ticketFor.visitor_key ?? ''}
          userId={ticketFor.user_id}
          sessionId={ticketFor.session_id}
          defaultSubject="About your feedback"
          defaultBody={ticketFor.comment ? `You wrote: “${ticketFor.comment}”\n\n` : ''}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this response?"
        description={
          pendingDelete && (
            <>
              The{' '}
              {pendingDelete.rating <= 5 ? (
                <>{pendingDelete.rating}-star</>
              ) : (
                <>{pendingDelete.rating}/10</>
              )}{' '}
              response{pendingDelete.comment ? ' and its comment' : ''} will be removed permanently.
            </>
          )
        }
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </main>
  );
}
