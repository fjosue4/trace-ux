import { useState } from 'react';
import { Feedback as FeedbackType } from '../../api';
import { Link } from 'react-router-dom';
import { fmtTime, truncate } from '../../lib/format';
import { useUser } from '../../App';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
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
import FeedbackSettingsModal from '../../components/sites/FeedbackSettingsModal';
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

function answerTypeLabel(answerType: string) {
  if (answerType === 'sentiment') return 'Good / Bad';
  if (answerType === 'scale_10') return 'Scale 1–10';
  return 'Stars 1–5';
}

function recurrenceLabel(recurrence: string) {
  if (recurrence === 'daily') return 'Every 24 hours';
  if (recurrence === 'weekly') return 'Every 7 days';
  return 'Every occurrence';
}

// In-app feedback & survey responses collected by the tracker widget and
// window.TraceUX.feedback(). Rows link straight to the session replay.
export default function Feedback() {
  const { user } = useUser();
  const [ticketFor, setTicketFor] = useState<FeedbackType | null>(null);
  const [campaignModal, setCampaignModal] = useState<{ siteId: number; campaignId?: number; creating?: boolean } | null>(null);
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [newCampaignSite, setNewCampaignSite] = useState<number | null>(null);
  const {
    sites,
    campaigns,
    refreshCampaigns,
    summaries,
    items,
    error,
    siteSel,
    setSiteSel,
    surveySel,
    setSurveySel,
    pendingDelete,
    setPendingDelete,
    deleting,
    confirmDelete,
  } = useFeedback();

  function beginCreateCampaign() {
    if (siteSel !== 'all') {
      setCampaignModal({ siteId: siteSel, creating: true });
      return;
    }
    if (sites?.length === 1) {
      setCampaignModal({ siteId: sites[0].id, creating: true });
      return;
    }
    const firstSite = sites?.[0]?.id ?? null;
    setNewCampaignSite(firstSite);
    setSitePickerOpen(true);
  }

  return (
    <main className="page">
      <PageHeader
        title="Feedback"
        subtitle="In-app responses from your sites — click a row's session to watch the moment it happened."
        actions={user.role === 'admin' ? (
          <Button onClick={beginCreateCampaign} disabled={!sites?.length}>
            <Icon name="plus" size={14} /> New campaign
          </Button>
        ) : undefined}
      />

      <FilterPanel title="Campaigns">
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
      </FilterPanel>

      {error && <Notice tone="error">{error}</Notice>}

      {campaigns === null ? (
        <Loading />
      ) : campaigns.length === 0 ? (
        <Card className="card--static feedback-campaign-empty">
          <EmptyState
            title="No campaigns for this site"
            description="Create a campaign to ask for feedback after a product interaction."
            action={user.role === 'admin' ? <Button onClick={beginCreateCampaign}>Create a campaign</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="feedback-campaign-grid">
          {campaigns.map((campaign) => (
            <Card className="feedback-campaign-card" key={campaign.id}>
              <div className="feedback-campaign-card__top">
                <span className="feedback-campaign-card__site">{campaign.site_name}</span>
                <div className="feedback-campaign-card__badges">
                  {campaign.is_default && <Badge tone="info">Default</Badge>}
                  <Badge tone={campaign.enabled ? 'accent' : 'quiet'}>{campaign.enabled ? 'Enabled' : 'Disabled'}</Badge>
                </div>
              </div>
              <div>
                <h2 className="feedback-campaign-card__name">{campaign.name}</h2>
                <code className="feedback-campaign-card__key">{campaign.key}</code>
              </div>
              <p className="feedback-campaign-card__question">{campaign.question}</p>
              <div className="feedback-campaign-card__details">
                <span>{answerTypeLabel(campaign.answer_type)}</span>
                <span>{recurrenceLabel(campaign.recurrence)}</span>
                <span>{campaign.allow_comment ? 'Comment enabled' : 'No comment'}</span>
              </div>
              <div className="feedback-campaign-card__stats">
                <div><strong>{campaign.response_count ?? 0}</strong><span>Responses</span></div>
                <div><strong>{campaign.shown_count ?? 0}</strong><span>Shown</span></div>
                <div><strong>{campaign.dismissed_count ?? 0}</strong><span>Closed</span></div>
                <div><strong>{campaign.skipped_count ?? 0}</strong><span>Skipped</span></div>
              </div>
              {user.role === 'admin' && (
                <div className="feedback-campaign-card__foot">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setCampaignModal({ siteId: campaign.site_id, campaignId: campaign.id })}
                  >
                    Edit campaign
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <FilterPanel title="Responses">
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
          headers={['Rating', 'Campaign', 'Comment', 'Session', 'User', 'Received', '', ...(user.role === 'admin' ? [''] : [])]}
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
              {/* The user id the host page passed to identify(); visitors it never identified are anonymous. */}
              <td className="feedback-user" title={f.user_id?.trim() || undefined}>
                {f.user_id?.trim() || <span className="muted">Anonymous</span>}
              </td>
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

      {campaignModal && (
        <FeedbackSettingsModal
          open
          onClose={() => setCampaignModal(null)}
          siteId={campaignModal.siteId}
          startCreating={campaignModal.creating}
          initialCampaignId={campaignModal.campaignId}
          onChanged={refreshCampaigns}
        />
      )}

      <Modal
        open={sitePickerOpen}
        onClose={() => setSitePickerOpen(false)}
        title="Choose a site"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setSitePickerOpen(false)}>Cancel</Button>
            <Button
              disabled={!newCampaignSite}
              onClick={() => {
                if (!newCampaignSite) return;
                setSitePickerOpen(false);
                setCampaignModal({ siteId: newCampaignSite, creating: true });
              }}
            >
              Continue
            </Button>
          </>
        )}
      >
        <p className="muted">Campaigns belong to one site. Choose where this campaign should appear.</p>
        <Select
          ariaLabel="Site for campaign"
          value={newCampaignSite ? String(newCampaignSite) : ''}
          onChange={(value) => setNewCampaignSite(Number(value))}
          options={(sites ?? []).map((site) => ({ value: String(site.id), label: site.name }))}
        />
      </Modal>

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
