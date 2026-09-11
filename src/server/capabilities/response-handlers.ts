import { ResponseHandlerRegistry } from '@webpilot/capability-sdk';
import { createChartResponseHandlers } from '@webpilot/capability-chart/response-node';
import { createMapResponseHandlers } from '@webpilot/capability-maps/response-node';
import { responseRegistry } from '@/lib/response-registry';
import { readBrowserChatChart, updateBrowserChatChart } from './browser-chat-chart';
import { browserChatMapStore, resolveBrowserChatMap } from './browser-chat-maps';
import { store } from '@/server/db/store';

export const responseHandlers = new ResponseHandlerRegistry(responseRegistry)
  .register(createChartResponseHandlers({
    read: (id, context) => readBrowserChatChart(context.scopeId, id),
    update: (id, value, revision, context) => updateBrowserChatChart(context.scopeId, id, value, revision, context.userId),
    exportImage: async (id, context) => {
      const { exportBrowserChatChartImage } = await import('./browser-chat-chart-image');
      return exportBrowserChatChartImage(context.scopeId, id, context.userId);
    },
  }))
  .register(createMapResponseHandlers({
    resolve: async (id, context) => { await store.applyRuntimeEnv(); return resolveBrowserChatMap(context.scopeId, id, context.signal); },
    read: (id, context) => browserChatMapStore(context.scopeId).read(id),
  }))
  .assertComplete();
