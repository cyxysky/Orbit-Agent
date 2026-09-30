'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, Plus, Power, SquareTerminal, StopCircle, Trash2, X } from 'lucide-react';
import type { Terminal as XTerminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalSummary, TerminalToolInput } from './index.ts';
import type { TerminalClient, TerminalConnection } from './client.ts';
import { terminalStyles } from './styles.ts';
const identity = (text: string) => text;

type TerminalView = { terminal: XTerminal; fit: FitAddon; element: HTMLDivElement };
type BufferState = { output: string; cursor: number };
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
  const [rename, setRename] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [streamVersion, setStreamVersion] = useState(0);
  const buffers = useRef(new Map<string, BufferState>());
  const views = useRef(new Map<string, TerminalView>());
  const modules = useRef<{ Terminal: typeof XTerminal; FitAddon: typeof FitAddon } | null>(null);
  const cancelRename = useRef(false);
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
  useEffect(() => { setRename(selected?.name || ''); setRenaming(false); }, [selected?.terminalId, selected?.name]);

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
        void send({ action: 'write', reason: '用户终端输入', terminalId: id, input }).catch(reason => setError(String(reason)));
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
      if (data.terminal) { setSelectedId(data.terminal.terminalId); setCreating(false); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(''); }
  }
  const status = (item: TerminalSummary) => t(item.status === 'ready' ? '就绪' : item.status === 'running' ? '运行中' : item.status === 'starting' ? '启动中' : '已关闭');
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
              {terminals.map(item => <div key={item.terminalId} className={`cap-terminal-item${selected?.terminalId === item.terminalId ? ' is-selected' : ''}`}>
                <button type="button" className="cap-terminal-item-select" aria-pressed={selected?.terminalId === item.terminalId} title={item.cwd} onClick={() => setSelectedId(item.terminalId)} onDoubleClick={() => { setRename(item.name); setRenaming(true); }} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); setRenaming(true); } }}>
                  <span className="cap-terminal-item-icon"><SquareTerminal size={16} /></span><span className="cap-terminal-item-copy"><strong>{item.name}</strong><small>{item.shell}<span>{status(item)}</span></small></span><i className="cap-terminal-state-dot" data-status={item.status} />
                </button>
                {selected?.terminalId === item.terminalId && <>
                  {renaming && <input className="cap-terminal-rename" autoFocus aria-label={t('重命名终端')} value={rename} maxLength={100} onFocus={event => event.currentTarget.select()} onChange={event => setRename(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelRename.current = true; event.currentTarget.blur(); } }}
                    onBlur={() => {
                      if (!cancelRename.current && rename.trim() && rename.trim() !== item.name) void act({ action: 'rename', reason: '用户重命名终端', terminalId: item.terminalId, name: rename.trim() });
                      else setRename(item.name);
                      cancelRename.current = false; setRenaming(false);
                    }} />}
                  <div className="cap-terminal-item-actions" role="group" aria-label={t('终端操作')}>
                    <button type="button" className="cap-terminal-icon" disabled={!!pending || !connected} aria-label={t('重命名终端')} title={t('重命名终端（F2）')} onClick={() => { setRename(item.name); setRenaming(true); }}><Pencil size={14} /></button>
                    <button type="button" className="cap-terminal-icon" disabled={!!pending || !connected || item.status !== 'running'} aria-label={t('中断当前命令')} title={t('中断当前命令（Ctrl+C）')} onClick={() => void act({ action: 'interrupt', reason: '用户中断命令', terminalId: item.terminalId })}><StopCircle size={15} /></button>
                    <button type="button" className="cap-terminal-icon" disabled={!!pending || !connected || item.status === 'closed'} aria-label={t('关闭终端')} title={t('关闭终端，保留输出')} onClick={() => void act({ action: 'close', reason: '用户关闭终端', terminalId: item.terminalId })}><Power size={15} /></button>
                    <button type="button" className="cap-terminal-icon cap-terminal-delete" disabled={!!pending || !connected} aria-label={t('删除终端')} title={t('删除终端')} onClick={() => void act({ action: 'delete', reason: '用户删除终端', terminalId: item.terminalId })}><Trash2 size={15} /></button>
                  </div>
                </>}
              </div>)}
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

