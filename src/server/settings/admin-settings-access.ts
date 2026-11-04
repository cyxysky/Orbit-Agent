import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { ApiRequestError, apiError } from '@/server/http/api-request';


const ADMIN_SETTINGS_ACCESS_TOKEN_LIFETIME_MS = 4 * 60 * 60 * 1000;
const ADMIN_SETTINGS_ACCESS_TOKEN_VERSION = 1;

type AdminSettingsEnvironment = {
  [key: string]: string | undefined;
  WEBPILOT_ADMIN_SETTINGS_PASSWORD?: string;
  WEBPILOT_ADMIN_SETTINGS_PASSWORD_ENABLED?: string;
};

type AdminSettingsAccessTokenPayload = {
  expiresAt: number;
  nonce: string;
  version: number;
};

function configuredPassword(env: AdminSettingsEnvironment) {
  return String(env.WEBPILOT_ADMIN_SETTINGS_PASSWORD || '');
}

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function equalSecret(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

function signingKey(env: AdminSettingsEnvironment) {
  return createHash('sha256')
    .update('webpilot-admin-settings-access\0', 'utf8')
    .update(configuredPassword(env), 'utf8')
    .digest();
}

function signPayload(encodedPayload: string, env: AdminSettingsEnvironment) {
  return createHmac('sha256', signingKey(env)).update(encodedPayload, 'utf8').digest('base64url');
}

export function adminSettingsPasswordEnabled(env: AdminSettingsEnvironment = process.env) {
  return String(env.WEBPILOT_ADMIN_SETTINGS_PASSWORD_ENABLED || '').trim().toLowerCase() === 'true';
}

export function adminSettingsPasswordConfigured(env: AdminSettingsEnvironment = process.env) {
  return configuredPassword(env).length > 0;
}

export function verifyAdminSettingsPassword(password: unknown, env: AdminSettingsEnvironment = process.env) {
  if (!adminSettingsPasswordEnabled(env)) return true;
  if (!adminSettingsPasswordConfigured(env) || typeof password !== 'string') return false;
  return equalSecret(password, configuredPassword(env));
}

export function createAdminSettingsAccessToken(
  env: AdminSettingsEnvironment = process.env,
  now = Date.now(),
) {
  if (!adminSettingsPasswordConfigured(env)) {
    throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'WEBPILOT_ADMIN_SETTINGS_PASSWORD is not configured.');
  }
  const payload: AdminSettingsAccessTokenPayload = {
    expiresAt: now + ADMIN_SETTINGS_ACCESS_TOKEN_LIFETIME_MS,
    nonce: randomBytes(18).toString('base64url'),
    version: ADMIN_SETTINGS_ACCESS_TOKEN_VERSION,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${signPayload(encodedPayload, env)}`;
}

export function verifyAdminSettingsAccessToken(
  token: unknown,
  env: AdminSettingsEnvironment = process.env,
  now = Date.now(),
) {
  if (!adminSettingsPasswordEnabled(env)) return true;
  if (!adminSettingsPasswordConfigured(env) || typeof token !== 'string') return false;
  const [encodedPayload, submittedSignature, extra] = token.split('.');
  if (!encodedPayload || !submittedSignature || extra !== undefined) return false;
  if (!equalSecret(submittedSignature, signPayload(encodedPayload, env))) return false;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<AdminSettingsAccessTokenPayload>;
    return payload.version === ADMIN_SETTINGS_ACCESS_TOKEN_VERSION
      && typeof payload.nonce === 'string'
      && payload.nonce.length > 0
      && typeof payload.expiresAt === 'number'
      && Number.isFinite(payload.expiresAt)
      && payload.expiresAt > now;
  } catch {
    return false;
  }
}

export function requestHasAdminSettingsAccess(request: Request, env: AdminSettingsEnvironment = process.env) {
  if (!adminSettingsPasswordEnabled(env)) return true;
  if (!requestCanAccessSettings(request, env)) return false;
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return verifyAdminSettingsAccessToken(match?.[1], env);
}

export function requestCanAccessSettings(request: Pick<Request, 'headers'>, env: AdminSettingsEnvironment = process.env) {
  if (!adminSettingsPasswordEnabled(env)) return true;
  try { return isAiOperationsAdmin(requestApplicationUserId(request)); }
  catch { return false; }
}

export function authorizeSettingsMenuRequest(request: Request) {
  if (!requestCanAccessSettings(request)) {
    return apiError(request, new ApiRequestError('仅管理员可以访问设置。', { code: ERROR_CODES.FORBIDDEN, status: 403 }), { fallback: '无法访问设置。' });
  }
}

export function authorizeAdminSettingsRequest(request: Request) {
  const denied = authorizeSettingsMenuRequest(request);
  if (denied) return denied;
  if (!requestHasAdminSettingsAccess(request)) {
    return apiError(request, new ApiRequestError('请先输入管理员设置密码。', { code: ERROR_CODES.ADMIN_ACCESS_REQUIRED, status: 401 }), { fallback: '无法访问设置。' });
  }
}
