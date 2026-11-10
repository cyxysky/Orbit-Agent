'use client';

import { Check, Loader2, X } from 'lucide-react';
import type { ManagedToolInstallProgress } from '@cjfclonedeep/capability-sdk/managed/node';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './ManagedToolSettings.module.css';

export function ToolInstallationProgress({ progress, message }: { progress: ManagedToolInstallProgress; message: string }) {
  const { t } = useI18n();
  const completed = progress.steps.filter(step => step.status === 'completed').length;
  return <section className={styles.installProgress} aria-label={t('安装进度')}>
    <div className={styles.sectionHeading}><h3>{t('安装进度')}</h3><span className={styles.state}>{t('已完成 {completed} / {total} 步', { completed, total: progress.steps.length })}</span></div>
    <ol className={styles.installSteps}>
      {progress.steps.map((step, index) => <li className={styles.installStep} data-state={step.status} aria-current={step.status === 'running' ? 'step' : undefined} key={step.id}>
        <span className={styles.installStepIcon} aria-hidden="true">{step.status === 'completed' ? <Check size={14} /> : step.status === 'running' ? <Loader2 className="spin" size={14} /> : step.status === 'failed' ? <X size={14} /> : index + 1}</span>
        <span>{t(step.label)}</span><small>{t(step.status === 'completed' ? '已完成' : step.status === 'failed' ? '失败' : step.status === 'running' ? '进行中' : '等待中')}</small>
      </li>)}
    </ol>
    <p className={styles.installMessage} role="status" aria-live="polite">{t(message)}</p>
  </section>;
}
