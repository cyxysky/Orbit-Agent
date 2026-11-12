'use client';

import { useId } from 'react';
import { BookOpen, Bot, ChartNoAxesCombined, CodeXml, Database, Files, FileText, Globe2, Image, MapPin, MessageSquareText, Monitor, Plug, Settings, SquareTerminal, type LucideIcon } from 'lucide-react';
import { Button } from '@heroui/react/button';
import { useI18n } from '@/i18n/I18nProvider';
import { SettingsDetailSection } from '@/components/SettingsDetailSection';
import { SortableSettingsList } from '@/components/SortableSettingsList';
import { useSettingsCatalog } from '@/components/useSettingsCatalog';
import { SettingsFieldControl, useSettingsForms } from '@/components/SettingsFields';
import { isToolCapabilityEnabled, toolCapabilitySettings } from '@/lib/tool-capability-settings';

const toolIcons: Record<string, LucideIcon> = {
  selfBootstrap: CodeXml,
  subagent: Bot,
  browser: Globe2, file: Files, chart: ChartNoAxesCombined, maps: MapPin,
  codeSandbox: CodeXml, connectors: Plug, knowledge: BookOpen, data: Database,
  media: Image, textEditor: FileText, communication: MessageSquareText, terminal: SquareTerminal, computer: Monitor,
};

export type ToolCapabilitySettingsProps = {
  items: readonly { key: string; value: string; enabled?: boolean }[];
  onChange: (key: string, enabled: boolean) => void;
  onConfigure?: (target: string) => void;
  disabled?: boolean;
  components?: readonly { id: string; state: string; enabled: boolean }[];
  busy?: ReadonlySet<string>;
};

export function ToolCapabilitySettings({ items, onChange, onConfigure, disabled = false, components = [], busy = new Set() }: ToolCapabilitySettingsProps) {
  const { t } = useI18n();
  const form = useSettingsForms()('tools.switches');
  const { permissions } = useSettingsCatalog();
  const id = useId();
  const environment = Object.fromEntries(items.filter(item => item.enabled !== false).map(item => [item.key, item.value]));
  const deploymentAllows = (name: string) => !permissions || (name === 'selfBootstrap' ? permissions.selfBootstrapEnabled : name === 'terminal' || name === 'computer' ? permissions.hostExecutionEnabled : true);
  const enabledFor = (name: string) => { const component = components.find(item => item.id === name); return deploymentAllows(name) && isToolCapabilityEnabled(name, environment) && (!component || component.state === 'ready' && component.enabled); };
  const enabledCount = toolCapabilitySettings.filter(tool => enabledFor(tool.name)).length;

  return <SettingsDetailSection
    className="tool-capability-settings"
    heading={t('工具列表')}
    description={t('统一管理工具的启用状态，点击齿轮配置。')}
    meta={<>{enabledCount} / {toolCapabilitySettings.length} {t('已启用')}</>}
  >
    <SortableSettingsList group="tools" className="tool-capability-grid" items={form.fields.filter(field => toolCapabilitySettings.some(tool => tool.envKey === field.key))}
      itemId={field => field.key} itemLabel={field => t(field.label)} renderItem={field => {
        const tool = toolCapabilitySettings.find(tool => tool.envKey === field.key);
        if (!tool) return null;
        const enabled = enabledFor(tool.name);
        const component = components.find(item => item.id === tool.name);
        const Icon = toolIcons[tool.name] || Plug;
        const descriptionId = `${id}-${tool.name}-description`;
        return <article className={`settings-row tool-capability-row${enabled ? '' : ' is-disabled'}`} key={tool.name} data-setting-key={tool.envKey}>
          <div>
            <strong className="tool-capability-title"><Icon aria-hidden="true" size={17} />{t(tool.label)}{component ? <small className="tool-capability-status">{t(component.state === 'ready' ? '已安装' : component.state === 'installing' ? '安装中' : component.state === 'failed' ? '安装失败' : component.state === 'cancelled' ? '已取消' : '未安装')}</small> : null}</strong>
            <span id={descriptionId}>{t(tool.description)}</span>
          </div>
          <div className="tool-capability-actions">
            <SettingsFieldControl field={field} value={enabled} disabled={disabled || !deploymentAllows(tool.name) || busy.has(tool.name) || Boolean(component && component.state !== 'ready')} onChange={value => onChange(field.key, value === 'true')} />
            {onConfigure ? <Button isIconOnly size="sm" variant="ghost" aria-label={`${t('配置')} · ${t(tool.label)}`} onPress={() => onConfigure(tool.name)}><Settings aria-hidden="true" size={17} /></Button> : null}
          </div>
        </article>;
      }} />
  </SettingsDetailSection>;
}
