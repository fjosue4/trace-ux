/** Linkify plain messages without interpreting visitor-supplied HTML. */
export function appendLinkedText(node: HTMLElement, text: string): void {
  const links = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = links.exec(text)) !== null) {
    const start = match.index;
    let label = match[0].replace(/[.,!?;:]+$/, '');
    // Keep balanced parentheses in URLs, but leave sentence punctuation outside.
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    while (label) {
      const last = label[label.length - 1];
      const opener = pairs[last];
      if (!opener || label.split(last).length <= label.split(opener).length) break;
      label = label.slice(0, -1).replace(/[.,!?;:]+$/, '');
    }
    node.appendChild(document.createTextNode(text.slice(offset, start)));
    try {
      const url = new URL(/^www\./i.test(label) ? `https://${label}` : label);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported URL');
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = label;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      node.appendChild(link);
    } catch {
      node.appendChild(document.createTextNode(label));
    }
    offset = start + label.length;
  }
  node.appendChild(document.createTextNode(text.slice(offset)));
}
