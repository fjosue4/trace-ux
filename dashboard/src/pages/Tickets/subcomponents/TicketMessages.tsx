import { useLayoutEffect, useMemo, useRef } from 'react';
import { Ticket, TicketMessage } from '../../../api';
import { clockTime, messageDays } from '../Tickets.helpers';

type TicketMessagesProps = { ticket: Ticket; messages: TicketMessage[] };

/** The conversation: messages by day, grouped by author, newest in view. */
export function TicketMessages({ ticket, messages }: TicketMessagesProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => messageDays(messages, ticket), [messages, ticket]);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [ticket.id, messages.length]);

  return (
    <div ref={paneRef} className="ticket-messages">
      {days.map((day) => (
        <div key={day.key} className="ticket-day">
          <div className="ticket-day__label" role="separator">
            <span>{day.label}</span>
          </div>
          {day.groups.map((group) => (
            <div key={group.key} className={`ticket-group ticket-group--${group.author}`}>
              <div className="ticket-group__meta">
                <strong title={group.name}>{group.name}</strong>
                <span>{clockTime(group.at)}</span>
              </div>
              {group.messages.map((message) => (
                <p key={message.id} className="ticket-bubble" title={clockTime(message.created_at)}>
                  {message.body}
                </p>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
