'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, LogOut } from 'lucide-react';
import { useWorkspaceAccess } from '@/components/WorkspaceAccessProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { readApiJson } from '@/lib/api-client';

function loginUrl() { return withWebPilotBasePath('/login') + '?next=' + encodeURIComponent(window.location.pathname + window.location.search); }
export function AdministratorSessionGuard() {
  const { administratorAuthenticated, administratorExpiresAt } = useWorkspaceAccess();
  useEffect(() => {
    if (!administratorAuthenticated) return;
    const controller = new AbortController();
    let checking = false;
    const redirect = () => window.location.replace(loginUrl());
    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await fetch(withWebPilotBasePath('/api/auth/session'), { cache: 'no-store', signal: controller.signal });
        if (response.ok && !(await response.json()).authenticated) redirect();
      } catch { /* A network failure doesn't change the authenticated UI until a response confirms it. */ }
      finally { checking = false; }
    };
    const timer = administratorExpiresAt ? setTimeout(redirect, Math.max(0, administratorExpiresAt - Date.now())) : undefined;
    window.addEventListener('pageshow', check); window.addEventListener('focus', check);
    window.addEventListener('orbit:authentication-required', redirect);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('pageshow', check); window.removeEventListener('focus', check); window.removeEventListener('orbit:authentication-required', redirect); };
  }, [administratorAuthenticated, administratorExpiresAt]);
  return null;
}
export function AdministratorLogoutButton() {
  const { administratorAuthenticated } = useWorkspaceAccess();
  const { t } = useI18n();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  if (!administratorAuthenticated) return null;
  async function logout() {
    setPending(true); setError('');
    try {
      await readApiJson(await fetch(withWebPilotBasePath('/api/auth/logout'), { method: 'POST' }), t('退出登录失败，请重试。'));
      window.location.replace(withWebPilotBasePath('/login'));
    } catch (value) { setError(value instanceof Error ? value.message : t('退出登录失败，请重试。')); setPending(false); }
  }
  return <><button type="button" className="ui-icon-button" disabled={pending} aria-label={t('退出登录')} title={error || t('退出登录')} onClick={() => void logout()}>
    {pending ? <Loader2 size={16} className="spin" /> : error ? <AlertCircle size={16} /> : <LogOut size={16} />}
  </button>{error ? <span className="sr-only" role="alert">{error}</span> : null}</>;
}
