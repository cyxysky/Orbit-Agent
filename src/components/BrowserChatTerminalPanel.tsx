'use client';
import { useMemo, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import { TerminalWorkspace } from '@cjfclonedeep/capability-sdk/execution/terminal/react';
import { createHttpTerminalClient } from '@cjfclonedeep/capability-sdk/execution/terminal/client';
import { useI18n } from '@/i18n/I18nProvider';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
export function BrowserChatTerminalPanel({ sessionId, closed }: { sessionId: string; closed: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const client = useMemo(() => createHttpTerminalClient(withWebPilotBasePath('/api/browser-chat/' + encodeURIComponent(sessionId) + '/terminals')), [sessionId]);
  return <>
    <button type="button" className="browser-chat-conversation-direct-action" aria-label={t('终端管理')} aria-expanded={open} onClick={() => setOpen(true)}><SquareTerminal size={17} /><span>{t('终端')}</span></button>
    {open && <TerminalWorkspace client={client} closed={closed} translate={t} onClose={() => setOpen(false)} />}
  </>;
}
