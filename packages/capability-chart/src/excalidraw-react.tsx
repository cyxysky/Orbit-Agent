'use client';

import { useEffect, useState, type ComponentType } from 'react';
import type { ChartRendererProps } from './react.tsx';

/** Load the editor only after mounting; Node/MCP and SSR never evaluate it. */
export function ExcalidrawRenderer(props: ChartRendererProps) {
  const [View, setView] = useState<ComponentType<ChartRendererProps>>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    if (props.excalidraw?.assetPath) {
      (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = props.excalidraw.assetPath;
    }
    void import('./excalidraw-view.tsx').then((module) => {
      if (active) setView(() => module.ExcalidrawView);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [props.excalidraw?.assetPath, attempt]);
  const t = props.translate || ((value: string) => value);
  if (View) return <View {...props} />;
  return <div role={error ? 'alert' : 'status'} style={{ minHeight: props.chart.height }}>
    {error || t('正在加载画布…')}
    {error && <button type="button" onClick={() => setAttempt((value) => value + 1)}>{t('重试')}</button>}
  </div>;
}
