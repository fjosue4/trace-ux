import { useState } from 'react';
import { Site } from '../../api';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { Icon } from '../ui/Icon';
import './SnippetCard.css';

type Props = { site: Site; origin: string; onDismiss: () => void };

// Shown right after a site is created — the one thing the user must copy.
export default function SnippetCard({ site, origin, onDismiss }: Props) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script async src="${origin}/t.js" data-site="${site.site_key}"></script>`;

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className="snippet-card">
      <div className="row row--between">
        <h3>
          {site.name} is ready
        </h3>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <p className="muted small">
        Paste this snippet into the <code>{'<head>'}</code> of every page on your site:
      </p>
      <pre>{snippet}</pre>
      <Button variant="secondary" size="sm" onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />
        {copied ? 'Copied' : 'Copy snippet'}
      </Button>
    </Card>
  );
}
