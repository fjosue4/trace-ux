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
import FilterPanel from '../../components/ui/FilterPanel';
import { useFeedback } from './hooks/useFeedback';
import { Stars } from './subcomponents/Stars';
import './Feedback.scss';

function feedbackAnswer(feedback: FeedbackType) {
  if (feedback.campaign_answer_type === 'sentiment') {
    return <span className="chip">{feedback.answers?.find((answer) => answer.id === 'rating')?.value || '—'}</span>;
  }
  if (feedback.campaign_answer_type === 'scale_10') return <span className="chip">{feedback.rating}/10</span>;
  return feedback.rating <= 5 ? <Stars rating={feedback.rating} /> : <span className="chip">{feedback.rating}/10</span>;
}

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

      <FilterPanel title="Filter feedback">
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
          ariaLabel="Campaign"
          value={surveySel}
          onChange={setSurveySel}
          options={[
            { value: 'all', label: 'All campaigns' },
            ...summaries.map((s) => ({ value: s.survey_id, label: s.campaign_name || s.survey_id })),
          ]}
        />
      </FilterPanel>

      {error && <Notice tone="error">{error}</Notice>}

      {summaries.length > 0 && (
        <div className="feedback-summary">
          {summaries.map((s) => (
            <Card key={`${s.campaign_id || 0}-${s.survey_id}`} className="feedback-card">
              <span className="feedback-card__label">{s.campaign_name || s.survey_id}</span>
              <div className="feedback-card__row">
                <strong className="feedback-card__num">{s.count}</strong>
                <span className="muted small">responses</span>
              </div>
              <span className="feedback-card__avg">
                {s.campaign_answer_type === 'sentiment' ? (
                  <span className="chip">{Math.round(s.average * 100)}% Good</span>
                ) : s.campaign_answer_type === 'scale_10' || s.average > 5 ? (
                  <span className="chip">{s.average.toFixed(1)}/10</span>
                ) : (
                  <Stars rating={Math.round(s.average)} />
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
          // Session and the ticket button are fixed-size controls, so their
          // columns are sized to fit them rather than a share of the width.
          widths={['12%', '10%', '28%', '96px', '13%', '12%', '150px', ...(user.role === 'admin' ? ['52px'] : [])]}
          headers={['Rating', 'Campaign', 'Comment', 'Session', 'Device', 'Received', '', ...(user.role === 'admin' ? [''] : [])]}
        >
          {items.map((f) => (
            <tr key={f.id}>
              <td>{feedbackAnswer(f)}</td>
              <td className="small" title={f.campaign_key || f.survey_id}>
                {f.campaign_name || f.campaign_key || f.survey_id}
              </td>
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
              {pendingDelete.campaign_answer_type === 'sentiment' ? (
                <>{pendingDelete.answers?.find((answer) => answer.id === 'rating')?.value || 'sentiment'}</>
              ) : pendingDelete.campaign_answer_type === 'scale_10' || pendingDelete.rating > 5 ? (
                <>{pendingDelete.rating}/10</>
              ) : (
                <>{pendingDelete.rating}-star</>
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
