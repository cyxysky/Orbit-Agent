'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, MainMenu, exportToBlob, exportToSvg, restoreElements, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { normalizeChartUpdate, normalizeExcalidrawOption } from './core.ts';
import type { ChartRendererProps } from './react.tsx';
import { defaultChartTranslate } from './i18n.ts';
import { ChartIcon } from './icons.tsx';
import { downloadChartFile } from './download.ts';
import { chartStyles } from './styles.ts';
import { CodedError, ERROR_CODES } from '../errors.ts';


export function ExcalidrawView({ chart, classNames = {}, onSave, onReload, onDownload, fullscreen: hostFullscreen, onFullscreenChange, translate: t = defaultChartTranslate, excalidraw }: ChartRendererProps) {
  const download = (data: Blob | string, name: string) => downloadChartFile(data, name, onDownload);
  const [current, setCurrent] = useState(chart);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0);
  const [nativeFullscreen, setFullscreen] = useState(false);
  const fullscreen = hostFullscreen ?? nativeFullscreen;
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
    if (!api.current) throw new CodedError(ERROR_CODES.CHART_OPERATION_FAILED, t('画布尚未就绪。'));
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
  return <figure ref={root} className={`${classNames.root || 'capability-chart'} capability-chart-interactive capability-excalidraw`} data-chart-id={current.chartId} data-chart-engine="excalidraw" data-fullscreen={fullscreen || undefined} aria-label={current.description || current.title || current.chartId}>
    <style>{chartStyles}</style>
    <style>{`
      .capability-excalidraw{--canvas-accent:var(--accent,#48654e);--canvas-line:color-mix(in srgb,var(--border,#dfe3d9) 75%,transparent);--canvas-tint:color-mix(in srgb,var(--canvas-accent) 7%,var(--panel,#fdfcf9))}
      .capability-excalidraw .capability-chart-header{flex-wrap:wrap}
      .capability-excalidraw .capability-chart-title{flex-basis:120px}
      .capability-excalidraw .capability-chart-actions{margin-left:auto;max-width:100%;flex-wrap:wrap}
      .capability-excalidraw-canvas{container-type:inline-size;overflow:hidden;border-radius:0 0 14px 14px}
      .capability-excalidraw:is(:fullscreen,[data-fullscreen=true])>.capability-excalidraw-canvas{border-radius:0}
      .capability-excalidraw .excalidraw{--color-primary:var(--canvas-accent);--color-primary-darker:var(--canvas-accent);--color-primary-darkest:var(--foreground,#30392f);--color-primary-light:var(--canvas-tint);--color-primary-light-darker:color-mix(in srgb,var(--canvas-accent) 15%,var(--panel,#fff));--color-surface-primary-container:var(--canvas-tint);--color-surface-low:var(--panel-soft,#f4f5f0);--color-surface-mid:var(--canvas-tint);--button-hover-bg:var(--canvas-tint);--button-active-bg:var(--canvas-tint);--island-bg-color:var(--panel,#fdfcf9);--default-border-color:var(--canvas-line);--border-radius-lg:10px}
      .capability-excalidraw .excalidraw .main-menu-trigger ~ .dropdown-menu:not(.dropdown-menu--mobile){width:max-content;min-width:min(240px,calc(100cqw - 32px));max-width:calc(100cqw - 32px)}
      .capability-excalidraw .excalidraw .dropdown-menu-item__shortcut{flex-shrink:0;white-space:nowrap}
    `}</style>
    <figcaption className="capability-chart-header">
      <strong className="capability-chart-title">{current.title || t('画布')}</strong>
      <div className="capability-chart-actions" role="group" aria-label={t('画布操作')}>
      {editing ? <>
        <button className="capability-chart-icon-button" type="button" disabled={saving} aria-busy={saving} title={saving ? t('保存中…') : t('保存')} aria-label={saving ? t('保存中…') : t('保存')} onClick={() => act(save)}><ChartIcon name="check" /></button>
        <button className="capability-chart-icon-button" type="button" disabled={saving} title={t('取消编辑')} aria-label={t('取消编辑')} onClick={() => { setEditing(false); setCurrent(chart); setGeneration((value) => value + 1); setError(''); }}><ChartIcon name="close" /></button>
      </> : <button className="capability-chart-icon-button" type="button" title={t('编辑')} aria-label={t('编辑')} onClick={() => { setEditing(true); setNotice(''); }}><ChartIcon name="edit" /></button>}
      {onReload && <button className="capability-chart-icon-button" type="button" title={editing ? t('放弃修改并重新加载') : t('重新加载')} aria-label={editing ? t('放弃修改并重新加载') : t('重新加载')} disabled={saving} onClick={() => act(async () => {
        setSaving(true);
        try { setCurrent(await onReload()); setEditing(false); setGeneration((value) => value + 1); setNotice(''); }
        finally { setSaving(false); }
      })}><ChartIcon name="refresh" /></button>}
      <details ref={downloadMenu} className="capability-chart-download">
      <summary className="capability-chart-icon-button" title={t('导出画布')} aria-label={t('导出画布')}><ChartIcon name="download" /></summary>
      <div className="capability-chart-download-menu">
      <p>{t('导出画布')}</p>
      <button type="button" onClick={() => act(() => {
        const scene = snapshot();
        return download(new Blob([serializeAsJSON(scene.elements, scene.appState, scene.files, 'local')], { type: 'application/json' }), `${name}.excalidraw`);
      })}><ChartIcon name="code" /><span>Excalidraw</span><small>JSON</small></button>
      <button type="button" onClick={() => act(async () => download(await exportToBlob({ ...snapshot(), mimeType: 'image/png' }), `${name}.png`))}><ChartIcon name="image" /><span>{t('图片')}</span><small>PNG</small></button>
      <button type="button" onClick={() => act(async () => download(new Blob([(await exportToSvg(snapshot())).outerHTML], { type: 'image/svg+xml' }), `${name}.svg`))}><ChartIcon name="image" /><span>{t('矢量图')}</span><small>SVG</small></button>
      </div></details>
      <button className="capability-chart-icon-button" type="button" title={fullscreen ? t('退出全屏') : t('全屏')} aria-label={fullscreen ? t('退出全屏') : t('全屏')} onClick={() => act(async () => {
        if (onFullscreenChange) await onFullscreenChange(!fullscreen);
        else if (document.fullscreenElement === root.current) await document.exitFullscreen();
        else await root.current?.requestFullscreen();
      })}><ChartIcon name={fullscreen ? 'collapse' : 'expand'} /></button>
      </div>
    </figcaption>
    <div className={`${classNames.canvas || 'capability-chart-canvas'} capability-chart-viewport capability-excalidraw-canvas`} style={{ height: current.height }}>
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
    {error && <p role="alert" className="capability-chart-message">{t(error)}</p>}
    {editing && (chart.revision || 0) > (current.revision || 0) && <p role="status" className="capability-chart-message">{t('画布已有新版本。若需保留当前修改，请先导出，再重新加载。')}</p>}
    {notice && <p role="status" className="capability-chart-message">{notice}</p>}
  </figure>;
}
