import Notice from '../../../../components/ui/Notice';
import { Icon } from '../../../../components/ui/Icon';
import { Field, Input, Select } from '../../../../components/ui/fields';
import Switch from '../../../../components/ui/Switch';
import WidgetPreview from '../../../../components/sites/WidgetPreview';
import { useWidgetIcon } from './hooks/useWidgetIcon';
import { announcementAccents } from '../../SiteDetail.types';
import { WidgetTabProps } from './WidgetTab.types';

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


  const isVerticalLauncher = (draft.widget_position || 'right').startsWith('middle-');
  return (
    <>
      <div className="hub-config__title">Widget</div>
      <div className="hub-config__row">
        <Switch
          checked={draft.widget_enabled ?? (!!draft.updates_enabled || !!draft.tickets_enabled || !!draft.feedback_enabled)}
          onChange={(v) => {
            onPatchDraft({ widget_enabled: v });
            if (!v) onOpenWidgetSettingsModal(null);
          }}
          label="Show the widget on this site"
        />
      </div>
      <div className="widget-sections">
        <div className="widget-section">
          <Switch
            checked={!!draft.updates_enabled}
            onChange={(v) => {
              onPatchDraft({ updates_enabled: v });
              if (!v && widgetSettingsModal === 'announcements') onOpenWidgetSettingsModal(null);
            }}
            label="Announcements"
          />
          {draft.updates_enabled && (
            <button
              className="icon-btn widget-section__settings"
              type="button"
              aria-label="Configure Announcements"
              title="Configure Announcements"
              onClick={() => onOpenWidgetSettingsModal('announcements')}
            >
              <Icon name="gear" size={15} />
            </button>
          )}
        </div>
        <div className="widget-section">
          <Switch
            checked={!!draft.feedback_enabled}
            onChange={(v) => {
              onPatchDraft({ feedback_enabled: v });
              if (!v && widgetSettingsModal === 'feedback') onOpenWidgetSettingsModal(null);
            }}
            label="Feedback"
          />
          {draft.feedback_enabled && (
            <button
              className="icon-btn widget-section__settings"
              type="button"
              aria-label="Configure Feedback"
              title="Configure Feedback"
              onClick={() => onOpenWidgetSettingsModal('feedback')}
            >
              <Icon name="gear" size={15} />
            </button>
          )}
        </div>
        <div className="widget-section">
          <Switch
            checked={!!draft.tickets_enabled}
            onChange={(v) => onPatchDraft({ tickets_enabled: v })}
            label="Tickets"
          />
        </div>
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
                value={widgetAppearance.accent}
                onChange={(e) => onPatchAnnouncementAppearance({ accent: e.target.value })}
              />
              <Input
                aria-label="Accent hex color"
                value={widgetAppearance.accent}
                maxLength={7}
                onChange={(e) => onPatchAnnouncementAppearance({ accent: e.target.value })}
              />
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
    </>
  );
}
