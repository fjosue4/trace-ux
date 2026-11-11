import { useEffect, useState } from 'react';
import Button from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/Icon';

const MAX_REPLY_CHARS = 4000;

type TicketComposerProps = {
  /** Clears the draft when the conversation changes or a reply lands. */
  resetKey: string;
  sending: boolean;
  onReply: (body: string, thenClose?: boolean) => Promise<void>;
};

/** The reply box for a ticket that is still open, with its two send actions. */
export function TicketComposer({ resetKey, sending, onReply }: TicketComposerProps) {
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setBody('');
    setError('');
  }, [resetKey]);

  async function submit(thenClose = false) {
    const value = body.trim();
    if (!value) {
      setError('Write a reply before sending.');
      return;
    }
    if (value.length > MAX_REPLY_CHARS) {
      setError(`Replies must be ${MAX_REPLY_CHARS.toLocaleString()} characters or fewer.`);
      return;
    }
    setError('');
    try {
      await onReply(value, thenClose);
    } catch {
      // The draft stays in the box so nothing typed is lost.
      setError('Could not send the reply. Try again.');
    }
  }

  return (
    <div className="ticket-reply">
      <textarea
        className="field-control"
        value={body}
        maxLength={MAX_REPLY_CHARS}
        onChange={(event) => setBody(event.currentTarget.value)}
        placeholder="Reply to the visitor…"
        aria-label="Reply to ticket"
        aria-invalid={error ? true : undefined}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit();
        }}
      />
      <div className="ticket-reply__bottom">
        <span className={error ? 'ticket-reply__error' : 'muted small'} role={error ? 'alert' : undefined}>
          {error || '⌘↵ to send'}
        </span>
        <Button size="sm" variant="secondary" onClick={() => void submit(true)} disabled={sending || !body.trim()}>
          Send and close
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={sending || !body.trim()}>
          {sending ? 'Sending…' : 'Send reply'}
          {!sending && <Icon name="send" size={12} />}
        </Button>
      </div>
    </div>
  );
}
