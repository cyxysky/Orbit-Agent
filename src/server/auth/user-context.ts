import { timingSafeEqual } from 'node:crypto';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


const FALLBACK_APPLICATION_USER_ID = '1';

export function defaultApplicationUserId(env: NodeJS.ProcessEnv | { WEBPILOT_DEFAULT_USER_ID?: string } = process.env) {
  return String(env.WEBPILOT_DEFAULT_USER_ID || '').trim() || FALLBACK_APPLICATION_USER_ID;
}

export const DEFAULT_APPLICATION_USER_ID = defaultApplicationUserId();

export function normalizeApplicationUserId(value: unknown) {
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  return normalized || DEFAULT_APPLICATION_USER_ID;
}

/** Missing resource ownership must never inherit the default login identity. */
export function applicationUserOwnsResource(ownerId: unknown, userId: unknown) {
  const owner = typeof ownerId === 'string' || typeof ownerId === 'number' ? String(ownerId).trim() : '';
  return Boolean(owner) && owner === normalizeApplicationUserId(userId);
}

export function applicationUserRuntimeKey(value: unknown) {
  return `user:${normalizeApplicationUserId(value)}`;
}

export type ApplicationPrincipal = {
  source: 'mounted' | 'internal' | 'admin';
  roles: string[];
  userId: string;
  username: string;
};

function trustedAuthenticationHeaders(request: Pick<Request, 'headers'>) {
  const expected = String(process.env.WEBPILOT_IDENTITY_HEADER_SECRET || '');
  const supplied = String(request.headers.get('x-webpilot-identity-proof') || '');
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function requestApplicationPrincipal(request: Pick<Request, 'headers'>): ApplicationPrincipal {
  if (!trustedAuthenticationHeaders(request)) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Authentication required');
  const userId = String(request.headers.get('x-webpilot-identity-user-id') || '').trim();
  const username = String(request.headers.get('x-webpilot-identity-username') || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(userId) || !username) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Authentication required');
  const source = request.headers.get('x-webpilot-identity-source');
  if (source !== 'admin' && source !== 'mounted' && source !== 'internal') throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Authentication required');
  return {
    source,
    userId: normalizeApplicationUserId(userId),
    username,
    roles: String(request.headers.get('x-webpilot-identity-roles') || '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
  };
}

export function requestWorkspaceApplicationPrincipal(request: Pick<Request, 'headers'>): ApplicationPrincipal {
  try {
    return requestApplicationPrincipal(request);
  } catch (error) {
    // Workspace pages only execute in the UI host, after webpilot-server has
    // authenticated the incoming request. Next development rendering can
    // reconstruct the request without the private proof header, so retain the
    // already-normalized identity fields in this UI-only boundary. API routes
    // continue to require the cryptographic proof above.
    if (process.env.WEBPILOT_SERVER_ROLE !== 'ui') throw error;
    const userId = String(request.headers.get('x-webpilot-identity-user-id') || '').trim();
    const username = String(request.headers.get('x-webpilot-identity-username') || '').trim();
    if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(userId) && username) {
      return {
        source: request.headers.get('x-webpilot-identity-source') === 'admin' ? 'admin'
          : request.headers.get('x-webpilot-identity-source') === 'internal' ? 'internal' : 'mounted',
        userId: normalizeApplicationUserId(userId),
        username,
        roles: String(request.headers.get('x-webpilot-identity-roles') || '')
          .split(',')
          .map((role) => role.trim())
          .filter(Boolean),
      };
    }
    throw error;
  }
}

export function requestApplicationUserId(request: Pick<Request, 'headers'>) {
  return requestApplicationPrincipal(request).userId;
}

