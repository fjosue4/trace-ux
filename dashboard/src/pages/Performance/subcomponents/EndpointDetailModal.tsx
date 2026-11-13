import { PerformanceEndpoint } from '../../../api';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { DetailMeta, DetailPane } from '../../../components/ui/DetailModal';
import { rangeLabels } from '../Performance.constants';
import StatStrip from '../../../components/ui/StatStrip';
import { TimeRange } from '../Performance.types';
import { LatencyChart } from './LatencyChart';
import { metricItems } from './MetricCard';

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
          <StatStrip items={metricItems(endpoint)} />
          <DetailPane label="Latency over time">
            <LatencyChart endpoint={endpoint} range={range} />
          </DetailPane>
        </>
      )}
    </Modal>
  );
}
