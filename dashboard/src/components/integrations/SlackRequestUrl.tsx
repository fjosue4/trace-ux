import { useState } from 'react';
import Button from '../ui/Button';
import { Field } from '../ui/fields';
import { Icon } from '../ui/Icon';
import './SlackRequestUrl.scss';

const SLACK_INTERACTION_PATH = '/api/integrations/slack/interactions';

export function SlackRequestUrl() {
  const [copied, setCopied] = useState(false);
  const requestUrl = `${window.location.origin}${SLACK_INTERACTION_PATH}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(requestUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Field
      label="Slack Request URL"
      hint="Paste this into Slack → Interactivity & Shortcuts. Use a public HTTPS origin when Slack cannot reach this browser address."
    >
      <div className="slack-request-url">
        <code className="slack-request-url__value">{requestUrl}</code>
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={13} />
          {copied ? 'Copied' : 'Copy URL'}
        </Button>
      </div>
    </Field>
  );
}
