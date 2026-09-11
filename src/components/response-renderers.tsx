'use client';

import { coreResponseRenderers, ResponseRendererRegistry } from '@webpilot/capability-response/react';
import { createChartResponseRenderers } from '@webpilot/capability-chart/response-react';
import { mapResponseRenderers } from '@webpilot/capability-maps/response-react';
import { responseRegistry } from '@/lib/response-registry';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

export const responseRenderers = new ResponseRendererRegistry(responseRegistry)
  .register(coreResponseRenderers)
  .register(createChartResponseRenderers({
    excalidrawAssetPath: withWebPilotBasePath('/api/chart-assets/excalidraw/'),
    classNames: { root: 'browser-chat-chart', canvas: 'browser-chat-chart-canvas', surface: 'browser-chat-chart-surface' },
  }))
  .register(mapResponseRenderers)
  .assertComplete();
