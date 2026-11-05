'use client';

import { useId } from 'react';
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, CodeXml, Database, Files, FileText, Globe2, Image, MapPin, MessageSquareText, Monitor, Plug, SquareTerminal, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { SettingsDetailSection } from '@/components/SettingsDetailSection';
import { SettingsFieldControl, useSettingsForms } from '@/components/SettingsFields';
import { isToolCapabilityEnabled, toolCapabilitySettings, toolConfigurationTargets } from '@/lib/tool-capability-settings';

const toolIcons: Record<string, LucideIcon> = {
  selfBootstrap: CodeXml,
  browser: Globe2, file: Files, chart: ChartNoAxesCombined, maps: MapPin,
  codeSandbox: CodeXml, connectors: Plug, knowledge: BookOpen, data: Database,
  media: Image, textEditor: FileText, communication: MessageSquareText, terminal: SquareTerminal, computer: Monitor,
};

export type ToolCapabilitySettingsProps = {
  items: readonly { key: string; value: string; enabled?: boolean }[];
  onChange: (key: string, enabled: boolean) => void;
  onConfigure?: (target: string) => void;
  disabled?: boolean;
};

export function ToolCapabilitySettings({ items, onChange, onConfigure, disabled = false }: ToolCapabilitySettingsProps) {
  const { t } = useI18n();
  const form = useSettingsForms()('tools.switches');
  const id = useId();
  const environment = Object.fromEntries(items.filter(item => item.enabled !== false).map(item => [item.key, item.value]));
  const enabledCount = toolCapabilitySettings.filter(tool => isToolCapabilityEnabled(tool.name, environment)).length;

  return <SettingsDetailSection
    className="tool-capability-settings"
    heading={t(form.title)}
    description={t(form.description)}
    meta={<>{enabledCount} / {toolCapabilitySettings.length} {t('已启用')}</>}
  >
    <div className="tool-capability-grid">
      {form.fields.map(field => {
        const tool = toolCapabilitySettings.find(tool => tool.envKey === field.key);
        if (!tool) return null;
        const enabled = isToolCapabilityEnabled(tool.name, environment);
        const Icon = toolIcons[tool.name] || Plug;
        const target = toolConfigurationTargets[tool.name];
        const descriptionId = `${id}-${tool.name}-description`;
        return <article className={`settings-row tool-capability-row${enabled ? '' : ' is-disabled'}`} key={tool.name} data-setting-key={tool.envKey}>
          <div>
            <strong className="tool-capability-title"><Icon aria-hidden="true" size={17} />{t(field.label)}</strong>
            <span id={descriptionId}>{t(field.description || '')}</span>
          </div>
          <div className="tool-capability-actions">
            {target && onConfigure ? <button type="button" className="ui-button tool-capability-configure"
              aria-label={`${t('配置')} · ${t(tool.label)}`} onClick={() => onConfigure(target)}>
              {t('配置')}<ArrowUpRight aria-hidden="true" size={14} />
            </button> : null}
            <SettingsFieldControl field={field} value={enabled} disabled={disabled} onChange={value => onChange(field.key, value === 'true')} />
          </div>
        </article>;
      })}
    </div>
  </SettingsDetailSection>;
}
