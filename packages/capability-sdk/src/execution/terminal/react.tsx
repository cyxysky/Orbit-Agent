'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderOpen, GripVertical, Loader2, MoreHorizontal, Pencil, Plus, Power, SquareTerminal, StopCircle, Trash2, X } from 'lucide-react';
import type { Terminal as XTerminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalSummary, TerminalToolInput } from './index.ts';
import type { TerminalClient, TerminalConnection } from './client.ts';
import { terminalStyles } from './styles.ts';
import { FloatingWindow } from '../../ui/floating-window.tsx';
const identity = (text: string) => text;

type TerminalView = { terminal: XTerminal; fit: FitAddon; element: HTMLDivElement; pendingReplays: number };
type BufferState = { output: string; cursor: number };

function restoreTerminal(view: TerminalView, output: string) {
  // Replayed device queries must not send stale replies to the current prompt.
  view.pendingReplays++;
  view.terminal.reset();
  view.terminal.write(output, () => { view.pendingReplays--; });
}

function TerminalListItem({ item, selected, disabled, onSelect, onAction, onMove, dragProps, dragging, dropPosition, translate: t }: {
  item: TerminalSummary; selected: boolean; disabled: boolean; onSelect: () => void;
  onAction: (input: TerminalToolInput) => void; translate: (text: string) => string;
  onMove: (direction: -1 | 1) => void; dragging: boolean; dropPosition?: 'before' | 'after';
  dragProps: Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onClickCapture'>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancelEdit = useRef(false);
  const status = t(item.status === 'ready' ? '就绪' : item.status === 'running' ? '运行中' : item.status === 'starting' ? '启动中' : '已关闭');
  const rename = () => { if (disabled) return; menu.current?.hidePopover(); onSelect(); setDraft(item.name); setEditing(true); };
  const action = (action: 'interrupt' | 'close' | 'delete', reason: string) => {
    menu.current?.hidePopover(); onAction({ action, reason, terminalId: item.terminalId });
  };
  return <div className={`cap-terminal-item${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}`} data-terminal-id={item.terminalId} data-reorderable={!editing || undefined} data-drop-position={dropPosition} {...(editing ? {} : dragProps)}>
    <span className="cap-terminal-item-grip" aria-hidden="true"><SquareTerminal size={15} className="cap-terminal-item-icon" /><GripVertical size={15} className="cap-terminal-drag-icon" /></span>
    {editing ? <input className="cap-terminal-rename" autoFocus aria-label={t('重命名终端')} value={draft} maxLength={100}
      onFocus={event => event.currentTarget.select()} onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); cancelEdit.current = event.key === 'Escape'; event.currentTarget.blur();
        }
      }} onBlur={() => {
        if (!cancelEdit.current && draft.trim() && draft.trim() !== item.name) onAction({ action: 'rename', reason: '用户重命名终端', terminalId: item.terminalId, name: draft.trim() });
        cancelEdit.current = false; setEditing(false);
      }} /> : <button type="button" className="cap-terminal-item-select" aria-pressed={selected} title={`${item.shell} · ${status}\n${item.cwd}\n${t('拖动调整终端顺序')}`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        onClick={onSelect} onDoubleClick={rename} onKeyDown={event => {
          if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); onMove(event.key === 'ArrowUp' ? -1 : 1); }
          if (event.key === 'F2') { event.preventDefault(); rename(); }
        }}>{item.name}</button>}
    <i className="cap-terminal-state-dot" data-status={item.status} aria-label={status} title={status} />
    <button ref={trigger} type="button" className="cap-terminal-icon cap-terminal-more" aria-label={`${item.name} · ${t('终端操作')}`} aria-haspopup="menu" aria-expanded={menuOpen}
      onClick={() => {
        if (menu.current?.matches(':popover-open')) { menu.current.hidePopover(); return; }
        const popup = menu.current, button = trigger.current;
        if (!popup || !button) return;
        const rect = button.getBoundingClientRect();
        popup.showPopover();
        popup.style.left = `${Math.max(8, Math.min(rect.right - popup.offsetWidth, window.innerWidth - popup.offsetWidth - 8))}px`;
        popup.style.top = `${Math.max(8, rect.bottom + popup.offsetHeight + 8 > window.innerHeight ? rect.top - popup.offsetHeight - 5 : rect.bottom + 5)}px`;
        popup.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      }}><MoreHorizontal size={16} /></button>
    <div ref={menu} popover="auto" className="cap-terminal-menu" role="menu" aria-label={t('终端操作')} onToggle={event => setMenuOpen(event.newState === 'open')}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.current?.hidePopover(); trigger.current?.focus(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      <button type="button" role="menuitem" disabled={disabled} onClick={rename}><Pencil size={14} /><span>{t('重命名')}</span><kbd>F2</kbd></button>
      <button type="button" role="menuitem" disabled={disabled || item.status !== 'running'} onClick={() => action('interrupt', '用户中断命令')}><StopCircle size={14} /><span>{t('中断命令')}</span></button>
      <button type="button" role="menuitem" disabled={disabled || item.status === 'closed'} onClick={() => action('close', '用户关闭终端')}><Power size={14} /><span>{t('关闭终端')}</span></button>
      <button type="button" role="menuitem" className="cap-terminal-delete" disabled={disabled} onClick={() => action('delete', '用户删除终端')}><Trash2 size={14} /><span>{t('删除终端')}</span></button>
    </div>
  </div>;
}

export function TerminalWorkspace({ client, onClose, closed = false, orderStorageKey, translate: t = identity }: { client: TerminalClient; onClose: () => void; closed?: boolean; orderStorageKey?: string; translate?: (text: string) => string }) {
  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
  const [terminalOrder, setTerminalOrder] = useState<string[]>([]);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number; width: number; height: number }>();
  const draggedId = dragPreview?.id || '';
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' }>();
  const dragGesture = useRef<{ id: string; pointerId: number; x: number; y: number; left: number; top: number; width: number; height: number; active: boolean; target?: { id: string; position: 'before' | 'after' } } | null>(null);
  const suppressDragClick = useRef(false);
  useEffect(() => {
    if (!draggedId) return;
    const cancel = () => {
      dragGesture.current = null; setDragPreview(undefined); setDropTarget(undefined);
      suppressDragClick.current = true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('blur', cancel); };
  }, [draggedId]);
  useEffect(() => {
    let order: string[] = [];
    try {
      const saved: unknown = orderStorageKey && JSON.parse(localStorage.getItem(orderStorageKey) || '[]');
      if (Array.isArray(saved) && saved.every(id => typeof id === 'string')) order = saved.slice(0, 64);
    } catch { /* Storage may be unavailable; in-memory sorting still works. */ }
    setTerminalOrder(order);
  }, [orderStorageKey]);
  const orderedTerminals = useMemo(() => {
    const ranks = new Map(terminalOrder.map((id, index) => [id, index]));
    return [...terminals].sort((a, b) => (ranks.get(a.terminalId) ?? ranks.size) - (ranks.get(b.terminalId) ?? ranks.size));
  }, [terminals, terminalOrder]);
  const [selectedId, setSelectedId] = useState('');
  const [enabled, setEnabled] = useState<boolean>();
  const [connection, setConnection] = useState<TerminalConnection>({ status: 'connecting' });
  const connected = connection.status === 'connected';
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [streamVersion, setStreamVersion] = useState(0);
  const buffers = useRef(new Map<string, BufferState>());
  const views = useRef(new Map<string, TerminalView>());
  const modules = useRef<{ Terminal: typeof XTerminal; FitAddon: typeof FitAddon } | null>(null);
  const inputAllowed = useRef(false); inputAllowed.current = Boolean(enabled) && !closed && connected;
  const selected = orderedTerminals.find(item => item.terminalId === selectedId) || orderedTerminals[0];
  const draggedTerminal = terminals.find(item => item.terminalId === draggedId);

  function reorder(id: string, targetId: string, position: 'before' | 'after') {
    if (id === targetId || !terminals.some(item => item.terminalId === id)) return;
    const order = orderedTerminals.map(item => item.terminalId).filter(value => value !== id);
    const target = order.indexOf(targetId);
    if (target < 0) return;
    order.splice(target + (position === 'after' ? 1 : 0), 0, id);
    if (selected) setSelectedId(selected.terminalId);
    setTerminalOrder(order);
    try { if (orderStorageKey) localStorage.setItem(orderStorageKey, JSON.stringify(order)); }
    catch { /* Keep the new order for this open workspace. */ }
  }

  function startDrag(event: PointerEvent<HTMLDivElement>, id: string) {
    if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest('input, .cap-terminal-menu, .cap-terminal-more')) return;
    suppressDragClick.current = false;
    event.target.setPointerCapture(event.pointerId);
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    dragGesture.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left, top, width, height, active: false };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.active && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 5) return;
    event.preventDefault();
    gesture.active = true;
    setDragPreview({ id: gesture.id, x: gesture.left + event.clientX - gesture.x, y: gesture.top + event.clientY - gesture.y, width: gesture.width, height: gesture.height });
    const list = event.currentTarget.parentElement!;
    const horizontal = getComputedStyle(list).display === 'flex';
    const bounds = list.getBoundingClientRect();
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    let target: typeof gesture.target;
    if (inside) {
      const offset = horizontal ? event.clientX - bounds.left : event.clientY - bounds.top;
      const length = horizontal ? bounds.width : bounds.height;
      const scroll = offset < 24 ? -12 : offset > length - 24 ? 12 : 0;
      if (horizontal) list.scrollLeft += scroll; else list.scrollTop += scroll;
      for (const row of list.querySelectorAll<HTMLElement>('[data-terminal-id]')) {
        const rect = row.getBoundingClientRect();
        const coordinate = horizontal ? event.clientX : event.clientY;
        const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
        target = { id: row.dataset.terminalId!, position: coordinate < middle ? 'before' : 'after' };
        if (coordinate < middle) break;
      }
      if (target?.id === gesture.id) target = undefined;
    }
    gesture.target = target;
    setDropTarget(target);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.active && event.type === 'pointerup') {
      suppressDragClick.current = true;
      if (gesture.target) reorder(gesture.id, gesture.target.id, gesture.target.position);
    }
    dragGesture.current = null; setDragPreview(undefined); setDropTarget(undefined);
  }

  const send = useCallback((input: TerminalToolInput) => client.execute(input), [client]);

  useEffect(() => {
    let disposed = false;
    const mountedViews = views.current, retainedBuffers = buffers.current;
    setReady(false); setError('');
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([terminal, fit]) => {
      if (!disposed) { modules.current = { Terminal: terminal.Terminal, FitAddon: fit.FitAddon }; setReady(true); }
    }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => {
      disposed = true; modules.current = null;
      for (const view of mountedViews.values()) view.terminal.dispose();
      mountedViews.clear(); retainedBuffers.clear();
    };
  }, []);

  useEffect(() => {
    setConnection({ status: 'connecting' });
    return client.subscribe(event => {
      if (event.type === 'snapshot') {
        const current = event.terminals.flatMap(row => row.terminal ? [row.terminal] : []);
        setEnabled(event.enabled); setTerminals(current);
        const ids = new Set(current.map(item => item.terminalId));
        for (const [id, view] of views.current) if (!ids.has(id)) { view.terminal.dispose(); views.current.delete(id); }
        buffers.current.clear();
        for (const row of event.terminals) {
          if (!row.terminal) continue;
          buffers.current.set(row.terminal.terminalId, { output: row.output || '', cursor: row.cursor || 0 });
          const view = views.current.get(row.terminal.terminalId);
          if (view) restoreTerminal(view, row.output || '');
        }
      } else if (event.type === 'reset') {
        setTerminals([]); setStreamVersion(value => value + 1);
      } else if (event.type === 'state') {
        setTerminals(current => [...current.filter(item => item.terminalId !== event.terminal.terminalId), event.terminal]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      } else if (event.type === 'deleted') {
        setTerminals(current => current.filter(item => item.terminalId !== event.terminalId));
        views.current.get(event.terminalId)?.terminal.dispose(); views.current.delete(event.terminalId); buffers.current.delete(event.terminalId);
      } else if (event.type === 'output') {
        const previous = buffers.current.get(event.terminalId) || { output: '', cursor: 0 };
        if (event.startCursor > previous.cursor) { setStreamVersion(value => value + 1); return; }
        if (event.cursor <= previous.cursor) return;
        const output = event.output.slice(previous.cursor - event.startCursor);
        buffers.current.set(event.terminalId, { output: (previous.output + output).slice(-500000), cursor: event.cursor });
        views.current.get(event.terminalId)?.terminal.write(output);
      }
    }, setConnection);
  }, [client, streamVersion]);

  const selectedRef = useRef(selected); selectedRef.current = selected;
  useEffect(() => {
    const view = selected && views.current.get(selected.terminalId);
    if (view) view.terminal.options.disableStdin = !enabled || !connected || closed || selected?.status === 'closed' || selected?.status === 'starting';
  }, [selected, enabled, connected, closed, ready]);

  useEffect(() => {
    const selected = selectedRef.current;
    if (!ready || !viewport || !selected || !modules.current) return;
    const id = selected.terminalId;
    let view = views.current.get(id);
    if (!view) {
      const terminal = new modules.current.Terminal({
        cols: selected.cols, rows: selected.rows, cursorBlink: true, scrollback: 5000, smoothScrollDuration: 0,
        fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13,
        theme: { background: '#131917', foreground: '#d7e4db', cursor: '#9cddb8', selectionBackground: '#355747', scrollbarSliderBackground: '#ffffff18', scrollbarSliderHoverBackground: '#ffffff28' },
        allowProposedApi: false,
      });
      const fit = new modules.current.FitAddon(); terminal.loadAddon(fit);
      const element = document.createElement('div'); element.className = 'cap-terminal-emulator';
      viewport.replaceChildren(element); terminal.open(element);
      const createdView: TerminalView = { terminal, fit, element, pendingReplays: 0 };
      terminal.onData(input => {
        if (createdView.pendingReplays || !inputAllowed.current) return;
        // The client coalesces input per terminal while preserving its order.
        void send({ action: 'write', reason: '用户终端输入', terminalId: id, input }).catch(reason => {
          if (!(reason instanceof Error && reason.name === 'AbortError')) setError(String(reason));
        });
      });
      restoreTerminal(createdView, buffers.current.get(id)?.output || '');
      view = createdView; views.current.set(id, view);
    } else viewport.replaceChildren(view.element);
    const currentView = view;
    currentView.terminal.options.disableStdin = !inputAllowed.current || selected.status === 'closed' || selected.status === 'starting';
    let frame = 0;
    const fit = () => {
      if (!viewport.clientWidth || !viewport.clientHeight) return;
      const previous = `${currentView.terminal.cols}:${currentView.terminal.rows}`;
      currentView.fit.fit();
      if (selectedRef.current?.status !== 'closed' && previous !== `${currentView.terminal.cols}:${currentView.terminal.rows}`) {
        void send({ action: 'resize', reason: '适应终端窗口', terminalId: id, cols: currentView.terminal.cols, rows: currentView.terminal.rows }).catch(reason => setError(String(reason)));
      }
    };
    const scheduleFit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    const observer = new ResizeObserver(scheduleFit); observer.observe(viewport);
    frame = requestAnimationFrame(() => { fit(); currentView.terminal.focus(); });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [ready, viewport, selected?.terminalId, send]);

  async function act(input: TerminalToolInput) {
    setPending(input.action); setError('');
    try {
      const data = await send(input);
      if (data.terminal && input.action === 'create') { setSelectedId(data.terminal.terminalId); setCreating(false); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(''); }
  }
  const connectionLabel = t(connected ? '实时连接' : connection.status === 'error' ? '连接失败' : connection.status === 'reconnecting' ? '正在重连…' : '正在连接…');
  const createDisabled = !!pending || !enabled || !connected || closed;
  return <FloatingWindow title={t('对话终端')} className="cap-terminal-dialog" onClose={onClose} titleExtra={<>
    <span className="cap-terminal-count">{enabled === undefined ? '…' : terminals.length} {t('个终端')}</span>
    <span className="cap-terminal-connection" data-status={connection.status} role="status" aria-label={connectionLabel} title={connectionLabel}>{connection.status === 'connecting' || connection.status === 'reconnecting' ? <Loader2 size={13} className="cap-terminal-spin" /> : <i />}</span>
  </>}>
    <style>{terminalStyles}</style>
    {dragPreview && draggedTerminal && createPortal(<div className="cap-terminal-drag-preview" aria-hidden="true"
      style={{ left: dragPreview.x, top: dragPreview.y, width: dragPreview.width, height: dragPreview.height }}>
      <GripVertical size={15} /><span>{draggedTerminal.name}</span><i className="cap-terminal-state-dot" data-status={draggedTerminal.status} />
    </div>, document.body)}
      <div className="cap-terminal-body">
        {(error || connection.error) && <div className="cap-terminal-error" role="alert"><span>{error || connection.error}</span>{!connected && <button type="button" onClick={() => setStreamVersion(value => value + 1)}>{t('重新连接')}</button>}</div>}
        <div className="cap-terminal-layout">
          <aside className="cap-terminal-sidebar">
            <div className="cap-terminal-sidebar-top"><span>{t('终端列表')}</span><button type="button" className="cap-terminal-icon" aria-label={t(creating ? '取消新建' : '新建终端')} title={t(creating ? '取消新建' : '新建终端')} aria-expanded={creating} disabled={createDisabled} onClick={() => { setCreating(value => !value); setName(''); setCwd(''); }}>{creating ? <X size={15} /> : <Plus size={15} />}</button></div>
            {creating && <form className="cap-terminal-create" onKeyDown={event => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setCreating(false); }
            }} onSubmit={event => {
              if (createDisabled) { event.preventDefault(); return; }
              event.preventDefault(); void act({ action: 'create', reason: '用户新建终端', ...(name.trim() ? { name: name.trim() } : {}), ...(cwd.trim() ? { cwd: cwd.trim() } : {}) });
            }}>
              <div className="cap-terminal-create-name"><input autoFocus aria-label={t('终端名称')} placeholder={t('终端名称（可选）')} value={name} maxLength={100} disabled={!!pending} onChange={event => setName(event.target.value)} />
                <button className="cap-terminal-create-submit" type="submit" aria-label={t('创建')} title={t('创建')} disabled={createDisabled}><span aria-hidden="true">{pending === 'create' ? <Loader2 size={14} className="cap-terminal-spin" /> : <Check size={14} />}</span></button>
              </div>
              <label className="cap-terminal-create-directory" title={t('工作目录（默认使用配置目录）')}><FolderOpen size={13} aria-hidden="true" /><input aria-label={t('工作目录')} placeholder={t('工作目录（默认使用配置目录）')} value={cwd} disabled={!!pending} onChange={event => setCwd(event.target.value)} /></label>
            </form>}
            <nav className="cap-terminal-list" aria-label={t('终端列表')} data-reordering={!!draggedId || undefined}>
              {orderedTerminals.map((item, index) => <TerminalListItem key={item.terminalId} item={item} selected={selected?.terminalId === item.terminalId} disabled={!!pending || !connected}
                dragging={draggedId === item.terminalId} dropPosition={dropTarget?.id === item.terminalId ? dropTarget.position : undefined}
                onMove={direction => { const target = orderedTerminals[index + direction]; if (target) reorder(item.terminalId, target.terminalId, direction < 0 ? 'before' : 'after'); }}
                dragProps={{
                  onPointerDown: event => startDrag(event, item.terminalId), onPointerMove: moveDrag, onPointerUp: finishDrag,
                  onPointerCancel: finishDrag, onLostPointerCapture: finishDrag,
                  onClickCapture: event => { if (suppressDragClick.current) { event.preventDefault(); event.stopPropagation(); suppressDragClick.current = false; } },
                }} onSelect={() => setSelectedId(item.terminalId)} onAction={input => void act(input)} translate={t} />)}
              {!terminals.length && <p>{t('暂无终端')}</p>}
            </nav>
          </aside>
          <section className="cap-terminal-main">
            {/* xterm owns the viewport DOM; never reuse it for React's empty state. */}
            {selected ? <div key="viewport" className="cap-terminal-viewport" ref={setViewport} onClick={() => views.current.get(selected.terminalId)?.terminal.focus()} /> : <div key="empty" className="cap-terminal-empty"><SquareTerminal size={32} /><strong>{t(connection.status === 'error' ? '终端连接失败' : '打开一个终端开始工作')}</strong><p>{t(enabled === undefined ? connected ? '正在读取终端信息…' : '连接后将显示当前对话的终端' : !enabled ? '请在运行设置中启用本地终端' : 'Agent 创建的终端也会显示在这里')}</p></div>}
          </section>
        </div>
      </div>
    </FloatingWindow>;
}

