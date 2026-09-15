import { Log, SiteDetail as SiteDetailData } from '../../../../api';

export type OverviewTabProps = {
  site: SiteDetailData['site'];
  sessions: SiteDetailData['sessions'];
  feedback: SiteDetailData['feedback'];
  stats: SiteDetailData['stats'];
  latestLogs: Log[];
};
