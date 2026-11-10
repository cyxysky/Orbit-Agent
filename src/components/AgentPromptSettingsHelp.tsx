'use client';

import { useMemo, useState } from 'react';
import { Button } from '@heroui/react/button';
import { TextArea } from '@heroui/react/textarea';
import { agentPromptVariables, defaultAgentSystemPrompt, parseAgentPromptVariables, renderAgentPrompt } from '@/lib/agent-prompt-template';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './AgentPromptSettingsHelp.module.css';

export function AgentPromptSettingsHelp({ template, variables, onRestore }: {
  template: string; variables: string; onRestore: () => void;
}) {
  const { t } = useI18n();
  const [now] = useState(() => new Date().toISOString());
  const preview = useMemo(() => {
    try {
      return { text: renderAgentPrompt(template || defaultAgentSystemPrompt,
        Object.fromEntries(agentPromptVariables.map(([key, label]) => [key, key === 'time.iso' ? now : `【${t(label)}】`])),
        parseAgentPromptVariables(variables)), error: '' };
    } catch (error) { return { text: '', error: error instanceof Error ? error.message : String(error) }; }
  }, [template, variables, now, t]);
  return <div className={styles.help}>
    <div className={styles.heading}><h4>{t('模板预览')}</h4><Button size="sm" variant="secondary" onPress={onRestore}>{t('恢复默认模板')}</Button></div>
    <p>{t('这里使用示例值预览。真实对话会替换为当前身份、会话和实际可调用的工具；工具定义与后台权限仍然生效。')}</p>
    {preview.error ? <p role="alert" className={styles.error}>{preview.error}</p>
      : <TextArea aria-label={t('系统提示词预览')} className={styles.preview} readOnly value={preview.text} />}
    <h4>{t('可用变量')}</h4>
    <dl className={styles.variables}>{agentPromptVariables.map(([key, label]) => <div key={key}>
      <dt><Button size="sm" variant="ghost" onPress={() => void navigator.clipboard.writeText(`{{${key}}}`)}>{`{{${key}}}`}</Button></dt><dd>{t(label)}</dd>
    </div>)}</dl>
    <p>{t('自定义变量通过 {{vars.name}} 引用。变量值可以引用其他变量；不支持脚本、文件读取或任意环境变量。')}</p>
  </div>;
}
