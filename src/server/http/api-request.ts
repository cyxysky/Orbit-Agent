import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { noStoreJson } from './no-store-response';
import { incrementMetric, structuredLog } from '@/server/observability/runtime-observability';
import { getErrorCode, normalizeErrorCode, type ErrorCode } from '@cjfclonedeep/capability-sdk';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';


export class ApiRequestError extends Error {
  code: ErrorCode;
  status: number;

  constructor(message: string, input: { code?: ErrorCode; status?: number } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = normalizeErrorCode(input.code, ERROR_CODES.INVALID_REQUEST);
    this.status = input.status || 400;
  }
}

export function apiRequestId(request: Pick<Request, 'headers'>) {
  const supplied = String(request.headers.get('x-request-id') || '').trim();
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(supplied) ? supplied : randomUUID();
}

async function readJsonRequestValue(request: Request, maxBytes: number, optional: boolean) {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiRequestError('Request body is too large', { code: ERROR_CODES.PAYLOAD_TOO_LARGE, status: 413 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new ApiRequestError('Request body is too large', { code: ERROR_CODES.PAYLOAD_TOO_LARGE, status: 413 });
  }
  if (!raw.trim()) {
    if (optional) return {};
    throw new ApiRequestError('Request body must be valid JSON');
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiRequestError('Request body must be valid JSON');
  }
}

async function parseRequestBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  input: { maxBytes?: number | null },
  optional: boolean,
): Promise<z.infer<T>> {
  // null explicitly opts out for documents whose size is not capped by the application.
  const maxBytes = input.maxBytes === null ? Infinity : Math.max(1024, Math.floor(input.maxBytes || 1024 * 1024));
  const parsed = schema.safeParse(await readJsonRequestValue(request, maxBytes, optional));
  if (!parsed.success) {
    throw new ApiRequestError('Request body is invalid', { code: ERROR_CODES.VALIDATION_FAILED });
  }
  return parsed.data;
}

export async function parseJsonRequest<T extends z.ZodType>(
  request: Request,
  schema: T,
  input: { maxBytes?: number | null } = {},
): Promise<z.infer<T>> {
  return parseRequestBody(request, schema, input, false);
}

export async function parseOptionalJsonRequest<T extends z.ZodType>(
  request: Request,
  schema: T,
  input: { maxBytes?: number | null } = {},
): Promise<z.infer<T>> {
  return parseRequestBody(request, schema, input, true);
}

export function apiJson<T>(request: Pick<Request, 'headers'>, body: T, init: ResponseInit = {}) {
  const requestId = apiRequestId(request);
  const headers = new Headers(init.headers);
  headers.set('x-request-id', requestId);
  incrementMetric('api_responses_total', { status: init.status || 200 });
  return noStoreJson(body, { ...init, headers });
}

export function apiError(
  request: Pick<Request, 'headers'>,
  error: unknown,
  input: { code?: ErrorCode; fallback: string; status?: number },
) {
  const requestId = apiRequestId(request);
  const known = error instanceof ApiRequestError;
  const status = known ? error.status : input.status || 400;
  const fallbackCode = normalizeErrorCode(input.code, status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.REQUEST_FAILED);
  const code = getErrorCode(error, fallbackCode);
  const message = known ? error.message : input.fallback;
  incrementMetric('api_errors_total', { code, status });
  if (!known || status >= 500) {
    structuredLog({
      event: 'api.request.failed',
      level: status >= 500 ? 'error' : 'warn',
      requestId,
      code,
      status,
      error,
    });
  }
  return noStoreJson(
    { code, error: message, requestId },
    { status, headers: { 'x-request-id': requestId } },
  );
}

export function boundedQueryInteger(
  value: string | null,
  input: { fallback: number; max: number; min?: number },
) {
  if (value === null || !value.trim()) return input.fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return input.fallback;
  return Math.max(input.min ?? 1, Math.min(input.max, Math.floor(numeric)));
}
