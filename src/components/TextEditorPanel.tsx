'use client';

import { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { Check, Copy, Download, FileText, GripVertical, LoaderCircle, Plus, RefreshCw, Save, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { TextDocument, TextDocumentSummary, TextDraft, TextEditProposal, TextEditorResponse, TextSelection } from '@/lib/text-editor';
import { textFileExtension, textFormatFromFile, textPreviewHtml } from '@/lib/text-editor';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { CreativeButton } from './ui/creative-button';
import { TextArea } from '@heroui/react/textarea';
import { Tabs, TabList, Tab } from 'react-aria-components';
import { CreativeEditorLoading } from './CreativeEditorLoading';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { MonacoTextEditor, type MonacoTextEditorHandle } from './MonacoTextEditor';

const MarkdownDocumentPreview = lazy(() => import('./MarkdownDocumentPreview'));


export type TextEditorHandle = { flush(): Promise<void> };
type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Bounds = { left: number; right: number; top: number; bottom: number };
function clampOverlay(point: Point, size: Size, area: Size): Point {
  return { x: Math.max(12, Math.min(point.x, area.width - size.width - 12)), y: Math.max(12, Math.min(point.y, area.height - size.height - 12)) };
}
function placeOverlay(bounds: Bounds, size: Size, area: Size): Point {
  const points = [{ x: bounds.left, y: bounds.bottom + 8 }, { x: bounds.left, y: bounds.top - size.height - 8 },
    { x: bounds.right + 8, y: bounds.top }, { x: bounds.left - size.width - 8, y: bounds.top }].map(point => clampOverlay(point, size, area));
  const overlap = (point: Point) => Math.max(0, Math.min(point.x + size.width, bounds.right) - Math.max(point.x, bounds.left))
    * Math.max(0, Math.min(point.y + size.height, bounds.bottom) - Math.max(point.y, bounds.top));
  return points.reduce((best, point) => overlap(point) < overlap(best) ? point : best);
}
async function requestText(body: unknown, signal?: AbortSignal): Promise<TextEditorResponse> {
  const requestSignal = (body as { action?: string })?.action === 'rewrite' ? signal : AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  const response = await fetch(withWebPilotBasePath('/api/text-documents/workspace'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: requestSignal });
  const result = await response.json(); if (!response.ok) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, result.error || '文本操作失败'); return result;
}
const asDraft = (document: TextDocument): TextDraft => ({ title: document.title, format: document.format, content: document.content });
const sameDraft = (a?: TextDraft, b?: TextDraft) => a === b || !!a && !!b && a.title === b.title && a.format === b.format && a.content === b.content;
const summary = ({ content, ...document }: TextDocument): TextDocumentSummary => ({ ...document, contentChars: content.length });
function updateDocumentList(items: TextDocumentSummary[], document: TextDocument) {
  const next = summary(document);
  return items.some(item => item.id === next.id) ? items.map(item => item.id === next.id ? next : item) : [next, ...items];
}
const formats = [{ value: 'text', label: '纯文本' }, { value: 'markdown', label: 'Markdown' }, { value: 'html', label: 'HTML' }];

export function TextEditorPanel({ documentId, importSourceUrl, fileName, handleRef }: {
  documentId?: string; importSourceUrl?: string; fileName?: string; handleRef?: Ref<TextEditorHandle>;
}) {
  const [documents, setDocuments] = useState<TextDocumentSummary[]>([]), [document, setDocument] = useState<TextDocument>();
  const [draft, setDraft] = useState<TextDraft>(), [mode, setMode] = useState<'read' | 'edit'>('edit');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [working, setWorking] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [instruction, setInstruction] = useState('');
  const [selection, setSelection] = useState<TextSelection>(), [wholeDocument, setWholeDocument] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false), [selectionBounds, setSelectionBounds] = useState<Bounds>();
  const [point, setPoint] = useState<Point>({ x: 12, y: 12 }), [area, setArea] = useState<Size>({ width: 800, height: 600 });
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [proposal, setProposal] = useState<TextEditProposal>();
  const workspace = useRef<HTMLDivElement>(null), card = useRef<HTMLDivElement>(null), source = useRef<MonacoTextEditorHandle>(null), importFile = useRef<HTMLInputElement>(null);
  const current = useRef(document), currentDraft = useRef(draft), saved = useRef<TextDraft>(undefined);
  const pendingSave = useRef<Promise<void>>(undefined), pendingOperation = useRef<AbortController>(undefined), initialImport = useRef<Promise<TextEditorResponse>>(undefined);
  const alive = useRef(true), composing = useRef(false), moved = useRef(false);
  const gesture = useRef<{ pointerId: number; x: number; y: number; point: Point; scaleX: number; scaleY: number }>(undefined);
  const sidebarGesture = useRef<{ pointerId: number; x: number; width: number; scale: number }>(undefined);
  const minimumSidebar = area.width < 500 ? 104 : 140, maximumSidebar = Math.max(minimumSidebar, Math.min(420, area.width - Math.min(320, Math.max(240, area.width * .55)) - 7));
  const effectiveSidebar = Math.round(Math.max(minimumSidebar, Math.min(maximumSidebar, sidebarWidth)));
  const dirty = !sameDraft(draft, saved.current), disabled = loading || working;
  const showError = useCallback((reason: unknown) => { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }, []);
  const accept = useCallback((result: TextEditorResponse) => {
    if (!result.document) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, '未返回文本内容');
    const next = result.document; current.current = next; currentDraft.current = asDraft(next); saved.current = asDraft(next);
    setDocument(next); setDraft(asDraft(next)); setSelection(undefined); setSelectionOpen(false); setProposal(undefined);
    setDocuments(items => updateDocumentList(items, next));
  }, []);
  const save = useCallback(async () => {
    await source.current?.flush();
    if (pendingSave.current) return pendingSave.current;
    const operation = async () => {
      if (alive.current) setSaving(true);
      try {
        while (!composing.current && current.current && currentDraft.current && !sameDraft(currentDraft.current, saved.current)) {
          const before = currentDraft.current, snapshot = { ...before, title: before.title.trim() || '未命名文档' }, id = current.current.id;
          const result = await requestText({ action: 'save', documentId: id, document: snapshot, expected: saved.current });
          if (!result.document) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, '未返回已保存文本');
          current.current = result.document; saved.current = asDraft(result.document);
          if (alive.current) { setDocument(result.document); setDocuments(items => updateDocumentList(items, result.document!)); setError(''); }
          if (sameDraft(currentDraft.current, before)) { currentDraft.current = asDraft(result.document); if (alive.current) setDraft(currentDraft.current); }
        }
      } catch (reason) { showError(reason); throw reason; }
      finally { if (alive.current) setSaving(false); }
    };
    const promise = operation(); pendingSave.current = promise;
    try { await promise; } finally { if (pendingSave.current === promise) pendingSave.current = undefined; }
  }, [showError]);
  useImperativeHandle(handleRef, () => ({ flush: save }), [save]);
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    void (async () => {
      try {
        if (importSourceUrl) {
          initialImport.current ??= (async () => {
            const response = await fetch(importSourceUrl); if (!response.ok) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, '无法读取待编辑文件');
            return requestText({ action: 'create', document: { title: fileName || '导入文档', format: textFormatFromFile(fileName || ''), content: await response.text() } });
          })();
          const imported = await initialImport.current; controller.signal.throwIfAborted(); accept(imported);
        }
        const list = await requestText({ action: 'list' }, controller.signal); controller.signal.throwIfAborted(); setDocuments(list.documents || []);
        const id = documentId || (!importSourceUrl ? list.documents?.[0]?.id : undefined);
        if (id) { const result = await requestText({ action: 'read', documentId: id }, controller.signal); controller.signal.throwIfAborted(); accept(result); }
      } catch (reason) { if (!controller.signal.aborted) showError(reason); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { alive.current = false; controller.abort(); pendingOperation.current?.abort(); };
  }, [documentId, importSourceUrl, fileName, accept, showError]);
  useEffect(() => {
    if (!dirty || disabled || !draft?.title.trim() || composing.current) return;
    const timer = setTimeout(() => void save().catch(() => undefined), 900); return () => clearTimeout(timer);
  }, [draft, dirty, disabled, save]);
  useLayoutEffect(() => {
    if (!workspace.current) return;
    const resize = () => { const width = workspace.current!.clientWidth, height = workspace.current!.clientHeight; setArea(previous => previous.width === width && previous.height === height ? previous : { width, height }); };
    const observer = new ResizeObserver(resize); observer.observe(workspace.current); resize(); return () => observer.disconnect();
  }, [loading]);
  useLayoutEffect(() => {
    if (!selectionOpen || !card.current) return;
    const position = () => {
      const size = { width: card.current!.offsetWidth, height: card.current!.offsetHeight };
      setPoint(previous => moved.current || !selectionBounds ? clampOverlay(previous, size, area) : placeOverlay(selectionBounds, size, area));
    };
    const observer = new ResizeObserver(position); observer.observe(card.current); position(); return () => observer.disconnect();
  }, [selectionOpen, selectionBounds, area]);
  async function operate(action: (signal: AbortSignal) => Promise<void>, flush = true) {
    if (pendingOperation.current) return;
    const controller = new AbortController(); pendingOperation.current = controller; setWorking(true); setError(''); setNotice('');
    try { if (flush) await save(); else if (pendingSave.current) await pendingSave.current; controller.signal.throwIfAborted(); await action(controller.signal); }
    catch (reason) { if (!controller.signal.aborted) showError(reason); }
    finally { if (pendingOperation.current === controller) pendingOperation.current = undefined; if (alive.current) setWorking(false); }
  }
  function update(next: TextDraft) { currentDraft.current = next; setDraft(next); setProposal(undefined); }
  async function changeMode(next: 'read' | 'edit') {
    try { await source.current?.flush(); } catch (reason) { showError(reason); return; }
    setMode(next); setSelection(undefined); setSelectionOpen(false);
  }
  async function changeFormat(format: TextDraft['format']) {
    try { await source.current?.flush(); } catch (reason) { showError(reason); return; }
    if (currentDraft.current) update({ ...currentDraft.current, format });
    setSelection(undefined); setSelectionOpen(false);
  }
  async function copyWholeText() {
    try { await source.current?.flush(); await navigator.clipboard.writeText(currentDraft.current?.content || ''); setNotice('全文已复制。'); }
    catch (reason) { showError(reason); }
  }
  function select(start: number, end: number, rect: Bounds) {
    if (pendingOperation.current || !currentDraft.current || !workspace.current) return;
    if (start === end) { setSelection(undefined); setSelectionOpen(false); return; }
    const root = workspace.current.getBoundingClientRect(), scaleX = workspace.current.clientWidth / (root.width || 1), scaleY = workspace.current.clientHeight / (root.height || 1);
    setSelection({ start, end, text: currentDraft.current.content.slice(start, end) }); setWholeDocument(false); setSelectionOpen(false); setProposal(undefined); moved.current = false;
    setSelectionBounds({ left: (rect.left - root.left) * scaleX, right: (rect.right - root.left) * scaleX, top: (rect.top - root.top) * scaleY, bottom: (rect.bottom - root.top) * scaleY });
  }
  async function openWholeRewrite() {
    try { await source.current?.flush(); } catch (reason) { showError(reason); return; }
    if (!currentDraft.current) return;
    setSelection({ start: 0, end: currentDraft.current.content.length, text: currentDraft.current.content }); setWholeDocument(true);
    setSelectionBounds(undefined); setProposal(undefined); moved.current = true; setPoint({ x: Math.max(12, area.width - 392), y: 60 }); setSelectionOpen(true);
  }
  function rewrite() {
    if (!selection || !instruction.trim()) return;
    void operate(async signal => {
      if (!current.current || !currentDraft.current) return;
      const target = wholeDocument ? { start: 0, end: currentDraft.current.content.length, text: currentDraft.current.content } : selection;
      if (currentDraft.current.content.slice(target.start, target.end) !== target.text) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, '原选区已改变，请重新选择。');
      const result = await requestText({ action: 'rewrite', documentId: current.current.id, document: currentDraft.current, selection: target, wholeDocument, instruction }, signal);
      signal.throwIfAborted(); if (!result.proposal) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, '未返回修改建议');
      setProposal(result.proposal);
    });
  }
  async function download() {
    try { await source.current?.flush(); } catch (reason) { showError(reason); return; }
    if (!currentDraft.current) return;
    const value = currentDraft.current, extension = textFileExtension(value.format), title = value.title.replace(/[<>:"/\\|?*]/g, '_').replace(/\.(?:txt|md|markdown|html?)$/i, '') || 'document';
    const url = URL.createObjectURL(new Blob([value.content], { type: value.format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' }));
    const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = `${title}.${extension}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (loading && !document) return <CreativeEditorLoading label="正在打开文本编辑器" />;
  const cardWidth = Math.max(160, Math.min(380, area.width - 24)), cardHeight = Math.max(120, Math.min(520, area.height - 24));
  const toolbarPoint = selectionBounds ? placeOverlay(selectionBounds, { width: 190, height: 44 }, area) : { x: 12, y: 12 };
  return <div className="text-workspace" ref={workspace} style={{ '--text-sidebar-width': `${effectiveSidebar}px` } as CSSProperties}
    onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!disabled && !composing.current) void save().catch(() => undefined); } }}>
    <input ref={importFile} type="file" accept=".txt,.md,.markdown,.html,.htm" hidden onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      void operate(async signal => { const content = await file.text(); signal.throwIfAborted(); accept(await requestText({ action: 'create', document: { title: file.name, format: textFormatFromFile(file.name), content } }, signal)); setMode('edit'); setNotice('文件已导入。'); });
    }} />
    <aside className="text-sidebar">
      <div className="text-library-header"><span>文档</span><div className="text-library-actions">
        <CreativeButton variant="ghost" isIconOnly aria-label="导入文本文件" title="导入文本、Markdown 或 HTML" disabled={disabled} onClick={() => importFile.current?.click()}><Upload size={14} /></CreativeButton>
        <CreativeButton variant="ghost" isIconOnly aria-label="新建文档" title="新建文档" disabled={disabled} onClick={() => void operate(async signal => { accept(await requestText({ action: 'create', document: { title: '未命名文档', format: 'markdown', content: '' } }, signal)); setMode('edit'); })}><Plus size={14} /></CreativeButton>
      </div></div>
      <nav className="text-document-list" aria-label="文本列表">{documents.map(item => <CreativeButton key={item.id} variant="ghost" className={`text-document-item${document?.id === item.id ? ' is-active' : ''}`} title={item.title} disabled={disabled}
        onClick={() => void operate(async signal => accept(await requestText({ action: 'read', documentId: item.id }, signal)))}><FileText size={14} /><span>{item.title}</span><small>{textFileExtension(item.format)}</small></CreativeButton>)}</nav>
      <div className="text-sidebar-footer"><small>文档独立保存 · 所有对话共享</small></div>
    </aside>
    <div className="text-sidebar-resizer" role="separator" tabIndex={0} aria-label="调整文档列表宽度" aria-orientation="vertical" aria-valuemin={minimumSidebar} aria-valuemax={Math.floor(maximumSidebar)} aria-valuenow={effectiveSidebar}
      onPointerDown={event => { if (event.button !== 0 || !workspace.current) return; event.preventDefault(); const root = workspace.current.getBoundingClientRect(); sidebarGesture.current = { pointerId: event.pointerId, x: event.clientX, width: effectiveSidebar, scale: workspace.current.clientWidth / (root.width || 1) }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const value = sidebarGesture.current; if (value?.pointerId === event.pointerId) setSidebarWidth(Math.max(minimumSidebar, Math.min(maximumSidebar, value.width + (event.clientX - value.x) * value.scale))); }}
      onPointerUp={event => { sidebarGesture.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { sidebarGesture.current = undefined; }}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); setSidebarWidth(Math.max(minimumSidebar, Math.min(maximumSidebar, effectiveSidebar + (event.key === 'ArrowLeft' ? -10 : 10)))); }} onDoubleClick={() => setSidebarWidth(200)} />
    <section className="text-document">
      {error && <p className="text-error-banner" role="alert">{error}</p>}{notice && <p className="text-notice" role="status"><Check size={13} />{notice}</p>}
      {draft ? <>
        <div className="text-document-toolbar"><div className="text-mode-switch">
          <CreativeButton variant="ghost" className="text-mode-tab" aria-pressed={mode === 'edit'} disabled={disabled} onClick={() => void changeMode('edit')}>编辑</CreativeButton>
          <CreativeButton variant="ghost" className="text-mode-tab" aria-pressed={mode === 'read'} disabled={disabled} onClick={() => void changeMode('read')}>预览</CreativeButton>
        </div><Tabs className="text-format-tabs" selectedKey={draft.format} onSelectionChange={key => void changeFormat(String(key) as TextDraft['format'])}>
          <TabList className="text-format-list" aria-label="文档格式">{formats.map(format => <Tab className="text-format-tab" key={format.value} id={format.value} isDisabled={disabled}>{format.label}</Tab>)}</TabList>
        </Tabs>
          <div className="text-toolbar-end"><span className="text-save-state">{saving ? '保存中' : dirty ? '待保存' : '已保存'}</span>
          <div className="text-toolbar-actions"><CreativeButton variant="ghost" isIconOnly title="保存" aria-label="保存文本" disabled={disabled || !dirty} onClick={() => void save().catch(() => undefined)}><Save size={15} /></CreativeButton>
            <CreativeButton variant="ghost" isIconOnly title="复制全文" aria-label="复制全文" onClick={() => void copyWholeText()}><Copy size={15} /></CreativeButton>
            <CreativeButton variant="ghost" isIconOnly title="导出文本" aria-label="导出文本" onClick={download}><Download size={15} /></CreativeButton>
            <CreativeButton variant="ghost" isIconOnly title="重新读取文档" aria-label="重新读取文档" disabled={disabled} onClick={() => void operate(async signal => { if (current.current) accept(await requestText({ action: 'read', documentId: current.current.id }, signal)); }, false)}><RefreshCw size={15} /></CreativeButton>
            <CreativeButton variant="ghost" isIconOnly title="AI 编辑整篇文档" aria-label="AI 编辑整篇文档" disabled={disabled} onClick={openWholeRewrite}><Sparkles size={15} /></CreativeButton>
            <CreativeButton variant="ghost" isIconOnly title="删除文档" aria-label="删除文档" disabled={disabled} onClick={() => void operate(async signal => {
              const id = current.current?.id; if (!id) return; await requestText({ action: 'delete', documentId: id }, signal); const list = await requestText({ action: 'list' }, signal); setDocuments(list.documents || []);
              current.current = undefined; currentDraft.current = undefined; saved.current = undefined; setDocument(undefined); setDraft(undefined); setSelection(undefined); setSelectionOpen(false); setProposal(undefined);
              if (list.documents?.[0]) accept(await requestText({ action: 'read', documentId: list.documents[0].id }, signal)); setNotice('文档已删除。');
            }, false)}><Trash2 size={15} /></CreativeButton>
          </div></div>
        </div>
        <div className="text-document-content"><article className={`text-paper${mode === 'edit' ? ' is-editing' : draft.format === 'html' ? ' is-html' : ''}`}>
          <input className="text-title-editor" aria-label="文档标题" value={draft.title} maxLength={240} disabled={disabled} onChange={event => update({ ...currentDraft.current!, title: event.target.value })} />
          {mode === 'edit' || draft.format === 'text' ?
            <MonacoTextEditor key={document?.id} handleRef={source} value={draft.content} language={draft.format} disabled={disabled} readOnly={mode === 'read'} label={mode === 'edit' ? '文本源码' : '文本内容预览'}
              onSave={() => save().catch(() => undefined)}
              onComposition={value => { composing.current = value; }} onSelection={select}
              onChange={content => { setSelection(undefined); setSelectionOpen(false); update({ ...currentDraft.current!, content }); }} />
           : draft.format === 'html' ? <iframe className="text-html-preview" title="HTML 内容预览" sandbox="" referrerPolicy="no-referrer" srcDoc={textPreviewHtml(draft.content)} />
            : <div className="text-reader-viewport"><Suspense fallback={<CreativeEditorLoading label="正在加载预览" />}><MarkdownDocumentPreview content={draft.content} /></Suspense></div>}
        </article></div>
        <footer className="text-document-footer"><span>{draft.content.length.toLocaleString()} 字符 · {formats.find(item => item.value === draft.format)?.label}</span><span>{mode === 'edit' ? '选择文字可复制或 AI 改写 · Ctrl / ⌘ + S 保存' : draft.format === 'html' ? 'HTML 渲染预览' : '内容预览'}</span></footer>
      </> : <div className="text-empty"><FileText size={36} /><h3>独立文本编辑器</h3><p>新建或导入文档，编辑纯文本、Markdown 和 HTML。</p><CreativeButton variant="primary" disabled={disabled} onClick={() => void operate(async signal => { accept(await requestText({ action: 'create', document: { title: '未命名文档', format: 'markdown', content: '' } }, signal)); setMode('edit'); })}><Plus size={15} />新建文档</CreativeButton></div>}
    </section>
    {selection && !selectionOpen && <div className="text-selection-toolbar" role="toolbar" aria-label="选中文字操作" style={{ left: toolbarPoint.x, top: toolbarPoint.y }} onPointerDown={event => { if (event.button === 0) event.preventDefault(); }}>
      <CreativeButton variant="ghost" disabled={working} onClick={() => void navigator.clipboard.writeText(selection.text).then(() => setNotice('选中文字已复制。'), showError)}><Copy size={13} />复制</CreativeButton>
      <CreativeButton variant="ghost" disabled={working} onClick={() => setSelectionOpen(true)}><Sparkles size={13} />AI 改写</CreativeButton>
      <CreativeButton variant="ghost" isIconOnly aria-label="关闭选区工具栏" onClick={() => setSelection(undefined)}><X size={13} /></CreativeButton>
    </div>}
    {selection && selectionOpen && <div ref={card} className="text-selection-card text-rewrite-card" role="dialog" aria-label={wholeDocument ? 'AI 编辑整篇文档' : 'AI 修改选中文字'} style={{ width: cardWidth, maxHeight: cardHeight, left: point.x, top: point.y }}>
      <header><div className="text-selection-drag-handle" role="button" tabIndex={0} aria-label="拖动 AI 编辑窗口"
        onPointerDown={event => { if (event.button !== 0 || !workspace.current) return; event.preventDefault(); const root = workspace.current.getBoundingClientRect(); moved.current = true; gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, point, scaleX: workspace.current.clientWidth / (root.width || 1), scaleY: workspace.current.clientHeight / (root.height || 1) }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { const value = gesture.current; if (value?.pointerId !== event.pointerId) return; setPoint(clampOverlay({ x: value.point.x + (event.clientX - value.x) * value.scaleX, y: value.point.y + (event.clientY - value.y) * value.scaleY }, { width: card.current?.offsetWidth || cardWidth, height: card.current?.offsetHeight || cardHeight }, area)); }}
        onPointerUp={event => { gesture.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { gesture.current = undefined; }} onLostPointerCapture={() => { gesture.current = undefined; }}
        onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); moved.current = true; const step = event.shiftKey ? 40 : 10; setPoint(previous => clampOverlay({ x: previous.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: previous.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }, { width: card.current?.offsetWidth || cardWidth, height: card.current?.offsetHeight || cardHeight }, area)); }}>
        <GripVertical size={14} /><Sparkles size={15} />{wholeDocument ? '编辑整篇文档' : '修改选中文字'}<small>{selection.text.length.toLocaleString()} 字符</small>
      </div><CreativeButton variant="ghost" isIconOnly aria-label="关闭 AI 编辑窗口" onClick={() => { pendingOperation.current?.abort(); setSelectionOpen(false); setProposal(undefined); }}><X size={15} /></CreativeButton></header>
      <div className="text-selection-body">
        <TextArea aria-label="修改要求" fullWidth className="text-ai-prompt" rows={3} value={instruction} disabled={working} onChange={event => setInstruction(event.target.value)} placeholder="例如：润色表达，缩短篇幅，整理成 Markdown，调整 HTML 排版。" />
        <div className="text-prompt-chips">{['润色表达', '精简内容', '修正错别字'].map(label => <CreativeButton key={label} variant="ghost" disabled={working} onClick={() => setInstruction(`请${label}，保留原有事实和格式。`)}>{label}</CreativeButton>)}</div>
        <div className="text-proposal-actions">{working && <CreativeButton variant="ghost" onClick={() => pendingOperation.current?.abort()}>取消修改</CreativeButton>}<CreativeButton variant="primary" disabled={disabled || !instruction.trim()} onClick={rewrite}>{working ? <LoaderCircle size={15} className="editor-spin" /> : <Sparkles size={15} />}{working ? '正在生成…' : proposal ? '重新生成' : '生成修改建议'}</CreativeButton></div>
        {proposal && <section className="text-rewrite-result" aria-label="修改建议"><h4>修改建议</h4>
          <div className="text-proposal-preview"><MonacoTextEditor readOnly value={proposal.replacement} language={draft?.format} label="修改建议全文" /></div>
          <div className="text-proposal-actions"><CreativeButton variant="ghost" disabled={working} onClick={() => setProposal(undefined)}>保留原文</CreativeButton><CreativeButton variant="primary" disabled={working} onClick={() => void operate(async signal => {
            if (!current.current) return;
            const result = await requestText({ action: 'apply', documentId: current.current.id, proposalId: proposal.id }, signal);
            signal.throwIfAborted(); accept(result);
          })}><Check size={14} />应用修改</CreativeButton></div>
        </section>}
      </div>
    </div>}
  </div>;
}
