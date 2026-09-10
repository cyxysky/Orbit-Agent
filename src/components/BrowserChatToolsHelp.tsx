'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleHelp, X } from 'lucide-react';
import { FloatingLayer } from './FloatingLayer';
import { CopyTextButton } from './ui/copy-text-button';
import { useI18n } from '@/i18n/I18nProvider';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { normalizeDisabledBrowserChatTools, type BrowserChatToolHelp } from '@/lib/browser-chat-tools';

export function BrowserChatToolsHelp({ sessionId, disabledTools, onChange, busy }: {
  sessionId?: string; disabledTools: string[]; onChange: (names: string[]) => void; busy: boolean;
}) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<BrowserChatToolHelp[]>();
  const [query, setQuery] = useState('');
  const mounted = useRef(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const cancelClose = () => clearTimeout(timer.current);
  const show = () => { cancelClose(); setOpen(true); };
  const leave = () => {
    cancelClose(); timer.current = setTimeout(() => {
      if (!layer.current?.contains(document.activeElement) && document.activeElement !== anchor.current) setOpen(false);
    }, 180);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  useEffect(() => {
    if (!open || tools) return;
    const controller = new AbortController();
    void fetch(withWebPilotBasePath('/api/browser-chat/tools'), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.tools)) throw new Error(payload.error || '无法读取工具说明');
        setTools(payload.tools); setError('');
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [open, tools]);
  async function toggle(name: string) {
    const next = normalizeDisabledBrowserChatTools(disabledTools.includes(name) ? disabledTools.filter((item) => item !== name) : [...disabledTools, name]);
    setSaving(name); setError('');
    try {
      if (sessionId) {
        const response = await fetch(withWebPilotBasePath(`/api/browser-chat/${encodeURIComponent(sessionId)}/tools`), {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabledTools: next }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '无法保存工具设置');
      }
      if (mounted.current) onChange(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(''); }
  }
  const enabled = tools?.filter((tool) => tool.available && !disabledTools.includes(tool.name)).length || 0;
  return <>
    <button ref={anchor} type="button" className="browser-chat-tools-help-trigger" aria-label={t('工具说明与开关')}
      aria-haspopup="dialog" aria-expanded={open} onPointerEnter={show} onPointerLeave={leave}
      onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) show(); }} onBlur={leave} onClick={show}>
      <CircleHelp aria-hidden="true" size={17} />
    </button>
    <FloatingLayer anchorRef={anchor} layerRef={layer} className="ui-hover-card browser-chat-tools-card" present={open}
      onDismiss={() => setOpen(false)} placement="top" align="start" preferredWidth={470} maxHeight={600} role="dialog" ariaLabel={t('工具说明与开关')}
      onPointerEnter={cancelClose} onPointerLeave={leave}>
      <div className="browser-chat-tools-card-content" onFocusCapture={cancelClose} onBlurCapture={leave}>
        <div className="browser-chat-tools-card-controls">
        <header className="browser-chat-tools-card-header"><strong>{t('工具')}</strong><span>{enabled} / {tools?.length || 0} {t('已启用')}</span>
          <button type="button" aria-label={t('关闭')} onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        <p className="browser-chat-tools-card-hint">{t('开关保存到当前会话，对下一条消息生效。外部服务仍需完成配置。')}</p>
        <input aria-label={t('搜索工具')} placeholder={t('搜索工具')} value={query} onChange={(event) => setQuery(event.target.value)} className="browser-chat-tools-search" />
        {error && <p role="alert" className="browser-chat-tools-error">{t(error)}</p>}
        </div>
        <div className="browser-chat-tools-list">
          {!tools && !error && <p role="status">{t('正在加载工具…')}</p>}
          {tools?.filter((tool) => `${tool.label} ${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase())).map((tool) => (
            <article key={tool.name} className="browser-chat-tool-row">
              <div className="browser-chat-tool-row-heading"><strong>{t(tool.label)}</strong><code>{tool.name}</code>
                <button type="button" role="switch" aria-checked={tool.available && !disabledTools.includes(tool.name)}
                  aria-label={t(tool.label)} disabled={busy || Boolean(saving) || !tool.available} className="browser-chat-tool-switch"
                  onClick={() => void toggle(tool.name)}><span /></button>
              </div>
              <p>{t(tool.description)}</p>
              {!tool.available && <small>{t('当前模型连接方式不提供此工具')}</small>}
              <details>
                <summary>{t('试试这样问')}</summary>
                <ul className="browser-chat-tool-prompts">
                  {tool.prompts.map((prompt) => <li key={prompt}>
                    <span>{t(prompt)}</span>
                    <CopyTextButton text={t(prompt)} label={t('复制提示词')} className="browser-chat-tool-prompt-copy" />
                  </li>)}
                </ul>
              </details>
            </article>
          ))}
        </div>
      </div>
    </FloatingLayer>
  </>;
}
