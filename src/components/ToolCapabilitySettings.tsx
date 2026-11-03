'use client';

import { useId } from 'react';
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, CodeXml, Database, Files, FileText, Globe2, Image, MapPin, MessageSquareText, Monitor, Plug, SquareTerminal, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { SettingsDetailSection } from '@/components/SettingsDetailSection';
import { isToolCapabilityEnabled, toolCapabilitySettings } from '@/lib/tool-capability-settings';

const toolIcons: Record<string, LucideIcon> = {
  browser: Globe2, file: Files, chart: ChartNoAxesCombined, maps: MapPin,
  codeSandbox: CodeXml, connectors: Plug, knowledge: BookOpen, data: Database,
  media: Image, textEditor: FileText, communication: MessageSquareText, terminal: SquareTerminal, computer: Monitor,
};

const configurationTargets: Record<string, string> = {
  browser: 'capability:browser', file: '文件能力', maps: '地图', codeSandbox: '代码沙箱',
  connectors: 'integration:connector', knowledge: '知识库', data: 'integration:data',
  media: '媒体', communication: 'integration:communication', terminal: '本地终端', computer: '计算机',
};

export type ToolCapabilitySettingsProps = {
  items: readonly { key: string; value: string; enabled?: boolean }[];
  onChange: (key: string, enabled: boolean) => void;
  onConfigure?: (target: string) => void;
  disabled?: boolean;
};

export function ToolCapabilitySettings({ items, onChange, onConfigure, disabled = false }: ToolCapabilitySettingsProps) {
  const { t, language } = useI18n();
  const id = useId();
  const environment = Object.fromEntries(items.filter(item => item.enabled !== false).map(item => [item.key, item.value]));
  const enabledCount = toolCapabilitySettings.filter(tool => isToolCapabilityEnabled(tool.name, environment)).length;

  return <SettingsDetailSection
    className="tool-capability-settings"
    heading={language === 'en' ? 'Tool switches' : '工具开关'}
    description={language === 'en'
      ? 'Enabled tools can be selected in each conversation. Turning a tool off removes it from the conversation tool list and from AI access.'
      : '启用的工具可在每个对话中单独选择；关闭后，该工具将从对话工具列表中移除，也不会提供给 AI。'}
    meta={<>{enabledCount} / {toolCapabilitySettings.length} {t('已启用')}</>}
  >
    <div className="tool-capability-grid">
      {toolCapabilitySettings.map(tool => {
        const enabled = isToolCapabilityEnabled(tool.name, environment);
        const Icon = toolIcons[tool.name] || Plug;
        const target = configurationTargets[tool.name];
        const descriptionId = `${id}-${tool.name}-description`;
        return <article className={`settings-row tool-capability-row${enabled ? '' : ' is-disabled'}`} key={tool.name} data-setting-key={tool.envKey}>
          <div>
            <strong className="tool-capability-title"><Icon aria-hidden="true" size={17} />{t(tool.label)}</strong>
            <span id={descriptionId}>{t(tool.description)}</span>
          </div>
          <div className="tool-capability-actions">
            {target && onConfigure ? <button type="button" className="ui-button tool-capability-configure"
              aria-label={`${t('配置')} · ${t(tool.label)}`} onClick={() => onConfigure(target)}>
              {t('配置')}<ArrowUpRight aria-hidden="true" size={14} />
            </button> : null}
            <button type="button" role="switch" className={`settings-toggle${enabled ? ' on' : ''}`}
              aria-label={t(tool.label)} aria-checked={enabled} aria-describedby={descriptionId}
              disabled={disabled} onClick={() => onChange(tool.envKey, !enabled)}><span /></button>
          </div>
        </article>;
      })}
    </div>
  </SettingsDetailSection>;
}
