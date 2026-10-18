import { PerformanceEndpoint } from '../../../api';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { DetailMeta, DetailPane } from '../../../components/ui/DetailModal';
import { rangeLabels } from '../Performance.constants';
import { fmtLatency, fmtNumber } from '../Performance.helpers';
import { TimeRange } from '../Performance.types';
import { LatencyChart } from './LatencyChart';
import { MetricCard } from './MetricCard';

type EndpointDetailModalProps = {
  endpoint: PerformanceEndpoint | null;
  range: TimeRange;
  onClose: () => void;
};

export function EndpointDetailModal({ endpoint, range, onClose }: EndpointDetailModalProps) {
  return (
    <Modal
      open={endpoint !== null}
      onClose={onClose}
      title="Endpoint details"
      className="detail-modal performance-detail"
      footer={<Button variant="primary" size="sm" onClick={onClose}>Close</Button>}
    >
      {endpoint && (
        <>
          <h2 className="performance-detail__endpoint mono">{endpoint.endpoint}</h2>
          <DetailMeta items={[
            { label: 'Site', value: endpoint.site_name || `Site ${endpoint.site_id}`, title: endpoint.site_name },
            { label: 'Environment', value: endpoint.environment, title: endpoint.environment },
            { label: 'Service', value: endpoint.service, title: endpoint.service },
            { label: 'Version', value: endpoint.version, title: endpoint.version },
            { label: 'Time range', value: rangeLabels[range] },
          ]} />
          <div className="performance-metrics">
            <MetricCard label="Requests" value={fmtNumber(endpoint.requests)} detail={`${fmtNumber(endpoint.errors)} errors`} />
            <MetricCard label="p50" value={fmtLatency(endpoint.p50_ms)} detail="Typical request" />
            <MetricCard label="p95" value={fmtLatency(endpoint.p95_ms)} detail="Slow-tail latency" tone="warm" />
            <MetricCard label="p99" value={fmtLatency(endpoint.p99_ms)} detail="Worst-tail latency" tone="hot" />
            <MetricCard label="Error rate" value={`${endpoint.error_rate.toFixed(1)}%`} detail={`Average ${fmtLatency(endpoint.avg_ms)}`} tone={endpoint.error_rate > 0 ? 'hot' : ''} />
          </div>
          <DetailPane label="Latency over time">
            <LatencyChart endpoint={endpoint} range={range} />
          </DetailPane>
        </>
      )}
    </Modal>
  );
}
