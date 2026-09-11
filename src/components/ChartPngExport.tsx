'use client';

import { useEffect } from 'react';
import { exportChartPng } from '@webpilot/capability-chart/react';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

export type ChartExportWindow = Window & {
  orbitExportChartPng?: typeof exportChartPng;
  EXCALIDRAW_ASSET_PATH?: string;
};

/** Empty, data-free surface for the service's isolated PNG renderer. */
export function ChartPngExport() {
  useEffect(() => {
    const target = window as ChartExportWindow;
    target.EXCALIDRAW_ASSET_PATH = withWebPilotBasePath('/api/chart-assets/excalidraw/');
    target.orbitExportChartPng = exportChartPng;
    return () => { delete target.orbitExportChartPng; };
  }, []);
  return null;
}
