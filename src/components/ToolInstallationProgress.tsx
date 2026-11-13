'use client';

import { Button } from '@heroui/react/button';
import { ArrowDownToLine, Check, Loader2, Pause, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ManagedToolStatus } from '@cjfclonedeep/capability-sdk/managed/node';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './ManagedToolSettings.module.css';

export function ToolInstallationProgress({ tool }: { tool: ManagedToolStatus }) {
  const { t } = useI18n();
  const [, tick] = useState(0);
  const log = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const progress = tool.progress!;
  useEffect(() => {
    if (tool.state !== 'installing') return;
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') tick(value => value + 1); }, 1000);
    return () => clearInterval(timer);
  }, [tool.state]);
  useLayoutEffect(() => {
    if (log.current && follow.current) log.current.scrollTop = log.current.scrollHeight;
  }, [tool.logs]);
  const end = tool.finishedAt ? Date.parse(tool.finishedAt) : Date.now();
  const elapsed = Math.max(0, Math.floor((end - Date.parse(tool.startedAt || progress.startedAt)) / 1000));
  const quiet = tool.state === 'installing' && Date.now() - Date.parse(tool.lastActivityAt || tool.startedAt || progress.startedAt) > 60000;
  const completed = progress.steps.filter(step => step.status === 'completed').length;
  return <section className={styles.installProgress} aria-label={t('安装进度')}>
    <div className={styles.installSummary}>
      <div className={styles.sectionHeading}><h3>{t('安装进度')}</h3><span className={styles.state}>{t('已完成 {completed} / {total} 步', { completed, total: progress.steps.length })}</span></div>
      <div className={styles.installMetadata}><p className={styles.installMessage} role="status" aria-live="polite">{t(tool.message)}</p><span>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span></div>
    </div>
    <div className={styles.installWorkspace}>
    <ol className={styles.installSteps}>
      {progress.steps.map((step, index) => <li className={styles.installStep} data-state={step.status} aria-current={step.status === 'running' ? 'step' : undefined} key={step.id}>
        <span className={styles.installStepIcon} aria-hidden="true">{step.status === 'completed' ? <Check size={14} /> : step.status === 'running' ? <Loader2 className="spin" size={14} /> : ['failed', 'cancelled'].includes(step.status) ? <X size={14} /> : index + 1}</span>
        <span className={styles.installStepCopy}><span>{t(step.label)}</span><small>{t(step.status === 'completed' ? '已完成' : step.status === 'failed' ? '失败' : step.status === 'cancelled' ? '已取消' : step.status === 'running' ? '进行中' : '等待中')}</small></span>
      </li>)}
    </ol>
    <div className={styles.installLogSection}>
      <div className={styles.sectionHeading}><h3>{t('安装日志')}</h3><Button size="sm" variant="ghost" aria-pressed={following} onPress={() => { follow.current = !follow.current; setFollowing(follow.current); if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight; }}>{following ? <Pause size={13} /> : <ArrowDownToLine size={13} />}{t(following ? '暂停跟随' : '跟随最新')}</Button></div>
      <pre ref={log} className={styles.installLog} tabIndex={0} aria-label={t('安装日志')} onWheel={event => { if (event.deltaY < 0) { follow.current = false; setFollowing(false); } }} onScroll={event => {
        const element = event.currentTarget;
        const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 4;
        if (follow.current && !atEnd) { follow.current = false; setFollowing(false); }
      }}>{tool.logs || t('等待安装器输出…')}</pre>
    </div>
    </div>
    {tool.download ? <div className={styles.installDownload}>
      <progress aria-label={t('下载进度')} max={tool.download.totalBytes || undefined} value={tool.download.totalBytes ? tool.download.receivedBytes : undefined} />
      <span>{(tool.download.receivedBytes / 1048576).toFixed(1)} MB{tool.download.totalBytes ? ' / ' + (tool.download.totalBytes / 1048576).toFixed(1) + ' MB' : ''}</span>
    </div> : null}
    {quiet ? <p className={styles.installMessage} role="status">{t('暂未收到新输出，安装仍在运行；可查看日志或取消后重试。')}</p> : null}
  </section>;
}
