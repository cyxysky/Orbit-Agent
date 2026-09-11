import * as echarts from 'echarts';
import { echartsMapDefinition, normalizeChartOption, type ChartRecord } from './core.ts';
import type { ChartSurface } from './three-renderer.ts';

async function svgPng(svg: string, width: number, height: number) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2;
    const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法导出 PNG。');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height); return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

/** Shared by the interactive chart and isolated image exports. */
export function createEChartsChart(surface: HTMLDivElement, renderer: 'canvas' | 'svg', onFinished?: () => void): ChartSurface & {
  apply(record: ChartRecord): void;
} {
  const view = echarts.init(surface, undefined, { renderer });
  if (onFinished) view.on('finished', onFinished);
  return {
    apply(record) {
      for (const map of record.maps || []) echarts.registerMap(map.name, echartsMapDefinition(map) as unknown as Parameters<typeof echarts.registerMap>[1], map.specialAreas as Parameters<typeof echarts.registerMap>[2]);
      view.setOption(normalizeChartOption(record.option, { invalidFormatters: 'omit' }), { lazyUpdate: false, notMerge: true });
    },
    dispose: () => view.dispose(), resize: () => view.resize(),
    png: () => renderer === 'svg' ? svgPng(view.renderToSVGString(), view.getWidth(), view.getHeight()) : Promise.resolve(view.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })),
    svg: renderer === 'svg' ? () => view.renderToSVGString() : undefined,
  };
}
