'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, MainMenu, exportToBlob, exportToSvg, restoreElements, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { normalizeChartUpdate, normalizeExcalidrawOption } from './core.ts';
import type { ChartRendererProps } from './react.tsx';
import { defaultChartTranslate } from './i18n.ts';
import { ChartIcon } from './icons.tsx';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExcalidrawView({ chart, classNames = {}, onSave, onReload, translate: t = defaultChartTranslate, excalidraw }: ChartRendererProps) {
  const [current, setCurrent] = useState(chart);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const downloadMenu = useRef<HTMLDetailsElement | null>(null);
  // Preserve the base revision and scene while the user edits, even if props refresh.
  if (!editing && !saving && (chart.chartId !== current.chartId || (chart.revision || 0) > (current.revision || 0))) {
    setCurrent(chart); setGeneration((value) => value + 1);
  }
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === root.current);
    const close = (event: PointerEvent) => {
      if (downloadMenu.current?.open && event.target instanceof Node && !downloadMenu.current.contains(event.target)) downloadMenu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && downloadMenu.current?.open) downloadMenu.current.open = false; };
    document.addEventListener('fullscreenchange', changed); document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('fullscreenchange', changed); document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  const initialData = useMemo((): ExcalidrawInitialDataState => {
    const scene = normalizeExcalidrawOption(current.option);
    return {
      elements: restoreElements(scene.elements as unknown as Parameters<typeof restoreElements>[0], null, { repairBindings: true, refreshDimensions: true }),
      appState: scene.appState,
      files: scene.files as ExcalidrawInitialDataState['files'],
      scrollToContent: true,
    };
  }, [current]);
  const name = (current.title || current.chartId).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
  function act(task: () => void | Promise<void>) {
    setError('');
    if (downloadMenu.current) downloadMenu.current.open = false;
    void Promise.resolve().then(task).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }
  function snapshot() {
    if (!api.current) throw new Error(t('画布尚未就绪。'));
    return { elements: api.current.getSceneElements(), appState: api.current.getAppState(), files: api.current.getFiles() };
  }
  async function save() {
    const next = normalizeChartUpdate(current, { option: normalizeExcalidrawOption(snapshot()) });
    setSaving(true);
    try {
      const saved = onSave ? await onSave(next, current.revision || 0) : next;
      setCurrent(saved); setEditing(false); setGeneration((value) => value + 1);
      setNotice(onSave ? t('已保存') : t('已在当前页面应用；请导出文件保存。'));
    } finally { setSaving(false); }
  }
  return <figure ref={root} className={`capability-excalidraw ${classNames.root || ''}`} data-chart-id={current.chartId} data-chart-engine="excalidraw" aria-label={current.description || current.title || current.chartId}>
    <style>{`
      .capability-excalidraw.capability-excalidraw{display:block;min-width:0;margin:12px 0;padding:0;overflow:hidden;border:1px solid var(--border,#e4e7ec);border-radius:14px;background:var(--panel,#fff);color:var(--foreground,#263247)}
      .capability-excalidraw:fullscreen{display:flex;flex-direction:column;height:100%;width:100%;border-radius:0}
      .capability-excalidraw:fullscreen>.capability-excalidraw-canvas{flex:1;height:auto!important}
      .capability-excalidraw-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;border-bottom:1px solid var(--border,#edf0f3)}
      .capability-excalidraw-title{flex:1;min-width:120px;font-size:14px;font-weight:600;overflow-wrap:anywhere}
      .capability-excalidraw-actions{display:flex;align-items:center;gap:4px;margin-left:auto;flex-wrap:wrap}
      .capability-excalidraw-toolbar :is(button,summary){box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;width:32px;height:32px;margin:0;border:0;border-radius:7px;padding:0;background:transparent;color:inherit;cursor:pointer;font:500 12px/1.4 system-ui,sans-serif;white-space:nowrap}
      .capability-excalidraw-toolbar :is(button,summary):hover{background:var(--panel-soft,#f3f5f8)}
      .capability-excalidraw-toolbar .capability-chart-icon-slot{display:inline-flex;flex:none;line-height:0}
      .capability-excalidraw-toolbar .capability-chart-icon{display:block;width:16px;height:16px;min-width:16px}
      .capability-excalidraw-toolbar button:disabled{opacity:.5;cursor:default}
      .capability-excalidraw-toolbar :is(button,summary):focus-visible{outline:2px solid var(--accent,#5477ed);outline-offset:2px}
      .capability-excalidraw-download{position:relative;z-index:5}
      .capability-excalidraw-download summary{list-style:none}
      .capability-excalidraw-download summary::-webkit-details-marker{display:none}
      .capability-excalidraw-download-menu{position:absolute;top:calc(100% + 6px);right:0;display:grid;width:185px;padding:5px;background:var(--panel,#fff);border:1px solid var(--border,#e4e7ec);border-radius:9px;box-shadow:0 8px 28px #0002}
      .capability-excalidraw-download-menu button{justify-content:flex-start;width:100%;height:36px;padding:0 9px}
      .capability-excalidraw-message{padding:8px 14px;margin:0;font-size:13px}
      .capability-excalidraw-canvas{position:relative;min-height:240px;container-type:inline-size}
      .capability-excalidraw .excalidraw .main-menu-trigger ~ .dropdown-menu:not(.dropdown-menu--mobile){width:max-content;min-width:min(240px,calc(100cqw - 32px));max-width:calc(100cqw - 32px)}
      .capability-excalidraw .excalidraw .dropdown-menu-item__shortcut{flex-shrink:0;white-space:nowrap}
    `}</style>
    <figcaption className="capability-excalidraw-toolbar">
      <strong className="capability-excalidraw-title">{current.title || t('画布')}</strong>
      <div className="capability-excalidraw-actions" role="group" aria-label={t('画布操作')}>
      {editing ? <>
        <button type="button" disabled={saving} aria-busy={saving} title={saving ? t('保存中…') : t('保存')} aria-label={saving ? t('保存中…') : t('保存')} onClick={() => act(save)}><ChartIcon name="check" /></button>
        <button type="button" disabled={saving} title={t('取消编辑')} aria-label={t('取消编辑')} onClick={() => { setEditing(false); setCurrent(chart); setGeneration((value) => value + 1); setError(''); }}><ChartIcon name="close" /></button>
      </> : <button type="button" title={t('编辑')} aria-label={t('编辑')} onClick={() => { setEditing(true); setNotice(''); }}><ChartIcon name="edit" /></button>}
      {onReload && <button type="button" title={editing ? t('放弃修改并重新加载') : t('重新加载')} aria-label={editing ? t('放弃修改并重新加载') : t('重新加载')} disabled={saving} onClick={() => act(async () => {
        setSaving(true);
        try { setCurrent(await onReload()); setEditing(false); setGeneration((value) => value + 1); setNotice(''); }
        finally { setSaving(false); }
      })}><ChartIcon name="refresh" /></button>}
      <details ref={downloadMenu} className="capability-excalidraw-download">
      <summary title={t('导出画布')} aria-label={t('导出画布')}><ChartIcon name="download" /></summary>
      <div className="capability-excalidraw-download-menu">
      <button type="button" onClick={() => act(() => {
        const scene = snapshot();
        download(new Blob([serializeAsJSON(scene.elements, scene.appState, scene.files, 'local')], { type: 'application/json' }), `${name}.excalidraw`);
      })}><ChartIcon name="code" />Excalidraw</button>
      <button type="button" onClick={() => act(async () => download(await exportToBlob({ ...snapshot(), mimeType: 'image/png' }), `${name}.png`))}><ChartIcon name="image" />PNG</button>
      <button type="button" onClick={() => act(async () => download(new Blob([(await exportToSvg(snapshot())).outerHTML], { type: 'image/svg+xml' }), `${name}.svg`))}><ChartIcon name="image" />SVG</button>
      </div></details>
      <button type="button" title={fullscreen ? t('退出全屏') : t('全屏')} aria-label={fullscreen ? t('退出全屏') : t('全屏')} onClick={() => act(async () => {
        if (document.fullscreenElement === root.current) await document.exitFullscreen();
        else await root.current?.requestFullscreen();
      })}><ChartIcon name={fullscreen ? 'collapse' : 'expand'} /></button>
      </div>
    </figcaption>
    <div className={`capability-excalidraw-canvas ${classNames.canvas || ''}`} style={{ height: current.height }}>
      <Excalidraw key={`${current.chartId}:${generation}`} initialData={initialData} excalidrawAPI={(value) => { api.current = value; }}
        viewModeEnabled={!editing || saving} name={name} langCode={excalidraw?.langCode || 'en'}
        theme={excalidraw?.theme} handleKeyboardGlobally={false} autoFocus={false}>
        <MainMenu>
          {editing && <MainMenu.DefaultItems.LoadScene />}
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.ToggleTheme />
          {editing && <MainMenu.DefaultItems.ClearCanvas />}
        </MainMenu>
      </Excalidraw>
    </div>
    {error && <p role="alert" className="capability-excalidraw-message">{t(error)}</p>}
    {editing && (chart.revision || 0) > (current.revision || 0) && <p role="status" className="capability-excalidraw-message">{t('画布已有新版本。若需保留当前修改，请先导出，再重新加载。')}</p>}
    {notice && <p role="status" className="capability-excalidraw-message">{notice}</p>}
  </figure>;
}
