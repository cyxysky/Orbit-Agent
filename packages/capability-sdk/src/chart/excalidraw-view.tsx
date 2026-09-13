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
      setNotice(onSave ? '' : t('已在当前页面应用；请导出文件保存。'));
    } finally { setSaving(false); }
  }
  return <figure ref={root} className={`capability-excalidraw ${classNames.root || ''}`} data-chart-id={current.chartId} data-chart-engine="excalidraw" aria-label={current.description || current.title || current.chartId}>
    <style>{`
      .capability-excalidraw.capability-excalidraw{--canvas-accent:var(--accent,#48654e);--canvas-muted:var(--muted,#7b8378);--canvas-line:color-mix(in srgb,var(--border,#dfe3d9) 75%,transparent);--canvas-tint:color-mix(in srgb,var(--canvas-accent) 7%,var(--panel,#fdfcf9));display:block;min-width:0;margin:16px 0;padding:0;overflow:hidden;border:1px solid var(--canvas-line);border-radius:18px;background:var(--panel,#fdfcf9);color:var(--foreground,#30392f);box-shadow:0 2px 4px #25302003,0 12px 32px -16px #25302018}
      .capability-excalidraw.capability-excalidraw:fullscreen{display:flex;flex-direction:column;height:100%;width:100%;max-width:none;margin:0;border:0;border-radius:0;box-shadow:none}
      .capability-excalidraw:fullscreen>.capability-excalidraw-canvas{flex:1;height:auto!important}
      .capability-excalidraw-toolbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:15px 18px;border-bottom:1px solid var(--canvas-line)}
      .capability-excalidraw-heading{display:flex;align-items:center;gap:11px;flex:1;min-width:160px}
      .capability-excalidraw-emblem{display:grid;place-items:center;flex:none;width:36px;height:36px;border:1px solid color-mix(in srgb,var(--canvas-accent) 12%,transparent);border-radius:11px;background:var(--canvas-tint);color:var(--canvas-accent)}
      .capability-excalidraw-heading-copy{display:grid;gap:3px;min-width:0}
      .capability-excalidraw-title{font-size:14px;font-weight:600;line-height:1.45;letter-spacing:.01em;overflow-wrap:anywhere}
      .capability-excalidraw-caption{color:var(--canvas-muted);font:400 11px/1.3 system-ui,sans-serif;letter-spacing:.03em}
      .capability-excalidraw-actions{display:flex;align-items:center;gap:3px;flex:none;margin-left:auto;padding:3px;border:1px solid var(--canvas-line);border-radius:11px;background:color-mix(in srgb,var(--panel-soft,#f4f5f0) 65%,transparent)}
      .capability-excalidraw-toolbar :is(button,summary){box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;gap:6px;width:32px;height:32px;margin:0;border:1px solid transparent;border-radius:7px;padding:0;background:transparent;color:var(--canvas-muted);cursor:pointer;font:500 12px/1.4 system-ui,sans-serif;white-space:nowrap;transition:background .16s,color .16s,border-color .16s,box-shadow .16s}
      .capability-excalidraw-toolbar :is(button,summary):hover:not(:disabled){background:var(--panel,#fff);color:var(--foreground,#30392f);box-shadow:0 1px 3px #2530200a}
      .capability-excalidraw-action-divider{width:1px;height:16px;margin:0 4px;background:var(--canvas-line);flex:none}
      .capability-excalidraw-toolbar .capability-chart-icon-slot{display:inline-flex;flex:none;line-height:0}
      .capability-excalidraw-toolbar .capability-chart-icon{display:block;width:16px;height:16px;min-width:16px}
      .capability-excalidraw-emblem .capability-chart-icon{width:18px;height:18px}
      .capability-excalidraw-toolbar button:disabled{opacity:.5;cursor:default}
      .capability-excalidraw-toolbar :is(button,summary):focus-visible{outline:2px solid var(--canvas-accent);outline-offset:2px}
      .capability-excalidraw-download{position:relative;z-index:5}
      .capability-excalidraw-download summary{list-style:none}
      .capability-excalidraw-download summary::-webkit-details-marker{display:none}
      .capability-excalidraw-download[open]>summary{background:var(--panel,#fff);color:var(--canvas-accent)}
      .capability-excalidraw-download-menu{position:absolute;top:calc(100% + 10px);right:0;display:grid;gap:2px;width:196px;max-width:calc(100vw - 48px);padding:6px;background:var(--panel,#fff);border:1px solid var(--canvas-line);border-radius:12px;box-shadow:0 12px 36px #25302014,0 2px 6px #25302008}
      .capability-excalidraw-download-menu button{justify-content:flex-start;width:100%;height:38px;padding:0 10px;gap:10px;color:var(--foreground,#30392f);font-weight:400}
      .capability-excalidraw-download-menu button:hover:not(:disabled){background:var(--canvas-tint);box-shadow:none}
      .capability-excalidraw-message{padding:10px 18px;margin:0;border-top:1px solid var(--canvas-line);font-size:12px;line-height:1.6;color:var(--canvas-muted)}
      .capability-excalidraw-message[role=alert]{color:var(--danger,#b42318)}
      .capability-excalidraw-canvas{position:relative;min-height:240px;container-type:inline-size}
      .capability-excalidraw .excalidraw{--color-primary:var(--canvas-accent);--color-primary-darker:var(--canvas-accent);--color-primary-darkest:var(--foreground,#30392f);--color-primary-light:var(--canvas-tint);--color-primary-light-darker:color-mix(in srgb,var(--canvas-accent) 15%,var(--panel,#fff));--color-surface-primary-container:var(--canvas-tint);--color-surface-low:var(--panel-soft,#f4f5f0);--color-surface-mid:var(--canvas-tint);--button-hover-bg:var(--canvas-tint);--button-active-bg:var(--canvas-tint);--island-bg-color:var(--panel,#fdfcf9);--default-border-color:var(--canvas-line);--border-radius-lg:10px}
      .capability-excalidraw .excalidraw .main-menu-trigger ~ .dropdown-menu:not(.dropdown-menu--mobile){width:max-content;min-width:min(240px,calc(100cqw - 32px));max-width:calc(100cqw - 32px)}
      .capability-excalidraw .excalidraw .dropdown-menu-item__shortcut{flex-shrink:0;white-space:nowrap}
      @media(max-width:540px){.capability-excalidraw-toolbar{padding:12px;gap:10px}.capability-excalidraw-heading{flex-basis:100%;min-width:0}.capability-excalidraw-title{font-size:13px}.capability-excalidraw-actions{margin-left:0;max-width:100%;flex-wrap:wrap}.capability-excalidraw-toolbar :is(button,summary){width:36px;height:36px}}
      @media(max-width:380px){.capability-excalidraw-toolbar :is(button,summary){width:32px;height:34px}}
      @media(prefers-reduced-motion:reduce){.capability-excalidraw-toolbar :is(button,summary){transition:none}}
    `}</style>
    <figcaption className="capability-excalidraw-toolbar">
      <div className="capability-excalidraw-heading">
        <span className="capability-excalidraw-emblem" aria-hidden="true"><ChartIcon name="diagram" /></span>
        <div className="capability-excalidraw-heading-copy">
          <strong className="capability-excalidraw-title">{current.title || t('画布')}</strong>
          <span className="capability-excalidraw-caption">Excalidraw</span>
        </div>
      </div>
      <div className="capability-excalidraw-actions" role="group" aria-label={t('画布操作')}>
      {editing ? <>
        <button className="capability-excalidraw-primary" type="button" disabled={saving} aria-busy={saving} title={saving ? t('保存中…') : t('保存')} aria-label={saving ? t('保存中…') : t('保存')} onClick={() => act(save)}><ChartIcon name="check" /></button>
        <button className="capability-excalidraw-cancel" type="button" disabled={saving} title={t('取消编辑')} aria-label={t('取消编辑')} onClick={() => { setEditing(false); setCurrent(chart); setGeneration((value) => value + 1); setError(''); }}><ChartIcon name="close" /></button>
      </> : <button className="capability-excalidraw-primary" type="button" title={t('编辑')} aria-label={t('编辑')} onClick={() => { setEditing(true); setNotice(''); }}><ChartIcon name="edit" /></button>}
      <span className="capability-excalidraw-action-divider" aria-hidden="true" />
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
