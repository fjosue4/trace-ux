import { Ticket } from '../../../api';
import EmptyState from '../../../components/ui/EmptyState';
import Loading from '../../../components/ui/Loading';
import { Icon } from '../../../components/ui/Icon';
import { Input, Select } from '../../../components/ui/fields';
import { ticketViews } from '../Tickets.constants';
import { InboxSection, SiteSelection, TicketView } from '../Tickets.types';
import { TicketRow } from './TicketRow';

type TicketInboxProps = {
  /** null while the first load is in flight. */
  tickets: Ticket[] | null;
  sections: InboxSection[];
  counts: Record<TicketView, number>;
  view: TicketView;
  onViewChange: (view: TicketView) => void;
  query: string;
  onQueryChange: (query: string) => void;
  siteSel: SiteSelection;
  onSiteChange: (site: SiteSelection) => void;
  siteOptions: { value: string; label: string }[];
  selectedId: number | null;
  onOpen: (id: number) => void;
};

/** The ticket list: site and search, the status tabs, and the grouped rows. */
export function TicketInbox({
  tickets,
  sections,
  counts,
  view,
  onViewChange,
  query,
  onQueryChange,
  siteSel,
  onSiteChange,
  siteOptions,
  selectedId,
  onOpen,
}: TicketInboxProps) {
  const searching = query.trim() !== '';
  return (
    <>
      <div className="ticket-inbox__head">
        <h1>Tickets</h1>
        <Select
          className="ticket-inbox__site"
          ariaLabel="Site"
          value={String(siteSel)}
          onChange={(value) => onSiteChange(value === 'all' ? 'all' : Number(value))}
          options={siteOptions}
        />
      </div>
      <label className="ticket-inbox__search">
        <Icon name="search" size={14} />
        <span className="visually-hidden">Search tickets</span>
        <Input
          type="search"
          value={query}
          placeholder="Search subject or requester"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </label>
      <div className="ticket-tabs" role="tablist" aria-label="Ticket status">
        {ticketViews.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={!searching && view === tab.value}
            className={`ticket-tabs__tab${!searching && view === tab.value ? ' is-active' : ''}`}
            // Results span every tab while searching, so picking a tab ends the search.
            onClick={() => { onQueryChange(''); onViewChange(tab.value); }}
          >
            {tab.label}
            <span className="ticket-tabs__count">{counts[tab.value]}</span>
          </button>
        ))}
      </div>

      {tickets === null ? (
        <Loading />
      ) : sections.length === 0 ? (
        <EmptyState
          icon={<Icon name={searching ? 'search' : 'lifebuoy'} size={20} />}
          title={searching ? 'No tickets match your search' : emptyTitles[view]}
          description={searching ? 'Try a different subject, name, or email.' : emptyDescriptions[view]}
        />
      ) : (
        <div className="ticket-list">
          {sections.map((section) => (
            <section key={section.key} aria-label={section.title}>
              {section.title && (
                <h2 className={`ticket-list__title${section.tone === 'attention' ? ' is-attention' : ''}`}>
                  {section.title}
                  <span>{section.tickets.length}</span>
                </h2>
              )}
              {section.tickets.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  isSelected={selectedId === ticket.id}
                  showSite={siteSel === 'all'}
                  showStatus={searching || view === 'all' || ticket.status === 'in_progress' || ticket.status === 'under_review'}
                  onOpen={onOpen}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

const emptyTitles: Record<TicketView, string> = {
  open: 'No open tickets',
  closed: 'No closed tickets',
  archived: 'No archived tickets',
  all: 'No tickets yet',
};

const emptyDescriptions: Record<TicketView, string> = {
  open: 'New visitor conversations appear here as they arrive.',
  closed: 'Tickets you close are kept here.',
  archived: 'Archived tickets are kept here for the record.',
  all: 'Visitor conversations appear here once your support widget is enabled.',
};
