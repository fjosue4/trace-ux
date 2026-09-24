import { Link, useParams } from 'react-router-dom';
import { fmtTime } from '../../lib/format';
import { useUser } from '../../App';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Notice from '../../components/ui/Notice';
import Loading from '../../components/ui/Loading';
import Switch from '../../components/ui/Switch';
import { Icon } from '../../components/ui/Icon';
import AnnouncementSettingsModal from '../../components/sites/AnnouncementSettingsModal';
import FeedbackSettingsModal from '../../components/sites/FeedbackSettingsModal';
import { useSiteDetail } from './hooks/useSiteDetail';
import { OverviewTab } from './tabs/OverviewTab';
import { SiteTab } from './tabs/SiteTab';
import { RecordingsTab } from './tabs/RecordingsTab';
import { WidgetTab } from './tabs/WidgetTab';
import { LogsTab } from './tabs/LogsTab';
import { IntegrationsTab } from './tabs/IntegrationsTab';
import { ServicesTab } from './tabs/ServicesTab';
import { siteTabs } from './SiteDetail.types';
import './SiteDetail.scss';

// Site hub: recording toggle, overall feedback health, the latest recordings
// and feedback, and the widget/survey configuration — all managed here, all
// enforced server-side.
export default function SiteDetail() {
  const { siteId } = useParams();
  const { user } = useUser();
  const isAdmin = user.role === 'admin';
  const id = Number(siteId);
  const {
    detail,
    error,
    draft,
    saving,
    saved,
    frequentErrors,
    frequentErrorsFromMs,
    activeTab,
    setActiveTab,
    widgetSettingsModal,
    setWidgetSettingsModal,
    launcherPlaceholder,
    refreshDetail,
    load,
    toggleRecording,
    saveSettings,
    patchDraft,
    patchQuestion,
    patchAnnouncementAppearance,
    patchWidgetPosition,
    patchTrigger,
  } = useSiteDetail(id);

  if (error) {
    return (
      <main className="page">
        <Notice tone="error">{error}</Notice>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="page">
        <Loading />
      </main>
    );
  }

  const { site } = detail;
  const recordingOn = site.recording_enabled ?? true;
  const trigger = draft?.feedback_trigger ?? { mode: 'always' as const };

  return (
    <main className="page">
      <PageHeader
        title={site.name}
        subtitle={`Site key ${site.site_key} · tracking since ${fmtTime(site.created_at)}`}
        actions={
          <>
            {isAdmin && (
              <Switch
                checked={recordingOn}
                onChange={toggleRecording}
                label={recordingOn ? 'Recording on' : 'Recording off'}
              />
            )}
            <Link to={`/sessions?site=${site.id}`} className="btn btn--secondary btn--sm">
              <Icon name="film" size={13} />
              All sessions
            </Link>
          </>
        }
      />

      {!recordingOn && (
        <Notice tone="info">
          Recording is <strong>off</strong> for this site — visitors' sessions are not captured,
          but the feedback section keeps working.
        </Notice>
      )}

      <nav className="site-tabs" aria-label="Site management sections">
        {siteTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`site-tab${activeTab === tab.id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <Icon name={tab.icon} size={14} />
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'site' && (
        <SiteTab id={id} site={site} isAdmin={isAdmin} onDetailChanged={refreshDetail} />
      )}

      {activeTab === 'overview' && (
        <OverviewTab
          site={site}
          sessions={detail.sessions}
          feedback={detail.feedback}
          stats={detail.stats}
          frequentErrors={frequentErrors}
          frequentErrorsFromMs={frequentErrorsFromMs}
        />
      )}

      {activeTab === 'integrations' && <IntegrationsTab siteId={id} isAdmin={isAdmin} />}

      {activeTab === 'services' && (
        <ServicesTab
          siteId={id}
          isAdmin={isAdmin}
          legacyPerformanceKeys={detail.performance_keys}
          siteSeverities={(draft?.logs.severities ?? [draft?.logs.minimum_severity ?? 'error']).filter(Boolean)}
        />
      )}

      {isAdmin && draft && activeTab !== 'overview' && activeTab !== 'site' && activeTab !== 'services' && activeTab !== 'integrations' && (
        <Card className="hub-config">
          <h2>Manage {activeTab}</h2>
          <p className="muted small">
            Served to the tracker automatically — the snippet never carries these settings.
          </p>

          {activeTab === 'recordings' && <RecordingsTab draft={draft} onPatchDraft={patchDraft} />}

          {activeTab === 'logs' && <LogsTab draft={draft} onPatchDraft={patchDraft} />}

          {activeTab === 'widget' && (
            <WidgetTab
              id={id}
              draft={draft}
              detail={detail}
              launcherPlaceholder={launcherPlaceholder}
              widgetSettingsModal={widgetSettingsModal}
              onOpenWidgetSettingsModal={setWidgetSettingsModal}
              onPatchDraft={patchDraft}
              onPatchAnnouncementAppearance={patchAnnouncementAppearance}
              onPatchWidgetPosition={patchWidgetPosition}
              onDetailChanged={refreshDetail}
            />
          )}

          {saved && <Notice tone="success">Configuration saved — live for new visitors immediately.</Notice>}

          <div className="hub-config__save">
            <Button onClick={saveSettings} disabled={saving}>
              {saving ? 'Saving…' : 'Save configuration'}
            </Button>
          </div>
        </Card>
      )}

      {isAdmin && draft && (
        <>
          <AnnouncementSettingsModal
            open={widgetSettingsModal === 'announcements'}
            onClose={() => setWidgetSettingsModal(null)}
          />
          <FeedbackSettingsModal
            open={widgetSettingsModal === 'feedback'}
            onClose={() => setWidgetSettingsModal(null)}
            draft={draft}
            trigger={trigger}
            onPatchDraft={patchDraft}
            onPatchTrigger={patchTrigger}
            onPatchQuestion={patchQuestion}
          />
        </>
      )}

      {!isAdmin && activeTab !== 'overview' && activeTab !== 'site' && activeTab !== 'services' && activeTab !== 'integrations' && (
        <Card className="hub-config card--static">
          <h2>Manage {activeTab}</h2>
          <Notice tone="info">Only administrators can change this site's configuration.</Notice>
        </Card>
      )}
    </main>
  );
}
