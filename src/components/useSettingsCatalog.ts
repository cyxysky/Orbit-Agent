'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { settingsForms } from '@/config/settings-forms';
import { runtimeSettingDefinitions, type RuntimeSettingDefinition } from '@/config/settings';
import type { SettingsForm } from '@/config/settings-schema';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

type Catalog = { definitions: RuntimeSettingDefinition[]; forms: SettingsForm[] };
const initial: Catalog = { definitions: runtimeSettingDefinitions, forms: settingsForms };
let catalog = initial;
let authorization: HeadersInit | undefined;
let authorizationKey = '';
let timer: ReturnType<typeof setInterval> | undefined;
let controller: AbortController | undefined;
const listeners = new Set<() => void>();
const snapshot = () => catalog;
const serverSnapshot = () => initial;

function refresh() {
  if (controller || document.visibilityState !== 'visible') return;
  const request = controller = new AbortController();
  void fetch(withWebPilotBasePath('/api/settings/configuration'), { headers: authorization, cache: 'no-store', signal: request.signal })
    .then(async response => {
      if (!response.ok) return;
      const next = await response.json() as Catalog;
      const candidate = { definitions: next.definitions, forms: next.forms };
      if (!request.signal.aborted && Array.isArray(next.definitions) && Array.isArray(next.forms)
        && JSON.stringify(catalog) !== JSON.stringify(candidate)) {
        catalog = candidate;
        for (const listener of listeners) listener();
      }
    }).catch(() => undefined).finally(() => { if (controller === request) controller = undefined; });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) { refresh(); timer = setInterval(refresh, 3000); }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      if (timer) clearInterval(timer);
      timer = undefined;
      controller?.abort(); controller = undefined;
    }
  };
}

export function useSettingsCatalog(headers?: HeadersInit) {
  const key = JSON.stringify([...new Headers(headers).entries()]);
  useEffect(() => {
    if (headers !== undefined && authorizationKey !== key) {
      authorization = headers;
      authorizationKey = key;
      controller?.abort(); controller = undefined;
      refresh();
    }
  }, [headers, key]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
