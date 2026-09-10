'use client';

import { useEffect } from 'react';
import { normalizeExcalidrawOption } from '@webpilot/capability-chart';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

export type ChartExportWindow = Window & {
  orbitExportExcalidrawPng?: (option: unknown) => Promise<string>;
  EXCALIDRAW_ASSET_PATH?: string;
};

/** Also used without mounting the editor: no selection, toolbar or viewport cropping. */
export async function exportExcalidrawPng(option: unknown) {
  (window as ChartExportWindow).EXCALIDRAW_ASSET_PATH = withWebPilotBasePath('/api/chart-assets/excalidraw/');
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

/** Empty, data-free surface for the service's isolated PNG renderer. */
export function ExcalidrawPngExport() {
  useEffect(() => {
    const target = window as ChartExportWindow;
    target.orbitExportExcalidrawPng = exportExcalidrawPng;
    return () => { delete target.orbitExportExcalidrawPng; };
  }, []);
  return null;
}
