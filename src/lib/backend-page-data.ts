import { cookies, headers } from 'next/headers';
import { SIDEBAR_COLLAPSED_COOKIE_NAME, sidebarCollapsedFromCookie } from '@/lib/sidebar-collapse';

export async function readBackendPageData<T>(pathname: string): Promise<T> {
  const incoming = await headers();
  const origin = process.env.WEBPILOT_API_ORIGIN;
  if (!origin) throw new Error('The Node API origin is not configured. Start the application with its public launcher.');
  const forwarded = new Headers();
  for (const name of ['x-webpilot-identity-user-id', 'x-webpilot-identity-username', 'x-webpilot-identity-roles', 'x-webpilot-identity-proof', 'cookie']) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  // Only the authenticated UI host may restore a proof removed by Next's request reconstruction.
  if (process.env.WEBPILOT_SERVER_ROLE === 'ui' && forwarded.has('x-webpilot-identity-user-id') && forwarded.has('x-webpilot-identity-username')) {
    forwarded.set('x-webpilot-identity-proof', process.env.WEBPILOT_IDENTITY_HEADER_SECRET || '');
  }
  forwarded.set('x-webpilot-backend-token', process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN || '');
  const response = await fetch(new URL(pathname, origin), { headers: forwarded, cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load page data (${response.status})`);
  return response.json() as Promise<T>;
}

export async function readWorkspacePageContext() {
  const [context, requestCookies] = await Promise.all([
    readBackendPageData<{ userId: string; admin: boolean; adminSettingsPasswordRequired: boolean }>('/api/workspace/context'), cookies(),
  ]);
  return { ...context, sidebarCollapsed: sidebarCollapsedFromCookie(requestCookies.get(SIDEBAR_COLLAPSED_COOKIE_NAME)?.value) };
}
