'use client';

import { useSyncExternalStore } from 'react';
import { TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT, type ToolCapabilityName } from '@/lib/tool-capability-settings';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { defaultChatInterfaceSettings, type ChatInterfaceSettings } from '@/lib/chat-interface-settings';

let catalog: { enabled: ReadonlySet<string>; interfaceSettings: ChatInterfaceSettings } | undefined;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
const snapshot = () => catalog;
const serverSnapshot = () => undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    let controller: AbortController | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryMs = 1000;
    const refresh = () => {
      clearTimeout(retry);
      controller?.abort();
      const request = new AbortController(); controller = request;
      void fetch(withWebPilotBasePath('/api/browser-chat/tools'), { cache: 'no-store', signal: request.signal })
        .then(async response => {
          if (!response.ok) throw new Error('Catalog unavailable');
          const data = await response.json();
          if (!request.signal.aborted && Array.isArray(data.tools)) {
            const enabled = new Set<string>(data.tools.map((tool: { name: string }) => tool.name));
            const interfaceSettings = data.interfaceSettings ?? defaultChatInterfaceSettings;
            retryMs = 1000;
            if (catalog && catalog.enabled.size === enabled.size && [...enabled].every(name => catalog!.enabled.has(name))
              && JSON.stringify(catalog.interfaceSettings) === JSON.stringify(interfaceSettings)) return;
            catalog = { enabled, interfaceSettings };
            for (const notify of listeners) notify();
          }
        }).catch(() => {
          if (request.signal.aborted || document.visibilityState !== 'visible') return;
          // Keep the last confirmed catalog; recover without a reload after an initial failure.
          retry = setTimeout(refresh, retryMs); retryMs = Math.min(retryMs * 2, 30_000);
        }).finally(() => { if (controller === request) controller = undefined; });
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    window.addEventListener('focus', visible);
    window.addEventListener(TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT, refresh);
    document.addEventListener('visibilitychange', visible);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && !controller) refresh();
    }, 3000);
    stop = () => {
      controller?.abort();
      clearTimeout(retry);
      clearInterval(poll);
      window.removeEventListener('focus', visible);
      window.removeEventListener(TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT, refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }
  return () => { listeners.delete(listener); if (!listeners.size) { stop?.(); stop = undefined; catalog = undefined; } };
}

/** Share one filtered catalog request across the workspace and its global file editor. */
export function useToolCapabilityCatalog() {
  const data = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  // Avoid flashing disabled actions while the first catalog is being read.
  return { loaded: data !== undefined, interfaceSettings: data?.interfaceSettings, isEnabled: (name: ToolCapabilityName) => data?.enabled.has(name) ?? false };
}
