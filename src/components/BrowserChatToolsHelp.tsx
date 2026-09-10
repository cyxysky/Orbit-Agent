'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleHelp, GripVertical, Search, X } from 'lucide-react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FloatingLayer } from './FloatingLayer';
import { CopyTextButton } from './ui/copy-text-button';
import { AppInput } from './ui/app-input';
import { useI18n } from '@/i18n/I18nProvider';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { normalizeDisabledBrowserChatTools, type BrowserChatToolHelp } from '@/lib/browser-chat-tools';
import { readBrowserChatToolPreferences, saveBrowserChatToolPreferences } from '@/lib/browser-chat-tool-preferences';

function SortableToolRow({ tool, enabled, disabled, onToggle }: {
  tool: BrowserChatToolHelp; enabled: boolean; disabled: boolean; onToggle: () => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: tool.name });
  return (
    <article ref={setNodeRef} className={`browser-chat-tool-row${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}>
      <div className="browser-chat-tool-row-heading">
        <button {...attributes} {...listeners} ref={setActivatorNodeRef} type="button"
          className="browser-chat-tool-drag-handle" aria-label={t('拖拽排序：{name}', { name: t(tool.label) })} title={t('拖拽排序')}>
          <GripVertical aria-hidden="true" size={16} />
          <strong>{t(tool.label)}</strong><code>{tool.name}</code>
        </button>
        <button type="button" role="switch" aria-checked={enabled} aria-label={t(tool.label)}
          disabled={disabled} className="browser-chat-tool-switch" onClick={onToggle}><span /></button>
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
  );
}

export function BrowserChatToolsHelp({ userId, sessionId, disabledTools, onChange, busy }: {
  userId: string; sessionId?: string; disabledTools: string[]; onChange: (names: string[]) => void; busy: boolean;
}) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinned = useRef(false);
  const savingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [dismissible, setDismissible] = useState(true);
  const [tools, setTools] = useState<BrowserChatToolHelp[]>();
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<string[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const mounted = useRef(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const cancelClose = () => clearTimeout(timer.current);
  const show = () => { cancelClose(); setOpen(true); };
  const close = () => { cancelClose(); pinned.current = false; setDismissible(true); setOpen(false); };
  const pin = () => { cancelClose(); pinned.current = true; };
  const keepOpenAfterDrag = () => { pin(); setDismissible(false); };
  const leave = () => {
    if (pinned.current) return;
    cancelClose(); timer.current = setTimeout(() => {
      if (!layer.current?.contains(document.activeElement) && document.activeElement !== anchor.current) setOpen(false);
    }, 180);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  useEffect(() => { setOrder(readBrowserChatToolPreferences(userId).order); }, [userId]);
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
    if (busy || savingRef.current) return;
    savingRef.current = true;
    pin();
    let next = normalizeDisabledBrowserChatTools(disabledTools.includes(name) ? disabledTools.filter((item) => item !== name) : [...disabledTools, name]);
    setSaving(name); setError('');
    try {
      if (sessionId) {
        const response = await fetch(withWebPilotBasePath(`/api/browser-chat/${encodeURIComponent(sessionId)}/tools`), {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabledTools: next }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '无法保存工具设置');
        next = normalizeDisabledBrowserChatTools(payload.disabledTools);
      }
      if (mounted.current) onChange(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { savingRef.current = false; if (mounted.current) setSaving(''); }
  }
  const orderedTools = [...(tools || [])].sort((a, b) => {
    const aIndex = order.indexOf(a.name);
    const bIndex = order.indexOf(b.name);
    return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex);
  });
  const visibleTools = orderedTools.filter((tool) => `${t(tool.label)} ${tool.name} ${t(tool.description)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const names = orderedTools.map((tool) => tool.name);
    const from = names.indexOf(String(active.id));
    const to = names.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(names, from, to);
    try {
      saveBrowserChatToolPreferences(userId, { order: next });
      setOrder(next);
      setError('');
    } catch { setError('无法保存工具顺序'); }
  };
  const enabled = tools?.filter((tool) => tool.available && !disabledTools.includes(tool.name)).length || 0;
  return <>
    <button ref={anchor} type="button" className="browser-chat-tools-help-trigger" aria-label={t('工具说明与开关')}
      aria-haspopup="dialog" aria-expanded={open} onPointerEnter={show} onPointerLeave={leave}
      onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) show(); }} onBlur={leave} onClick={() => { pin(); show(); }}>
      <CircleHelp aria-hidden="true" size={20} />
    </button>
    <FloatingLayer anchorRef={anchor} layerRef={layer} className="ui-hover-card browser-chat-tools-card" present={open}
      active={dismissible} onDismiss={close} dragHandleSelector=".browser-chat-tools-card-header" onDragStart={keepOpenAfterDrag}
      placement="top" align="start" preferredWidth={470} maxHeight={600} role="dialog" ariaLabel={t('工具说明与开关')}
      onPointerEnter={cancelClose} onPointerLeave={leave}>
      <div className="browser-chat-tools-card-content" onFocusCapture={cancelClose} onBlurCapture={leave}>
        <div className="browser-chat-tools-card-controls">
        <header className="browser-chat-tools-card-header"><strong>{t('工具')}</strong><span>{enabled} / {tools?.length || 0} {t('已启用')}</span>
          <button type="button" aria-label={t('关闭')} onClick={close}><X size={16} /></button>
        </header>
        <p className="browser-chat-tools-card-hint">{sessionId
          ? t('开关保存到当前会话，对下一条消息生效，并用于新对话。')
          : t('开关自动保存，并用于新对话。')}{' '}{t('拖动工具名称可排序。外部服务仍需完成配置。')}</p>
        <AppInput aria-label={t('搜索工具')} placeholder={t('搜索工具')} value={query}
          onChange={(event) => setQuery(event.target.value)} prefix={<Search aria-hidden="true" size={16} />} />
        {error && <p role="alert" className="browser-chat-tools-error">{t(error)}</p>}
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={keepOpenAfterDrag} onDragEnd={reorder}>
        <div className="browser-chat-tools-list">
          {!tools && !error && <p role="status">{t('正在加载工具…')}</p>}
          <SortableContext items={visibleTools.map((tool) => tool.name)} strategy={verticalListSortingStrategy}>
            {visibleTools.map((tool) => <SortableToolRow key={tool.name} tool={tool}
              enabled={tool.available && !disabledTools.includes(tool.name)} disabled={busy || Boolean(saving) || !tool.available}
              onToggle={() => void toggle(tool.name)} />)}
          </SortableContext>
          {tools && !visibleTools.length && <p role="status">{t('没有匹配的工具')}</p>}
        </div>
        </DndContext>
      </div>
    </FloatingLayer>
  </>;
}
