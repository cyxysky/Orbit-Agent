import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { executeDatabase, queryDatabase, queryDatabaseOne, runDatabaseTransaction } from '@/server/db/database';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


export type WebSocketTicketScope = 'browser-preview' | 'realtime-refresh';

type WebSocketTicketRow = {
  id: string;
  user_id: string;
  session_id?: string | null;
  scope: string;
  origin?: string | null;
  expires_at: string;
  state: string;
};

function nowIso() {
  return new Date().toISOString();
}

function ticketHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function ticketLifetimeMs() {
  const configured = Number(process.env.WEBPILOT_WEBSOCKET_TICKET_TTL_SECONDS || 45);
  const seconds = Number.isFinite(configured)
    ? Math.max(15, Math.min(120, Math.floor(configured)))
    : 45;
  return seconds * 1000;
}

export function requestPublicOrigin(request: Request) {
  // A browser POST carries the exact origin that it will also send during the
  // subsequent WebSocket handshake. Prefer it over proxy-derived values so a
  // TLS-terminating reverse proxy cannot accidentally mint an http-bound
  // ticket for an https page when trusted proxy headers are unavailable.
  const browserOrigin = normalizedOrigin(String(request.headers.get('origin') || '').trim());
  if (browserOrigin) return browserOrigin;
  const url = new URL(request.url);
  const forwardedHost = String(request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  const forwardedProto = String(request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  const host = forwardedHost || request.headers.get('host') || url.host;
  const protocol = forwardedProto || url.protocol.replace(/:$/, '');
  return new URL(`${protocol}://${host}`).origin;
}

export async function createWebSocketTicket(input: {
  origin: string;
  scope: WebSocketTicketScope;
  sessionId?: string;
  userId: string;
}) {
  const origin = normalizedOrigin(input.origin);
  if (!origin) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'A valid WebSocket origin is required');
  const token = randomBytes(32).toString('base64url');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ticketLifetimeMs()).toISOString();
  await executeDatabase(`
    INSERT INTO request_record (
      id, kind, token_hash, user_id, session_id, scope, origin, state, expires_at, created_at, updated_at
    ) VALUES (?, 'ticket', ?, ?, ?, ?, ?, 'issued', ?, ?, ?)
  `, [
    randomUUID(),
    ticketHash(token),
    input.userId,
    input.sessionId || null,
    input.scope,
    origin,
    expiresAt,
    createdAt,
    createdAt,
  ]);
  await executeDatabase('DELETE FROM request_record WHERE expires_at <= ?', [createdAt]);
  return { expiresAt, ticket: token };
}

export async function consumeWebSocketTicket(input: {
  origin?: string;
  scope: WebSocketTicketScope;
  sessionId?: string;
  ticket: string;
}) {
  const token = input.ticket.trim();
  if (!token) return undefined;
  return runDatabaseTransaction(async (database) => {
    const row = await queryDatabaseOne<WebSocketTicketRow>(`
      SELECT id, user_id, session_id, scope, origin, expires_at, state
      FROM request_record WHERE kind='ticket' AND token_hash = ?
    `, [ticketHash(token)], database);
    const current = nowIso();
    const expectedOrigin = normalizedOrigin(String(input.origin || '').trim());
    if (
      !row
      || row.state !== 'issued'
      || row.expires_at <= current
      || row.scope !== input.scope
      || String(row.session_id || '') !== String(input.sessionId || '')
      || (row.origin && row.origin !== expectedOrigin)
    ) return undefined;
    // Deleting the claim is atomic and leaves no spent-ticket history to retain.
    const consumed = await queryDatabase<{ id: string }>(`
      DELETE FROM request_record
      WHERE kind='ticket' AND token_hash = ? AND state='issued' AND expires_at > ?
      RETURNING id
    `, [ticketHash(token), current], database);
    if (consumed.length !== 1) return undefined;
    return {
      userId: row.user_id,
      sessionId: row.session_id || undefined,
      scope: row.scope as WebSocketTicketScope,
    };
  });
}
