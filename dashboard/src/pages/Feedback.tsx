import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Feedback, FeedbackSummary, Site } from '../api';
import { fmtTime, truncate } from '../lib/format';
import { useUser } from '../App';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Notice from '../components/ui/Notice';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Table from '../components/ui/Table';
import { Icon } from '../components/ui/Icon';
import { Select } from '../components/ui/fields';
import './Feedback.css';

type SiteSelection = number | 'all';

function Stars({ rating }: { rating: number }) {
  return (
    <span className="rating-stars" title={`${rating}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= rating ? 'on' : 'off'}>
          <Icon name="star" size={13} />
        </span>
      ))}
    </span>
  );
}

// In-app feedback & survey responses collected by the tracker widget and
// window.TraceUX.feedback(). Rows link straight to the session replay.
export default function Feedback() {
  const { user } = useUser();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [summaries, setSummaries] = useState<FeedbackSummary[]>([]);
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [error, setError] = useState('');
  const [siteSel, setSiteSel] = useState<SiteSelection>('all');
  const [surveySel, setSurveySel] = useState<string>('all');
  const [pendingDelete, setPendingDelete] = useState<Feedback | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .listSites()
      .then(setSites)
      .catch(() => setError('Could not load sites.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const siteId = siteSel === 'all' ? null : siteSel;
    const surveyId = surveySel === 'all' ? '' : surveySel;
    api
      .feedbackSummary(siteId, surveyId)
      .then((s) => {
        if (!cancelled) setSummaries(s);
      })
      .catch(() => {});
    api
      .listFeedback(siteId, surveyId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load feedback.');
      });
    return () => {
      cancelled = true;
    };
  }, [siteSel, surveySel]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteFeedback(pendingDelete.id);
      setPendingDelete(null);
      setItems((rows) => (rows ? rows.filter((r) => r.id !== pendingDelete.id) : rows));
    } catch {
      setError('Could not delete feedback.');
    } finally {
      setDeleting(false);
    }
  }

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
          fixed
          widths={['13%', '11%', '32%', '10%', '14%', '13%', '52px']}
          headers={['Rating', 'Survey', 'Comment', 'Session', 'Device', 'Received', ...(user.role === 'admin' ? [''] : [])]}
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
