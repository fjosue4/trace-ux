import { useNavigate } from 'react-router-dom';
import { AnalyzeScope } from '../../api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import FilterPanel from '../../components/ui/FilterPanel';
import Loading from '../../components/ui/Loading';
import Notice from '../../components/ui/Notice';
import { Icon } from '../../components/ui/Icon';
import { Select } from '../../components/ui/fields';
import { SCOPES } from './Analyze.constants';
import { useAnalyzeLibrary } from './hooks/useAnalyzeLibrary';
import { ReportCard } from './subcomponents/ReportCard';
import { Segmented } from './subcomponents/Segmented';
import './Analyze.scss';

export default function Analyze() {
  const navigate = useNavigate();
  const {
    scope,
    siteSel,
    sourceSel,
    setFilter,
    siteOptions,
    reports,
    summaries,
    error,
    filtered,
    pendingDelete,
    setPendingDelete,
    confirmDelete,
    duplicate,
    busy,
  } = useAnalyzeLibrary();

  async function onDuplicate(report: Parameters<typeof duplicate>[0]) {
    const copy = await duplicate(report);
    if (copy) navigate(`/analyze/${copy.id}/edit`);
  }

  return (
    <main className="page analyze-page">
      <PageHeader
        title="Analyze"
        subtitle="Saved reports that count tracked actions and logs, day by day."
        actions={<Button onClick={() => navigate('/analyze/new')}><Icon name="plus" size={14} />New report</Button>}
      />

      <FilterPanel
        title="Reports"
        actions={
          <Segmented<AnalyzeScope>
            ariaLabel="Show reports"
            value={scope}
            onChange={(value) => setFilter('scope', value)}
            options={SCOPES}
          />
        }
      >
        <Select ariaLabel="Site" value={String(siteSel)} onChange={(value) => setFilter('site', value)} options={siteOptions} />
        <Select
          ariaLabel="Source"
          value={sourceSel}
          onChange={(value) => setFilter('source', value)}
          options={[
            { value: 'all', label: 'All sources' },
            { value: 'event', label: 'Actions' },
            { value: 'log', label: 'Logs' },
          ]}
        />
      </FilterPanel>

      {error && <Notice tone="error">{error}</Notice>}

      {reports === null ? (
        <Loading />
      ) : reports.length === 0 ? (
        <Card className="card--static">
          {filtered ? (
            <EmptyState
              icon={<Icon name="filter" size={20} />}
              title="No reports match these filters"
              description={scope === 'mine' ? 'You have not saved a report with these filters yet.' : 'Try another site, source, or view.'}
            />
          ) : (
            <EmptyState
              icon={<Icon name="chart" size={20} />}
              title="No saved reports yet"
              description="A report counts one tracked action, or the logs matching a message, over time. Save it once, and it stays current every time you open it."
              action={<Button onClick={() => navigate('/analyze/new')}>Create a report</Button>}
            />
          )}
        </Card>
      ) : (
        <div className="analyze-grid">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              summary={summaries[`${report.id}:${report.updated_at}`]}
              busy={busy}
              onDuplicate={onDuplicate}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this report?"
        description={
          pendingDelete?.visibility === 'team'
            ? `“${pendingDelete.name}” is shared with your team. Deleting it removes it for everyone. The data it counts is not affected.`
            : 'This removes the saved report. The data it counts is not affected.'
        }
        confirmLabel="Delete report"
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </main>
  );
}
