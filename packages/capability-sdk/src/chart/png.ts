import { normalizeChartOption, normalizeExcalidrawOption, type ChartRecord } from './core.ts';
import type { ChartSurface } from './three-renderer.ts';

async function exportExcalidrawPng(option: unknown) {
  const { exportToBlob, restoreElements } = await import('@excalidraw/excalidraw');
  const scene = normalizeExcalidrawOption(option);
  const elements = restoreElements(scene.elements as unknown as Parameters<typeof restoreElements>[0], null,
    { repairBindings: true, refreshDimensions: true }).filter(element => !element.isDeleted);
  if (!elements.length) throw new Error('画布没有可导出的图形。');
  const blob = await exportToBlob({
    elements,
    files: scene.files as Parameters<typeof exportToBlob>[0]['files'],
    appState: { ...scene.appState, exportBackground: true, exportEmbedScene: false },
    exportPadding: 32,
    maxWidthOrHeight: 4096,
    mimeType: 'image/png',
  });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取画布 PNG。'));
    reader.readAsDataURL(blob);
  });
}

/** Export saved content without editor controls or viewport cropping. Requires a browser DOM. */
export async function exportChartPng(chart: ChartRecord): Promise<string> {
  if (chart.engine === 'excalidraw') return exportExcalidrawPng(chart.option);
  const surface = document.createElement('div');
  surface.style.cssText = `position:fixed;left:0;top:0;width:1000px;height:${chart.height}px;background:#fff;`;
  document.body.append(surface);
  let instance: ChartSurface | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await document.fonts.ready;
    if (chart.engine === 'three') {
      const { createThreeChart } = await import('./three-renderer.ts');
      let renderError: string | undefined;
      instance = createThreeChart(surface, chart.option, message => { renderError = message; });
      const png = await instance.png();
      if (renderError) throw new Error(renderError);
      return png;
    }
    const { createEChartsChart } = await import('./echarts-renderer.ts');
    // Register before setOption: non-animated charts may finish synchronously.
    let finished!: () => void;
    const ready = new Promise<void>(resolve => { finished = resolve; });
    const view = createEChartsChart(surface, chart.renderer, finished);
    instance = view;
    const option = normalizeChartOption(chart.option, { invalidFormatters: 'omit' });
    option.animation = false;
    if (option.series !== undefined) {
      option.series = Array.isArray(option.series)
        ? option.series.map(series => ({ ...series, animation: false }))
        : { ...(option.series as Record<string, unknown>), animation: false };
    }
    view.apply({ ...chart, option });
    await Promise.race([ready, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('图表渲染超时，无法导出 PNG。')), 30_000);
    })]);
    return await view.png();
  } finally {
    clearTimeout(timeout);
    instance?.dispose();
    surface.remove();
  }
}
