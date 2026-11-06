import { preferenceSettingDefinitions, validateSettingValue } from '@/config/settings-schema';
import { withWebPilotBasePath } from './webpilot-base-path';

type Preferences = Record<string, string>;
const cacheKeys: Record<string, string> = {
  UI_BRAND_PREFIX: 'orbit.brandPrefix', UI_BRAND_TEXT: 'orbit.brandText', UI_LANGUAGE: 'webpilotqa.language',
  UI_THEME_COLOR: 'webpilotqa.themeColor', UI_THEME_MODE: 'webpilotqa.themeMode',
};
const listeners = new Set<(values: Preferences) => void>();
let values: Preferences | undefined;
let pending: Preferences = {};
let timer: ReturnType<typeof setInterval> | undefined;
let refreshing: Promise<void> | undefined;
let saving: Promise<void> | undefined;
let revision = 0;
let status: 'saved' | 'saving' | 'error' = 'saved';
const statusListeners = new Set<() => void>();

function setStatus(next: typeof status) {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener();
}

export const settingsPreferencesStatus = () => status;
export function subscribeSettingsPreferencesStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

function publish(next: Preferences) {
  const merged = { ...next, ...pending };
  if (values && Object.keys(values).length === Object.keys(merged).length
    && Object.entries(merged).every(([key, value]) => values![key] === value)) return;
  values = merged;
  for (const [key, cache] of Object.entries(cacheKeys)) {
    try { window.localStorage.setItem(cache, values[key] || ''); } catch { /* Cache is optional. */ }
  }
  if (values.UI_LANGUAGE) document.cookie = `WEBPILOTQA_LANGUAGE=${values.UI_LANGUAGE}; path=/; max-age=31536000; SameSite=Lax`;
  for (const listener of listeners) listener(values);
}

function legacyPreferences() {
  return Object.fromEntries(preferenceSettingDefinitions.map(field => {
    let value = field.defaultValue || '';
    try {
      value = window.localStorage.getItem(cacheKeys[field.key]) ?? value;
      if (field.key.startsWith('UI_BRAND_')) value = window.localStorage.getItem(cacheKeys[field.key])
        ?? window.localStorage.getItem(field.key === 'UI_BRAND_PREFIX' ? 'webpilotqa.brandPrefix' : 'webpilotqa.brandText') ?? value;
    } catch { /* Use the schema default when storage is unavailable. */ }
    try { value = validateSettingValue(field, value); } catch { value = field.defaultValue || ''; }
    return [field.key, value];
  }));
}

async function requestPreferences(body?: unknown) {
  const response = await fetch(withWebPilotBasePath('/api/settings/preferences'), body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Preferences request failed.');
  return response.json() as Promise<{ values: Preferences; initialized: boolean }>;
}

function refresh() {
  if (refreshing || saving) return refreshing;
  const before = revision;
  refreshing = (async () => {
    let snapshot = await requestPreferences();
    if (!snapshot.initialized) snapshot = await requestPreferences({ values: legacyPreferences(), initializeOnly: true });
    if (before === revision) publish(snapshot.values);
  })().catch(() => undefined).finally(() => { refreshing = undefined; });
  return refreshing;
}

function save() {
  if (saving || !Object.keys(pending).length) return;
  const patch = pending;
  pending = {};
  setStatus('saving');
  saving = requestPreferences({ values: patch }).then(snapshot => publish(snapshot.values))
    .catch(() => { pending = { ...patch, ...pending }; setStatus('error'); })
    .finally(() => {
      saving = undefined;
      if (!Object.keys(pending).length) setStatus('saved');
      else if (status !== 'error') save();
    });
}

export function subscribeSettingsPreferences(listener: (preferences: Preferences) => void) {
  listeners.add(listener);
  if (values) listener(values);
  if (!timer) {
    void refresh();
    timer = setInterval(() => {
      if (Object.keys(pending).length) save();
      else if (document.visibilityState === 'visible') void refresh();
    }, 3000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) { clearInterval(timer); timer = undefined; }
  };
}

export function updateSettingsPreference(key: string, value: string) {
  const field = preferenceSettingDefinitions.find(field => field.key === key);
  if (!field) throw new Error(`Unknown preference ${key}.`);
  validateSettingValue(field, value);
  revision++;
  pending = { ...pending, [key]: value };
  publish({ ...(values || legacyPreferences()), [key]: value });
  save();
}
