'use client';

import { CreativeButton } from './ui/creative-button';

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { BookOpen, Check, Download, Feather, FileText, LoaderCircle, RefreshCw, Save, Sparkles, X } from 'lucide-react';
import type { NovelReview } from '@cjfclonedeep/capability-sdk/novel';
import type { NovelEditProposal, NovelEditorChapter, NovelEditorDraft, NovelEditorResponse, NovelListItem, NovelWorkspaceProject } from '@/lib/novel-editor';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { TextArea } from '@heroui/react/textarea';
import { CustomSelect } from '@/components/CustomSelect';
import { CreativeEditorLoading } from './CreativeEditorLoading';

export type NovelEditorHandle = { flush(): Promise<void> };
type Selection = { start: number; end: number; text: string };
class EditorRequestError extends Error {
  constructor(message: string, readonly issues?: NovelReview['issues'], readonly code?: string) { super(message); }
}
async function requestNovel(body: unknown, signal?: AbortSignal): Promise<NovelEditorResponse> {
  const requestSignal = (body as { action?: string })?.action === 'rewrite'
    ? signal : AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  const response = await fetch(withWebPilotBasePath('/api/novels/workspace'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: requestSignal });
  const result = await response.json();
  if (!response.ok) throw new EditorRequestError(result.error || '小说读取失败', result.issues, result.code);
  return result;
}
const asDraft = (chapter: NovelEditorChapter): NovelEditorDraft => ({ number: chapter.number, title: chapter.title, content: chapter.content });
const countWords = (content = '') => content.replace(/\s/g, '').length;
const sidebarWidthStorageKey = 'webpilot.novel.sidebar-width';

export function NovelEditorPanel({ projectId, handleRef }: { projectId?: string; handleRef?: Ref<NovelEditorHandle> }) {
  const [projects, setProjects] = useState<NovelListItem[]>([]);
  const [project, setProject] = useState<NovelWorkspaceProject>();
  const [chapter, setChapter] = useState<NovelEditorChapter>();
  const [draft, setDraft] = useState<NovelEditorDraft>();
  const [mode, setMode] = useState<'read' | 'edit' | 'plan'>('read');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [composing, setComposing] = useState(false);
  const [working, setWorking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<NovelReview['issues']>([]);
  const [selection, setSelection] = useState<Selection>();
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<NovelEditProposal>();
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [selectionPoint, setSelectionPoint] = useState({ x: 0, y: 0 });
  const [workspaceSize, setWorkspaceSize] = useState({ width: 800, height: 600 });
  const [sidebarWidth, setSidebarWidth] = useState<number>();
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarGesture = useRef<{ pointerId: number; startX: number; startWidth: number; width: number; scale: number; previous?: number } | undefined>(undefined);
  const workspace = useRef<HTMLDivElement>(null), readerViewport = useRef<HTMLDivElement>(null), selectionCard = useRef<HTMLDivElement>(null);
  const currentProject = useRef(project), currentDraft = useRef(draft);
  const saved = useRef(''), pendingSave = useRef<Promise<void> | undefined>(undefined);
  const compositionActive = useRef(false);
  const pendingAi = useRef<AbortController | undefined>(undefined), loadingRequest = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true), reader = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null), titleEditor = useRef<HTMLTextAreaElement>(null);
  const minimumSidebarWidth = workspaceSize.width < 500 ? 104 : 140;
  const maximumSidebarWidth = Math.floor(Math.max(minimumSidebarWidth, Math.min(480,
    workspaceSize.width - Math.min(320, workspaceSize.width * 0.55) - 7)));
  const clampSidebarWidth = (width: number) => Math.round(Math.max(minimumSidebarWidth, Math.min(maximumSidebarWidth, width)));
  const effectiveSidebarWidth = clampSidebarWidth(sidebarWidth ?? (workspaceSize.width <= 650 ? 126 : 200));
  const rememberSidebarWidth = (width?: number) => {
    setSidebarWidth(width);
    try {
      if (width === undefined) localStorage.removeItem(sidebarWidthStorageKey);
      else localStorage.setItem(sidebarWidthStorageKey, String(width));
    } catch { /* Resizing also works when browser storage is unavailable. */ }
  };

  useEffect(() => {
    try {
      const savedWidth = Number(localStorage.getItem(sidebarWidthStorageKey));
      if (Number.isFinite(savedWidth) && savedWidth >= 104 && savedWidth <= 480) setSidebarWidth(savedWidth);
    } catch { /* Use the responsive default. */ }
  }, []);

  const showError = useCallback((reason: unknown) => {
    if (!alive.current) return;
    setError(reason instanceof Error ? reason.message : String(reason));
    setIssues(reason instanceof EditorRequestError ? reason.issues || [] : []);
    if (reason instanceof EditorRequestError && reason.code === 'revision_conflict') setConflict(true);
  }, []);
  const acceptSaved = useCallback((result: NovelEditorResponse) => {
    if (!result.project) throw new Error('未返回小说工程');
    currentProject.current = result.project; setProject(result.project);
    setIssues(result.validation?.issues || []);
    if (result.chapter) {
      const next = asDraft(result.chapter); currentDraft.current = next; saved.current = JSON.stringify(next);
      setDraft(next); setChapter(result.chapter);
    } else { currentDraft.current = undefined; saved.current = ''; setDraft(undefined); setChapter(undefined); setMode('plan'); }
  }, []);
  const save = useCallback(async () => {
    if (pendingSave.current) return pendingSave.current;
    const operation = async () => {
      try {
        if (alive.current) setSaving(true);
        while (!compositionActive.current && currentProject.current && currentDraft.current && JSON.stringify(currentDraft.current) !== saved.current) {
          const snapshot = { ...currentDraft.current }, signature = JSON.stringify(snapshot), previous = currentProject.current;
          const result = await requestNovel({ action: 'save', projectId: previous.id, revision: previous.revision, chapter: snapshot });
          if (!result.project || !result.chapter) throw new Error('未返回已保存章节');
          currentProject.current = result.project; saved.current = JSON.stringify(asDraft(result.chapter));
          if (alive.current) { setProject(result.project); setChapter(result.chapter); setError(''); setConflict(false); }
          if (JSON.stringify(currentDraft.current) === signature) {
            currentDraft.current = asDraft(result.chapter);
            if (alive.current) setDraft(currentDraft.current);
          }
        }
      } catch (reason) { showError(reason); throw reason; }
      finally { if (alive.current) setSaving(false); }
    };
    const promise = operation(); pendingSave.current = promise;
    try { await promise; } finally { if (pendingSave.current === promise) pendingSave.current = undefined; }
  }, [showError]);
  const load = useCallback(async (id: string, number?: number, signal?: AbortSignal) => {
    const result = await requestNovel({ action: 'read', projectId: id, ...(number ? { chapterNumber: number } : {}) }, signal);
    if (!number && result.project?.chapters[0]) return requestNovel({ action: 'read', projectId: id, chapterNumber: result.project.chapters[0].number }, signal);
    return result;
  }, []);
  useEffect(() => {
    alive.current = true; const controller = new AbortController(); loadingRequest.current = controller;
    void (async () => {
      try {
        const result = await requestNovel({ action: 'list' }, controller.signal); setProjects(result.projects || []);
        const id = projectId || result.projects?.[0]?.id;
        if (id) acceptSaved(await load(id, undefined, controller.signal));
      } catch (reason) { if (!controller.signal.aborted) showError(reason); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { alive.current = false; controller.abort(); loadingRequest.current?.abort(); pendingAi.current?.abort(); };
  }, [projectId, acceptSaved, load, showError]);
  useEffect(() => {
    if (!draft || working || loading || composing || conflict || JSON.stringify(draft) === saved.current) return;
    const timer = setTimeout(() => { void save().catch(() => undefined); }, 1200);
    return () => clearTimeout(timer);
  }, [draft, working, loading, composing, conflict, save]);
  useImperativeHandle(handleRef, () => ({ async flush() {
    if (pendingAi.current) throw new Error('AI 正在修改，请等待完成或先取消修改。');
    await save();
  } }), [save]);

  useLayoutEffect(() => {
    const root = workspace.current;
    if (!root) return;
    const measure = () => setWorkspaceSize({ width: root.clientWidth, height: root.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(root);
    return () => observer.disconnect();
  }, [project?.id]);
  useLayoutEffect(() => {
    const element = titleEditor.current;
    if (!element || mode !== 'edit') return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  }, [mode, draft?.title, effectiveSidebarWidth, workspaceSize.width]);
  useLayoutEffect(() => {
    if (readerViewport.current) readerViewport.current.scrollTop = 0;
  }, [mode, draft?.number, project?.id]);
  useEffect(() => {
    if (!selection) return;
    const dismiss = (event: PointerEvent) => {
      if (!working && !proposal && !selectionCard.current?.contains(event.target as Node)) setSelection(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) { event.stopPropagation(); setSelection(undefined); setProposal(undefined); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape, true); };
  }, [selection, working, proposal]);

  async function navigate(id: string, number?: number, discard = false) {
    if (pendingAi.current) return;
    const controller = new AbortController(); loadingRequest.current?.abort(); loadingRequest.current = controller;
    setLoading(true);
    try {
      if (!discard) await save();
      acceptSaved(await load(id, number, controller.signal));
      setProposal(undefined); setSelection(undefined); setError(''); setIssues([]); setNotice(''); setConflict(false);
    } catch (reason) { if (!controller.signal.aborted) showError(reason); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function change(patch: Partial<NovelEditorDraft>) {
    if (!currentDraft.current) return;
    const next = { ...currentDraft.current, ...patch }; currentDraft.current = next; setDraft(next);
    setProposal(undefined); setSelection(undefined); setIssues([]); setNotice('');
  }
  function select(start: number, end: number, bounds?: DOMRect) {
    if (pendingAi.current) return;
    const text = currentDraft.current?.content.slice(start, end) || '';
    if (end > start && text.trim()) {
      const root = workspace.current?.getBoundingClientRect();
      if (root && bounds) setSelectionPoint({ x: bounds.left - root.left, y: bounds.bottom - root.top + 8 });
      setSelection({ start, end, text }); setProposal(undefined); setIssues([]);
    }
  }
  function readSelection() {
    const selected = window.getSelection(), element = reader.current;
    if (!element || !selected?.rangeCount || selected.isCollapsed) return;
    const range = selected.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const before = range.cloneRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length; select(start, start + range.toString().length, range.getBoundingClientRect());
  }
  function switchMode(next: typeof mode) { setSelection(undefined); setProposal(undefined); setMode(next); }
  async function rewrite() {
    if (!selection || !instruction.trim()) return;
    const controller = new AbortController(); pendingAi.current = controller; setWorking(true); setError(''); setIssues([]); setProposal(undefined); setNotice('');
    try {
      await save(); controller.signal.throwIfAborted();
      const current = currentProject.current, text = currentDraft.current;
      if (!current || !text) return;
      const result = await requestNovel({ action: 'rewrite', projectId: current.id, revision: current.revision, chapter: text, selection, instruction }, controller.signal);
      if (!result.proposal) throw new Error('AI 未返回修改建议');
      if (alive.current) { setProposal(result.proposal); setIssues(result.validation?.issues || []); }
    } catch (reason) { if (!controller.signal.aborted) showError(reason); else if (alive.current) setNotice('已取消 AI 修改，原文已保留。'); }
    finally { pendingAi.current = undefined; if (alive.current) setWorking(false); }
  }
  async function apply() {
    if (!proposal || !currentProject.current) return;
    const controller = new AbortController(); pendingAi.current = controller; setWorking(true); setApplying(true);
    try {
      const result = await requestNovel({ action: 'apply', projectId: proposal.projectId, revision: proposal.revision, proposalId: proposal.id }, controller.signal);
      acceptSaved(result); setProposal(undefined); setSelection(undefined); setNotice('AI 修改已应用并保存。'); setError('');
    } catch (reason) { showError(reason); }
    finally { pendingAi.current = undefined; if (alive.current) { setWorking(false); setApplying(false); } }
  }
  function downloadChapter() {
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([`# 第 ${draft.number} 章 ${draft.title}\n\n${draft.content}`], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project?.title || '小说'}-第${draft.number}章.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const dirty = Boolean(draft && JSON.stringify(draft) !== saved.current), disabled = working || loading;
  const chapterIndex = project?.chapters.findIndex(item => item.number === draft?.number) ?? -1;
  if (loading && !project) return <CreativeEditorLoading label="正在打开小说书架" />;
  if (!project) return <div className="novel-empty"><BookOpen size={40} /><h3>{error ? '暂时无法打开小说' : '故事，从一个点子开始'}</h3><p>{error || '在对话中提出创作点子。生成的小说会保存在这里，随时阅读与修改。'}</p></div>;
  const cardWidth = Math.min(380, workspaceSize.width - 24), cardHeight = Math.min(520, workspaceSize.height - 24);
  return <div className={`novel-workspace${resizingSidebar ? ' is-resizing-sidebar' : ''}`} ref={workspace}
    style={{ '--novel-sidebar-width': `${effectiveSidebarWidth}px` } as CSSProperties}
    onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!disabled && !composing && dirty) void save().catch(() => undefined);
      }
    }}>
    <aside className="novel-sidebar">
      <div className="novel-library-header"><CustomSelect ariaLabel="切换小说" className="novel-library-select" title="所有对话共享的小说" searchable value={project.id} disabled={disabled} onChange={id => void navigate(id)} options={projects.map(item => ({ value: item.id, label: item.title }))} /></div>
      <div className="novel-chapter-heading"><span>章节目录</span><small title={`已完成 ${project.chapters.length} 章，共 ${project.plan.chapters.length} 章`}>{project.chapters.length} / {project.plan.chapters.length}</small></div>
      <nav aria-label="小说章节" className="novel-chapter-list">
        {project.plan.chapters.map((item, index) => {
          const existing = project.chapters.find(chapter => chapter.number === index + 1), active = draft?.number === index + 1 && mode !== 'plan';
          const title = existing?.title || item.title;
          return <CreativeButton key={index} variant="ghost" className={`novel-chapter-item${active ? ' is-active' : ''}${!existing ? ' is-unwritten' : ''}`} title={`${title} · ${existing ? `${existing.contentChars.toLocaleString()} 字${existing.contextStale ? ' · 摘要待更新' : ''}` : '尚未生成'}`} aria-label={`第 ${index + 1} 章 ${title}${existing ? '' : '，尚未生成'}`} aria-current={active ? 'page' : undefined} disabled={!existing || disabled} onClick={() => { switchMode('read'); void navigate(project.id, index + 1); }}>
            <span className="novel-chapter-number">{String(index + 1).padStart(2, '0')}</span><span className="novel-chapter-title">{title}</span>{!existing && <span className="novel-chapter-pending" aria-hidden="true" />}
          </CreativeButton>;
        })}
      </nav>
      <div className="novel-sidebar-footer"><CreativeButton variant="ghost" disabled={disabled} className={`novel-plan-button${mode === 'plan' ? ' is-active' : ''}`} onClick={() => switchMode(mode === 'plan' && draft ? 'read' : 'plan')}><FileText size={14} />设定与大纲</CreativeButton>
        <small className="novel-library-note">所有对话共享</small></div>
    </aside>
    <div className="novel-sidebar-resizer" role="separator" tabIndex={0}
      aria-label="调整章节目录宽度" aria-orientation="vertical"
      aria-valuemin={minimumSidebarWidth} aria-valuemax={Math.floor(maximumSidebarWidth)} aria-valuenow={effectiveSidebarWidth}
      aria-valuetext={`${effectiveSidebarWidth} 像素`}
      title="拖动调整目录宽度；双击恢复默认宽度"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || !workspace.current) return;
        event.preventDefault();
        const bounds = workspace.current.getBoundingClientRect();
        sidebarGesture.current = { pointerId: event.pointerId, startX: event.clientX,
          startWidth: effectiveSidebarWidth, width: effectiveSidebarWidth, previous: sidebarWidth,
          scale: bounds.width ? workspace.current.clientWidth / bounds.width : 1 };
        event.currentTarget.setPointerCapture(event.pointerId);
        setResizingSidebar(true);
      }}
      onPointerMove={event => {
        const gesture = sidebarGesture.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gesture.width = clampSidebarWidth(gesture.startWidth + (event.clientX - gesture.startX) * gesture.scale);
        setSidebarWidth(gesture.width);
      }}
      onPointerUp={event => {
        const gesture = sidebarGesture.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        rememberSidebarWidth(gesture.width);
        sidebarGesture.current = undefined; setResizingSidebar(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (sidebarGesture.current) setSidebarWidth(sidebarGesture.current.previous);
        sidebarGesture.current = undefined; setResizingSidebar(false);
      }}
      onLostPointerCapture={() => {
        if (sidebarGesture.current) setSidebarWidth(sidebarGesture.current.previous);
        sidebarGesture.current = undefined; setResizingSidebar(false);
      }}
      onDoubleClick={() => rememberSidebarWidth()}
      onKeyDown={event => {
        const increment = event.shiftKey ? 48 : 16;
        const next = event.key === 'ArrowLeft' ? effectiveSidebarWidth - increment
          : event.key === 'ArrowRight' ? effectiveSidebarWidth + increment
            : event.key === 'Home' ? minimumSidebarWidth : event.key === 'End' ? maximumSidebarWidth : undefined;
        if (next === undefined) return;
        event.preventDefault(); rememberSidebarWidth(clampSidebarWidth(next));
      }} />
    <section className="novel-document">
      <div className="novel-document-toolbar">
        <div className="novel-mode-switch" aria-label="小说查看模式"><CreativeButton className="novel-mode-tab" variant="ghost" aria-pressed={mode === 'read'} disabled={!draft || disabled} onClick={() => switchMode('read')}>阅读</CreativeButton><CreativeButton className="novel-mode-tab" variant="ghost" aria-pressed={mode === 'edit'} disabled={!draft || disabled} onClick={() => switchMode('edit')}>编辑</CreativeButton></div>
        <span className="novel-save-state" aria-live="polite">{saving ? <LoaderCircle size={12} className="editor-spin" /> : dirty ? <span className="novel-unsaved-dot" /> : <Check size={12} />}{saving ? '保存中' : dirty ? '待保存' : '已保存'}</span>
        <div className="novel-toolbar-actions" role="group" aria-label="章节操作">
          <CreativeButton variant="ghost" isIconOnly title="放弃未保存修改，重新读取本章" aria-label="重新读取本章" disabled={disabled || saving || !draft} onClick={() => void navigate(project.id, draft?.number, true)}><RefreshCw size={15} /></CreativeButton>
          <CreativeButton variant="ghost" isIconOnly title="导出本章（包含当前修改）" aria-label="导出本章" onClick={downloadChapter} disabled={!draft}><Download size={16} /></CreativeButton>
          <CreativeButton variant="ghost" title="保存修改（Ctrl / ⌘ + S）" onClick={() => void save().catch(() => undefined)} disabled={disabled || saving || composing || !dirty}><Save size={14} />保存</CreativeButton>
        </div>
      </div>
      {error && <div role="alert" className="novel-error-banner"><span>{error}</span>{conflict && <CreativeButton onClick={() => void navigate(project.id, draft?.number, true)}><RefreshCw size={14} />放弃本地修改并重新读取</CreativeButton>}</div>}
      {notice && <div className="novel-notice" role="status"><Check size={14} />{notice}</div>}
      <div className={`novel-document-content${mode === 'plan' ? ' is-plan' : ''}`} aria-busy={loading}>
        {mode === 'plan' ? <article className="novel-paper novel-plan"><span className="editor-eyebrow">创作档案</span><h1>{project.title}</h1><p className="novel-paper-subtitle">{project.confirmed ? '已确认的创作方案' : '等待确认的创作方案'}</p>
          <h2>故事大纲</h2><p>{project.plan.outline}</p><h2>故事背景</h2><p>{project.plan.background}</p><h2>文本风格</h2><p>{project.plan.style}</p>
          <h2>时间线</h2><ol>{project.plan.timeline.map((item, i) => <li key={i}><strong>{item.time}</strong><p>{item.event}</p></li>)}</ol>
          <h2>人物档案</h2>{project.plan.characters.map((item, i) => <section key={i}><h3>{item.name}<small>{item.role}</small></h3><p>{item.description}</p></section>)}
        </article> : draft ? <article className="novel-paper" key={`${project.id}-${draft.number}`}>
          <div className="novel-paper-kicker"><span>第 {String(draft.number).padStart(2, '0')} 章</span><span>{countWords(draft.content).toLocaleString()} 字 · 约 {Math.max(1, Math.ceil(countWords(draft.content) / 500))} 分钟阅读</span></div>
          {mode === 'edit' ? <><textarea ref={titleEditor} className="novel-title-editor" aria-label="章节标题" rows={1} value={draft.title} disabled={disabled} spellCheck={false}
            onCompositionStart={() => { compositionActive.current = true; setComposing(true); }} onCompositionEnd={() => { compositionActive.current = false; setComposing(false); }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault(); }}
            onChange={event => change({ title: event.target.value.replace(/[\r\n]+/g, ' ') })} />
            <textarea ref={textarea} className="novel-prose-editor" aria-label="章节正文" value={draft.content} disabled={disabled} spellCheck={false}
              onCompositionStart={() => { compositionActive.current = true; setComposing(true); }} onCompositionEnd={() => { compositionActive.current = false; setComposing(false); }}
              onChange={event => change({ content: event.target.value })} onSelect={event => select(event.currentTarget.selectionStart, event.currentTarget.selectionEnd, event.currentTarget.getBoundingClientRect())} /></>
            : <><h1>{draft.title}</h1><div className="novel-reader-viewport" ref={readerViewport} tabIndex={0} role="region" aria-label="章节阅读区"><div className="novel-prose" ref={reader} onMouseUp={readSelection} onKeyUp={readSelection}>{draft.content}</div></div></>}
          {chapter?.contextStale && <p className="novel-context-note">正文已更新，后续创作将按新内容核对设定。</p>}
        </article> : <div className="novel-empty"><Feather size={32} /><h3>故事即将展开</h3><p>创作方案已保存。确认方案并生成章节后，即可在这里编辑。</p><CreativeButton className="editor-secondary-button" onClick={() => setMode('plan')}>查看创作方案</CreativeButton></div>}
      </div>
      <footer className="novel-document-footer"><span>{mode === 'edit' ? '自动保存 · 选中文字可用 AI 修改' : mode === 'read' ? '选中文字，进行 AI 修改' : '设定与大纲'}</span><span>{mode !== 'plan' && draft ? `第 ${chapterIndex + 1} / ${project.chapters.length} 章` : '创作方案'}</span></footer>
    </section>
    {selection && <div ref={selectionCard} className="novel-selection-card" role="dialog" aria-label="修改选中文字" style={{ width: cardWidth, maxHeight: cardHeight,
      left: Math.max(12, Math.min(selectionPoint.x, workspaceSize.width - cardWidth - 12)), top: Math.max(12, Math.min(selectionPoint.y, workspaceSize.height - cardHeight - 12)) }}>
      <header><span><Sparkles size={15} />修改选中文字<small>{countWords(selection.text)} 字</small></span><CreativeButton variant="ghost" isIconOnly aria-label="关闭修改卡片" disabled={working} onClick={() => { setSelection(undefined); setProposal(undefined); }}><X size={15} /></CreativeButton></header>
      <blockquote className="novel-selection-excerpt">{selection.text}</blockquote>
      <label className="novel-prompt-label" htmlFor="novel-edit-instruction">想怎样修改？</label>
      <TextArea fullWidth id="novel-edit-instruction" className="novel-ai-prompt" placeholder="例如：让这段对白更克制，通过动作表现紧张，保留原有情节。" value={instruction} disabled={working} onChange={event => setInstruction(event.target.value)} />
      <div className="novel-prompt-chips">{['润色语言', '增强画面感', '对白更自然'].map(label => <CreativeButton variant="ghost" key={label} disabled={working} onClick={() => setInstruction(`请${label}，保留已有情节和人物设定，避免模板化表达。`)}>{label}</CreativeButton>)}</div>
      <div className="novel-proposal-actions">{working && !applying && <CreativeButton variant="ghost" onClick={() => pendingAi.current?.abort()}>取消修改</CreativeButton>}<CreativeButton variant="primary" disabled={!instruction.trim() || disabled || conflict} onClick={() => void rewrite()}>{working ? <LoaderCircle size={15} className="editor-spin" /> : <Sparkles size={15} />}{applying ? '正在保存…' : working ? '正在修改…' : proposal ? '重新生成' : '生成修改建议'}</CreativeButton></div>
      <p className="novel-ai-footnote">查看修改内容与本地校验提示，确认后替换原文。</p>
      {issues.length > 0 && <div className="novel-review-issues"><strong>需要调整的地方</strong>{issues.map((issue, i) => <div key={i}><small>{issue.location}</small><p>{issue.explanation}</p><p>{issue.suggestion}</p></div>)}</div>}
      {proposal && <section className="novel-rewrite-result" aria-label="AI 修改对比"><header><span><Check size={14} />修改已生成</span><small>仅替换选中部分</small></header><details><summary>查看原文</summary><p>{proposal.original}</p></details><h4>建议稿</h4><div className="novel-replacement">{proposal.replacement || '（删除选中内容）'}</div>
        <div className="novel-proposal-actions"><CreativeButton variant="ghost" disabled={working} onClick={() => setProposal(undefined)}>保留原文</CreativeButton><CreativeButton variant="primary" disabled={working || dirty} onClick={() => void apply()}><Check size={14} />应用修改</CreativeButton></div></section>}
    </div>}
  </div>;
}
