'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@heroui/react/button';
import { Eye, EyeOff, Loader2, KeyRound } from 'lucide-react';
import { AppInput } from '@/components/ui/app-input';
import { OrbitIcon } from '@/components/OrbitIcon';
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler';
import { useWorkspaceBrand } from '@/brand/WorkspaceBrandProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { readApiJson } from '@/lib/api-client';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import styles from './AdministratorLogin.module.css';

export function AdministratorLogin({ nextPath }: { nextPath?: string }) {
  const { t } = useI18n(), { mode, setMode } = useTheme(), { brandPrefix, brandText } = useWorkspaceBrand();
  const [password, setPassword] = useState(''), [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(true), [configured, setConfigured] = useState(true);
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(withWebPilotBasePath('/api/auth/session'), { cache: 'no-store', signal: controller.signal })
      .then(response => readApiJson<{ configured: boolean; authenticated: boolean }>(response, t('无法连接登录服务，请重试。')))
      .then(data => { if (!controller.signal.aborted) { setConfigured(data.configured); if (data.authenticated) window.location.replace(withWebPilotBasePath('/browser-chat')); } })
      .catch(value => { if (!controller.signal.aborted) setError(value.message || t('无法连接登录服务，请重试。')); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [t]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || checking || !configured || !password) return;
    const controller = new AbortController(); request.current = controller;
    setSubmitting(true); setError('');
    try {
      const result = await readApiJson<{ redirectTo: string }>(await fetch(withWebPilotBasePath('/api/auth/login'), {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ password, next: nextPath }),
      }), t('登录失败，请重试。'));
      setPassword(''); window.location.replace(result.redirectTo);
    } catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : t('登录失败，请重试。')); }
    finally { if (!controller.signal.aborted) setSubmitting(false); }
  }
  return <main className={styles.page}>
    <header className={styles.header}><div className={styles.brand}><OrbitIcon size={20} /><span>{brandPrefix}{brandText}</span></div>
      <AnimatedThemeToggler theme={mode} onThemeChange={setMode} aria-label={t(mode === 'dark' ? '切换到浅色模式' : '切换到深色模式')} className="ui-icon-button" />
    </header>
    <div className={styles.center}><form className={styles.form} onSubmit={event => void submit(event)}>
      <h1>{t('管理员登录')}</h1>
      <label htmlFor="administrator-password">{t('管理员密码')}</label>
      <div className={styles.password}>
        <AppInput id="administrator-password" aria-label={t('管理员密码')} aria-invalid={Boolean(error)} aria-describedby="administrator-login-status"
          type={visible ? 'text' : 'password'} autoComplete="current-password" autoFocus required maxLength={4000} disabled={submitting || !configured}
          prefix={<KeyRound size={16} />} value={password} onChange={event => { setPassword(event.target.value); setError(''); }}
          suffix={<button className="ui-icon-button" type="button" aria-label={t(visible ? '隐藏密码' : '显示密码')} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>} />
      </div>
      <div id="administrator-login-status" className={styles.status} aria-live="polite">
        {error ? <p role="alert" className={styles.error}>{t(error)}</p> : !configured ? <p>{t('管理员登录未启用，请联系部署管理员。')}</p> : checking ? <p>{t('正在确认登录状态…')}</p> : null}
      </div>
      <Button type="submit" isDisabled={checking || submitting || !configured || !password} className={styles.submit}>{submitting ? <Loader2 className="spin" size={16} /> : null}{t(submitting ? '正在登录…' : '登录')}</Button>
    </form></div>
  </main>;
}
