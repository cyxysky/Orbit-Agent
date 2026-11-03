'use client';

import { useId } from 'react';
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, CodeXml, Database, Files, FileText, Globe2, Image, MapPin, MessageSquareText, Monitor, Plug, SquareTerminal, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
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

  return <section className="tool-capability-settings" aria-label={language === 'en' ? 'Tool capabilities' : '工具能力总览'}>
    <div className="tool-capability-summary">
      <div>
        <h3>{language === 'en' ? 'Tool switches' : '工具开关'}</h3>
        <p>{language === 'en'
          ? 'Enabled tools can be selected in each conversation. Turning a tool off removes it from the conversation tool list and from AI access.'
          : '启用的工具可在每个对话中单独选择；关闭后，该工具将从对话工具列表中移除，也不会提供给 AI。'}</p>
      </div>
      <span className="tool-capability-count">{enabledCount} / {toolCapabilitySettings.length} {t('已启用')}</span>
    </div>
    <div className="tool-capability-grid">
      {toolCapabilitySettings.map(tool => {
        const enabled = isToolCapabilityEnabled(tool.name, environment);
        const Icon = toolIcons[tool.name] || Plug;
        const target = configurationTargets[tool.name];
        const descriptionId = `${id}-${tool.name}-description`;
        return <article className={`tool-capability-card${enabled ? '' : ' is-disabled'}`} key={tool.name} data-setting-key={tool.envKey}>
          <div className="tool-capability-card-heading">
            <span className="tool-capability-icon"><Icon aria-hidden="true" size={20} /></span>
            <div className="tool-capability-copy"><strong>{t(tool.label)}</strong></div>
            <button type="button" role="switch" className={`settings-toggle${enabled ? ' on' : ''}`}
              aria-label={t(tool.label)} aria-checked={enabled} aria-describedby={descriptionId}
              disabled={disabled} onClick={() => onChange(tool.envKey, !enabled)}><span /></button>
          </div>
          <p className="tool-capability-description" id={descriptionId}>{t(tool.description)}</p>
          <footer className="tool-capability-card-footer">
            <span className="tool-capability-state">{enabled ? t('已启用') : t('已关闭')}</span>
            {target && onConfigure ? <button type="button" className="tool-capability-configure"
              aria-label={`${t('配置')} · ${t(tool.label)}`} onClick={() => onConfigure(target)}>
              {t('配置')}<ArrowUpRight aria-hidden="true" size={14} />
            </button> : null}
          </footer>
        </article>;
      })}
    </div>
  </section>;
}
