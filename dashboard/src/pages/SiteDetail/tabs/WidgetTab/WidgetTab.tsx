import { useEffect, useRef, useState } from 'react';
import { motion, PanInfo } from 'motion/react';
import { WidgetSection } from '../../../../api';
import Button from '../../../../components/ui/Button';
import Modal from '../../../../components/ui/Modal';
import Notice from '../../../../components/ui/Notice';
import { Icon } from '../../../../components/ui/Icon';
import { Field, Input, Select } from '../../../../components/ui/fields';
import Switch from '../../../../components/ui/Switch';
import WidgetPreview from '../../../../components/sites/WidgetPreview';
import { useWidgetIcon } from './hooks/useWidgetIcon';
import { announcementAccents } from '../../SiteDetail.types';
import { WidgetTabProps } from './WidgetTab.types';

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(candidate) ? candidate.toLowerCase() : null;
}

function colorPickerValue(value: string) {
  const normalized = normalizeHexColor(value) ?? '#2f7d4a';
  if (normalized.length === 4) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  return normalized;
}

const defaultSectionOrder: WidgetSection[] = ['updates', 'tickets', 'feedback'];

function normalizedSectionOrder(value?: WidgetSection[]) {
  const requested = [...(value ?? []), ...defaultSectionOrder];
  return requested.filter((id, index) => defaultSectionOrder.includes(id) && requested.indexOf(id) === index);
}

export function WidgetTab({
  id,
  draft,
  detail,
  launcherPlaceholder,
  widgetSettingsModal,
  onOpenWidgetSettingsModal,
  onPatchDraft,
  onPatchAnnouncementAppearance,
  onPatchWidgetPosition,
  onDetailChanged,
}: WidgetTabProps) {
  const { iconBusy, iconError, uploadIcon, removeIcon } = useWidgetIcon(id, onDetailChanged);

  const widgetAppearance = {
    theme: draft.updates_appearance?.theme ?? 'light',
    accent: draft.updates_appearance?.accent || draft.appearance?.accent || draft.appearance?.primary || '#2f7d4a',
    radius: draft.updates_appearance?.radius || draft.appearance?.radius || 18,
    max_width: draft.updates_appearance?.max_width || 440,
    button_label: draft.updates_appearance?.button_label ?? draft.appearance?.button_label ?? '',
  };

  const [accentText, setAccentText] = useState(widgetAppearance.accent);
  const [accentError, setAccentError] = useState('');
  const [orderOpen, setOrderOpen] = useState(false);
  const sectionOrder = normalizedSectionOrder(draft.widget_section_order);

  useEffect(() => {
    setAccentText(widgetAppearance.accent);
    setAccentError('');
  }, [widgetAppearance.accent]);

  function commitAccentText() {
    const normalized = normalizeHexColor(accentText);
    if (!normalized) {
      setAccentError('Use 3 or 6 hexadecimal digits, for example #2f7d4a.');
      return;
    }
    setAccentText(normalized);
    setAccentError('');
    if (normalized !== widgetAppearance.accent) onPatchAnnouncementAppearance({ accent: normalized });
  }

  function setSectionOrder(order: WidgetSection[]) {
    onPatchDraft({ widget_section_order: order });
  }

  function moveSection(id: WidgetSection, offset: -1 | 1) {
    const from = sectionOrder.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= sectionOrder.length) return;
    const next = [...sectionOrder];
    [next[from], next[to]] = [next[to], next[from]];
    setSectionOrder(next);
  }

  const sectionControls: Record<WidgetSection, {
    label: string;
    checked: boolean;
    settings: 'announcements' | 'feedback' | null;
    onChange: (value: boolean) => void;
  }> = {
    updates: {
      label: 'Announcements',
      checked: !!draft.updates_enabled,
      settings: 'announcements',
      onChange: (value) => {
        onPatchDraft({ updates_enabled: value });
        if (!value && widgetSettingsModal === 'announcements') onOpenWidgetSettingsModal(null);
      },
    },
    tickets: {
      label: 'Tickets',
      checked: !!draft.tickets_enabled,
      settings: null,
      onChange: (value) => onPatchDraft({ tickets_enabled: value }),
    },
    feedback: {
      label: 'Feedback',
      checked: !!draft.feedback_enabled,
      settings: 'feedback',
      onChange: (value) => {
        onPatchDraft({ feedback_enabled: value });
        if (!value && widgetSettingsModal === 'feedback') onOpenWidgetSettingsModal(null);
      },
    },
  };
  const isVerticalLauncher = (draft.widget_position || 'right').startsWith('middle-');
  return (
    <>
      <div className="hub-config__title">Widget</div>
      <div className="hub-config__row widget-master-row">
        <Switch
          checked={draft.widget_enabled ?? (!!draft.updates_enabled || !!draft.tickets_enabled || !!draft.feedback_enabled)}
          onChange={(v) => {
            onPatchDraft({ widget_enabled: v });
            if (!v) onOpenWidgetSettingsModal(null);
          }}
          label="Show the widget on this site"
        />
        <Button variant="secondary" size="sm" onClick={() => setOrderOpen(true)}>
          <Icon name="settings" size={13} /> Customize order
        </Button>
      </div>
      <div className="widget-sections">
        {sectionOrder.map((id) => {
          const section = sectionControls[id];
          const settings = section.settings;
          return (
            <div className="widget-section" key={id}>
              <Switch checked={section.checked} onChange={section.onChange} label={section.label} />
              {section.checked && settings && (
                <button
                  className="icon-btn widget-section__settings"
                  type="button"
                  aria-label={`Configure ${section.label}`}
                  title={`Configure ${section.label}`}
                  onClick={() => onOpenWidgetSettingsModal(settings)}
                >
                  <Icon name="gear" size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Notice tone="info">
        One launcher, one panel. Each enabled section becomes a tab inside it. Use the gear beside a section to configure its settings.
      </Notice>
      <div className="announcement-customizer">
        <div className="announcement-customizer__controls">
          <h3>Choose a look</h3>
          <p className="muted small">Theme colors are paired automatically for accessible contrast.</p>
          <Field label="Theme">
            <div className="announcement-themes">
              {(['light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`announcement-theme${widgetAppearance.theme === theme ? ' is-selected' : ''}`}
                  aria-label={`Use ${theme} theme`}
                  onClick={() => onPatchAnnouncementAppearance({ theme })}
                >
                  <span className={`announcement-theme__sample is-${theme}`}><i /><i /></span>
                  <strong>{theme[0].toUpperCase() + theme.slice(1)}</strong>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Accent color">
            <div className="announcement-swatches">
              {announcementAccents.map((color) => (
                <button
                  type="button"
                  key={color}
                  aria-label={`Use ${color}`}
                  title={color}
                  className={widgetAppearance.accent === color ? 'is-selected' : ''}
                  style={{ background: color }}
                  onClick={() => onPatchAnnouncementAppearance({ accent: color })}
                />
              ))}
            </div>
            <div className="announcement-custom-color">
              <input
                type="color"
                aria-label="Custom accent color"
                value={colorPickerValue(widgetAppearance.accent)}
                onChange={(e) => {
                  setAccentText(e.target.value);
                  setAccentError('');
                  onPatchAnnouncementAppearance({ accent: e.target.value });
                }}
              />
              <Input
                aria-label="Accent hex color"
                value={accentText}
                maxLength={7}
                aria-invalid={accentError ? true : undefined}
                onChange={(e) => {
                  setAccentText(e.target.value);
                  setAccentError('');
                }}
                onBlur={commitAccentText}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
              {accentError && <span className="announcement-custom-color__error">{accentError}</span>}
            </div>
          </Field>
          <div className="hub-config__grid announcement-customizer__fields">
            <Field label="Corner radius" hint="6–40 px">
              <Input
                type="number"
                min={6}
                max={40}
                value={widgetAppearance.radius}
                onChange={(e) => onPatchAnnouncementAppearance({ radius: Number(e.target.value) })}
              />
            </Field>
            <Field
              label="Launcher label"
              hint={
                isVerticalLauncher
                  ? 'Stacked one letter per line — 8 characters max'
                  : 'Text on the button'
              }
            >
              <Input
                value={widgetAppearance.button_label}
                placeholder={launcherPlaceholder}
                // A mid-edge tab stacks its label vertically, so length is a
                // height. Capping the input makes the limit discoverable by
                // typing; otherwise the server silently substitutes a shorter
                // word and the operator sees a label they did not choose.
                maxLength={isVerticalLauncher ? 8 : 40}
                onChange={(e) => onPatchAnnouncementAppearance({ button_label: e.target.value })}
              />
            </Field>
            <Field label="Position" hint="Where the launcher sits">
              <Select
                value={draft.widget_position || 'right'}
                ariaLabel="Widget position"
                onChange={onPatchWidgetPosition}
                options={[
                  { value: 'right', label: 'Bottom right' },
                  { value: 'left', label: 'Bottom left' },
                  { value: 'middle-right', label: 'Middle right (vertical tab)' },
                  { value: 'middle-left', label: 'Middle left (vertical tab)' },
                ]}
              />
            </Field>
            <Field label="Maximum width" hint="300–560 px">
              <Input
                type="number"
                min={300}
                max={560}
                value={widgetAppearance.max_width}
                onChange={(e) => onPatchAnnouncementAppearance({ max_width: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Launcher icon" hint="PNG, JPEG or GIF · up to 256 KB · any size, rendered at 48×48">
            <div className="widget-icon">
              <div className="widget-icon__preview">
                {detail.widget_icon_url ? <img src={detail.widget_icon_url} alt="" /> : <Icon name="megaphone" size={18} />}
              </div>
              <div className="widget-icon__actions">
                <label className="widget-icon__pick">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif"
                    disabled={iconBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void uploadIcon(file);
                    }}
                  />
                  <span>{detail.widget_icon_url ? 'Replace image' : 'Upload image'}</span>
                </label>
                {detail.widget_icon_url && (
                  <button type="button" className="widget-icon__remove" disabled={iconBusy} onClick={() => void removeIcon()}>
                    Remove
                  </button>
                )}
                <p className="muted small">
                  {detail.widget_icon
                    ? `${detail.widget_icon.width}×${detail.widget_icon.height} ${detail.widget_icon.mime.replace('image/', '').toUpperCase()} · replaces the text label on the launcher`
                    : 'Without an icon the launcher shows the label above.'}
                </p>
              </div>
            </div>
            {iconError && <Notice tone="error">{iconError}</Notice>}
          </Field>
          <button
            className="announcement-reset"
            type="button"
            onClick={() => onPatchAnnouncementAppearance({ theme: 'light', button_label: '', accent: '#2f7d4a', radius: 18, max_width: 440 })}
          >
            <Icon name="x" size={13} /> Reset to defaults
          </button>
        </div>
        <WidgetPreview
          draft={draft}
          iconUrl={detail.widget_icon_url || undefined}
          launcherPlaceholder={launcherPlaceholder}
        />
      </div>
      <Modal
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
        title="Customize widget order"
        className="widget-order-modal"
        footer={<Button variant="secondary" onClick={() => setOrderOpen(false)}>Done</Button>}
      >
        <p className="muted small widget-order-modal__intro">
          Drag the sections into the order visitors should see. The first enabled section opens by default.
        </p>
        <WidgetOrderList
          order={sectionOrder}
          sections={sectionControls}
          onReorder={setSectionOrder}
          onMove={moveSection}
        />
      </Modal>
    </>
  );
}

// Sortable section list. The dragged row follows the pointer and the row it
// moves onto slides out of the way as soon as the drag is a quarter of the way
// into it, so the new order shows while dragging rather than on drop.
//
// Motion's Reorder only swaps once the dragged edge passes the neighbour's
// middle, which leaves the dragged row lying over half of it first. Here the
// target index is a pure function of the pointer position, with each boundary
// pulled toward where the drag started: early enough to read as a push, and
// stable, since crossing back over the same line is the only way to undo it.
const PUSH_AT = 0.25;
const orderSpring = { type: 'spring', stiffness: 620, damping: 42, mass: 0.7 } as const;

type OrderSession = { id: WidgetSection; origin: number; centers: number[]; push: number };

function orderTarget(y: number, session: OrderSession): number {
  const { centers, origin, push } = session;
  let index = origin;
  for (let j = origin; j < centers.length - 1 && y > centers[j] + push; j++) index = j + 1;
  for (let j = origin; j > 0 && y < centers[j] - push; j--) index = j - 1;
  return index;
}

function WidgetOrderList({
  order,
  sections,
  onReorder,
  onMove,
}: {
  order: WidgetSection[];
  sections: Record<WidgetSection, { label: string; checked: boolean }>;
  onReorder: (order: WidgetSection[]) => void;
  onMove: (id: WidgetSection, offset: -1 | 1) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<WidgetSection, HTMLDivElement>());
  const session = useRef<OrderSession | null>(null);
  const [dragging, setDragging] = useState<WidgetSection | null>(null);

  function start(id: WidgetSection) {
    // Slots are measured once, at rest, so rows sliding mid-drag never move
    // the boundaries the pointer is compared against.
    const centers = order.map((item) => {
      const rect = rowRefs.current.get(item)?.getBoundingClientRect();
      return rect ? rect.top + rect.height / 2 : 0;
    });
    const pitch = centers.length > 1 ? centers[1] - centers[0] : 0;
    session.current = { id, origin: order.indexOf(id), centers, push: pitch * PUSH_AT };
    setDragging(id);
  }

  function move(info: PanInfo) {
    const current = session.current;
    if (!current) return;
    const target = orderTarget(current.centers[current.origin] + info.offset.y, current);
    const from = order.indexOf(current.id);
    if (target === from) return;
    const next = order.filter((item) => item !== current.id);
    next.splice(target, 0, current.id);
    onReorder(next);
  }

  function end() {
    session.current = null;
    setDragging(null);
  }

  return (
    <div className="widget-order-list" ref={listRef}>
      {order.map((id, index) => {
        const { label, checked } = sections[id];
        return (
          <motion.div
            key={id}
            ref={(node: HTMLDivElement | null) => {
              if (node) rowRefs.current.set(id, node);
              else rowRefs.current.delete(id);
            }}
            layout="position"
            drag="y"
            dragConstraints={listRef}
            dragElastic={0.06}
            dragMomentum={false}
            dragSnapToOrigin
            transition={orderSpring}
            onDragStart={() => start(id)}
            onDrag={(_, info) => move(info)}
            onDragEnd={end}
            className={`widget-order-row${dragging === id ? ' is-dragging' : ''}`}
            style={{ position: 'relative', zIndex: dragging === id ? 2 : 0, boxShadow: '0 0 0 0 rgba(0, 0, 0, 0)' }}
            whileDrag={{ scale: 1.025, boxShadow: '0 18px 36px -14px rgba(0, 0, 0, 0.45)' }}
          >
            <span className="widget-order-row__handle" aria-hidden>
              <Icon name="grip" size={16} />
            </span>
            <strong className="widget-order-row__name">{label}</strong>
            <span className={`widget-order-row__status${checked ? ' is-on' : ''}`}>{checked ? 'On' : 'Off'}</span>
            <div className="widget-order-row__actions">
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${label} up`}
                disabled={index === 0}
                onClick={() => onMove(id, -1)}
              >
                <Icon name="chevronUp" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${label} down`}
                disabled={index === order.length - 1}
                onClick={() => onMove(id, 1)}
              >
                <Icon name="chevronDown" size={15} />
              </button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
