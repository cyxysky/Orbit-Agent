export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'webpilotqa.sidebarCollapsed';
export const SIDEBAR_COLLAPSED_COOKIE_NAME = 'webpilotqa_sidebar_collapsed';

let cachedSidebarCollapsed: boolean | undefined;
let persistedSidebarCollapsed: boolean | undefined;
const listeners = new Set<() => void>();

function notifySidebarCollapsedChange() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== SIDEBAR_COLLAPSED_STORAGE_KEY && event.key !== null) return;
  try { if (event.storageArea !== window.localStorage) return; } catch { return; }
  cachedSidebarCollapsed = event.newValue === 'true';
  persistedSidebarCollapsed = undefined;
  notifySidebarCollapsedChange();
}

export function subscribeSidebarCollapsedPreference(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
}

export function sidebarCollapsedFromCookie(value: string | undefined) {
  return value === 'true';
}

export function readSidebarCollapsedPreference(fallback = false) {
  if (cachedSidebarCollapsed !== undefined) return cachedSidebarCollapsed;
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    cachedSidebarCollapsed = stored === null ? fallback : stored === 'true';
  } catch {
    cachedSidebarCollapsed = fallback;
  }
  return cachedSidebarCollapsed;
}

export function writeSidebarCollapsedPreference(collapsed: boolean) {
  if (typeof window === 'undefined') return;
  const changed = cachedSidebarCollapsed !== collapsed;
  cachedSidebarCollapsed = collapsed;
  if (persistedSidebarCollapsed !== collapsed) {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch {
      // Navigation still uses the shared in-memory snapshot when storage is blocked.
    }
    try {
      document.cookie = `${SIDEBAR_COLLAPSED_COOKIE_NAME}=${collapsed ? 'true' : 'false'}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      // Cookie persistence is optional; mounted workspaces remain synchronized.
    }
    persistedSidebarCollapsed = collapsed;
  }
  if (changed) notifySidebarCollapsedChange();
}
