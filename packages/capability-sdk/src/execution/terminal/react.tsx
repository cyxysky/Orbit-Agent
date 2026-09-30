'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MoreHorizontal, Pencil, Plus, Power, SquareTerminal, StopCircle, Trash2, X } from 'lucide-react';
import type { Terminal as XTerminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalSummary, TerminalToolInput } from './index.ts';
import type { TerminalClient, TerminalConnection } from './client.ts';
import { terminalStyles } from './styles.ts';
const identity = (text: string) => text;

type TerminalView = { terminal: XTerminal; fit: FitAddon; element: HTMLDivElement };
type BufferState = { output: string; cursor: number };

function TerminalListItem({ item, selected, disabled, onSelect, onAction, translate: t }: {
  item: TerminalSummary; selected: boolean; disabled: boolean; onSelect: () => void;
  onAction: (input: TerminalToolInput) => void; translate: (text: string) => string;
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
  return <div className={`cap-terminal-item${selected ? ' is-selected' : ''}`}>
    <SquareTerminal size={15} className="cap-terminal-item-icon" />
    {editing ? <input className="cap-terminal-rename" autoFocus aria-label={t('重命名终端')} value={draft} maxLength={100}
      onFocus={event => event.currentTarget.select()} onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); cancelEdit.current = event.key === 'Escape'; event.currentTarget.blur();
        }
      }} onBlur={() => {
        if (!cancelEdit.current && draft.trim() && draft.trim() !== item.name) onAction({ action: 'rename', reason: '用户重命名终端', terminalId: item.terminalId, name: draft.trim() });
        cancelEdit.current = false; setEditing(false);
      }} /> : <button type="button" className="cap-terminal-item-select" aria-pressed={selected} title={`${item.shell} · ${status}\n${item.cwd}`}
        onClick={onSelect} onDoubleClick={rename} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); rename(); } }}>{item.name}</button>}
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
      <button type="button" role="menuitem" disabled={disabled} onClick={rename}><Pencil size={14} />{t('重命名')}<kbd>F2</kbd></button>
      <button type="button" role="menuitem" disabled={disabled || item.status !== 'running'} onClick={() => action('interrupt', '用户中断命令')}><StopCircle size={14} />{t('中断命令')}</button>
      <button type="button" role="menuitem" disabled={disabled || item.status === 'closed'} onClick={() => action('close', '用户关闭终端')}><Power size={14} />{t('关闭终端')}</button>
      <button type="button" role="menuitem" className="cap-terminal-delete" disabled={disabled} onClick={() => action('delete', '用户删除终端')}><Trash2 size={14} />{t('删除终端')}</button>
    </div>
  </div>;
}

export function TerminalWorkspace({ client, onClose, closed = false, translate: t = identity }: { client: TerminalClient; onClose: () => void; closed?: boolean; translate?: (text: string) => string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); dialog.current?.focus({ preventScroll: true }); }, []);
  const [terminals, setTerminals] = useState<TerminalSummary[]>([]);
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
  const selected = terminals.find(item => item.terminalId === selectedId) || terminals[0];

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
          if (view) { view.terminal.reset(); view.terminal.write(row.output || ''); }
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
      terminal.onData(input => {
        // The client coalesces input per terminal while preserving its order.
        void send({ action: 'write', reason: '用户终端输入', terminalId: id, input }).catch(reason => {
          if (!(reason instanceof Error && reason.name === 'AbortError')) setError(String(reason));
        });
      });
      terminal.write(buffers.current.get(id)?.output || '');
      view = { terminal, fit, element }; views.current.set(id, view);
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
  return <dialog ref={dialog} tabIndex={-1} className="cap-terminal-dialog" aria-label={t('对话终端')} onCancel={event => event.preventDefault()}>
    <style>{terminalStyles}</style>
      <header className="cap-terminal-header">
        <div className="cap-terminal-heading"><span className="cap-terminal-heading-icon"><SquareTerminal size={18} /></span><div className="cap-terminal-heading-copy"><h2>{t('对话终端')}</h2><p><span className="cap-terminal-context">{t('当前对话的工作空间')}</span><span className="cap-terminal-count">{enabled === undefined ? '…' : terminals.length} {t('个终端')}</span></p></div></div>
        <span className="cap-terminal-connection" data-status={connection.status} role="status" aria-label={connectionLabel} title={connectionLabel}>{connection.status === 'connecting' || connection.status === 'reconnecting' ? <Loader2 size={13} className="cap-terminal-spin" /> : <i />}</span>
        <button type="button" className="cap-terminal-icon cap-terminal-dismiss" aria-label={t('收起终端')} onClick={() => onClose()}><X size={18} /></button>
      </header>
      <div className="cap-terminal-body">
        {(error || connection.error) && <div className="cap-terminal-error" role="alert"><span>{error || connection.error}</span>{!connected && <button type="button" onClick={() => setStreamVersion(value => value + 1)}>{t('重新连接')}</button>}</div>}
        <div className="cap-terminal-layout">
          <aside className="cap-terminal-sidebar">
            <div className="cap-terminal-sidebar-top"><button type="button" className="cap-terminal-new" aria-expanded={creating} disabled={!!pending || !enabled || !connected || closed} onClick={() => { setCreating(value => !value); setName(''); setCwd(''); }}>{creating ? <X size={15} /> : <Plus size={15} />}{t(creating ? '取消新建' : '新建终端')}</button></div>
            {creating && <form className="cap-terminal-create" onSubmit={event => {
              event.preventDefault(); void act({ action: 'create', reason: '用户新建终端', ...(name.trim() ? { name: name.trim() } : {}), ...(cwd.trim() ? { cwd: cwd.trim() } : {}) });
            }}>
              <input aria-label={t('终端名称')} placeholder={t('终端名称（可选）')} value={name} onChange={event => setName(event.target.value)} />
              <input aria-label={t('工作目录')} placeholder={t('工作目录（默认使用配置目录）')} value={cwd} onChange={event => setCwd(event.target.value)} />
              <button className="cap-terminal-new" type="submit" disabled={!!pending}>{pending === 'create' ? <Loader2 size={15} className="cap-terminal-spin" /> : <Plus size={15} />}{t('创建')}</button>
            </form>}
            <nav className="cap-terminal-list" aria-label={t('终端列表')}>
              {terminals.map(item => <TerminalListItem key={item.terminalId} item={item} selected={selected?.terminalId === item.terminalId} disabled={!!pending || !connected}
                onSelect={() => setSelectedId(item.terminalId)} onAction={input => void act(input)} translate={t} />)}
              {!terminals.length && <p>{t('暂无终端')}</p>}
            </nav>
          </aside>
          <section className="cap-terminal-main">
            {selected ? <div className="cap-terminal-viewport" ref={setViewport} onClick={() => views.current.get(selected.terminalId)?.terminal.focus()} /> : <div className="cap-terminal-empty"><SquareTerminal size={32} /><strong>{t(connection.status === 'error' ? '终端连接失败' : '打开一个终端开始工作')}</strong><p>{t(enabled === undefined ? connected ? '正在读取终端信息…' : '连接后将显示当前对话的终端' : !enabled ? '请在运行设置中启用本地终端' : 'Agent 创建的终端也会显示在这里')}</p></div>}
          </section>
        </div>
      </div>
    </dialog>;
}

