import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/fields';
import { statusOptions } from '../Tickets.constants';
import { SiteSelection, StatusSelection } from '../Tickets.types';

type TicketFiltersModalProps = {
  open: boolean;
  onClose: () => void;
  siteSel: SiteSelection;
  setSiteSel: (value: SiteSelection) => void;
  statusSel: StatusSelection;
  setStatusSel: (value: StatusSelection) => void;
  siteOptions: { value: string; label: string }[];
};

export function TicketFiltersModal({ open, onClose, siteSel, setSiteSel, statusSel, setStatusSel, siteOptions }: TicketFiltersModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Filter tickets"
      footer={
        <>
          <Button variant="secondary" onClick={() => { setSiteSel('all'); setStatusSel('all'); }}>
            Clear filters
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span className="field-label">Site</span>
          <Select
            ariaLabel="Site"
            value={String(siteSel)}
            onChange={(value) => setSiteSel(value === 'all' ? 'all' : Number(value))}
            options={siteOptions}
          />
        </label>
        <label className="field">
          <span className="field-label">Status</span>
          <Select ariaLabel="Status" value={statusSel} onChange={(value) => setStatusSel(value as StatusSelection)} options={statusOptions} />
        </label>
      </div>
    </Modal>
  );
}
