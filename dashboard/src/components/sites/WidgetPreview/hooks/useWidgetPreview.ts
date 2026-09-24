import type { CSSProperties } from 'react';
import { WidgetSection } from '../../../../api';
import { PreviewSection, WidgetPreviewProps } from '../WidgetPreview.types';

export function useWidgetPreview({ draft, launcherPlaceholder }: Pick<WidgetPreviewProps, 'draft' | 'launcherPlaceholder'>) {
  const configured = draft.updates_appearance ?? {};
  const legacy = draft.appearance ?? {};
  const theme = configured.theme ?? 'light';
  // endsWith, not equality: 'middle-left' is a left-side position too, and an
  // equality check silently previewed it on the right.
  const pos = draft.widget_position ?? 'right';
  const left = pos.endsWith('left');
  const middle = pos.startsWith('middle-');
  const accent = configured.accent || legacy.accent || legacy.primary || '#2f7d4a';
  const panelBg = configured.panel_bg || legacy.panel_bg || (theme === 'dark' ? '#121b16' : '#ffffff');
  const panelText = configured.panel_text || legacy.panel_text || (theme === 'dark' ? '#eef5f0' : '#142018');
  const buttonBg = configured.button_bg || legacy.button_bg || accent;
  const buttonText = configured.button_text || legacy.button_text || '#ffffff';
  const radius = configured.radius || legacy.radius || 18;
  const maxWidth = configured.max_width || 440;

  const defaultOrder: WidgetSection[] = ['updates', 'tickets', 'feedback'];
  const requestedOrder = [...(draft.widget_section_order ?? []), ...defaultOrder];
  const sectionOrder = requestedOrder.filter((id, index) => defaultOrder.includes(id) && requestedOrder.indexOf(id) === index);
  const available: Record<WidgetSection, { id: PreviewSection; label: string } | null> = {
    updates: draft.updates_enabled ? { id: 'updates', label: "What's new" } : null,
    tickets: draft.tickets_enabled ? { id: 'tickets', label: 'Support' } : null,
    feedback: draft.feedback_enabled ? { id: 'feedback', label: 'Feedback' } : null,
  };
  const sections = sectionOrder.map((id) => available[id]).filter(Boolean) as { id: PreviewSection; label: string }[];
  const shown = sections[0]?.id;
  const visible = draft.widget_enabled ?? sections.length > 0;
  const hidden = !visible || sections.length === 0;
  const label = configured.button_label || legacy.button_label || launcherPlaceholder;

  const style = {
    '--preview-accent': accent,
    '--preview-radius': `${radius}px`,
    '--preview-max-width': `${maxWidth}px`,
    '--preview-panel-bg': panelBg,
    '--preview-panel-text': panelText,
    '--preview-button-bg': buttonBg,
    '--preview-button-text': buttonText,
  } as CSSProperties;

  return { theme, left, middle, sections, shown, visible, hidden, label, style };
}
