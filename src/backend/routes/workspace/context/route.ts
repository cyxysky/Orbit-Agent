import { requestApplicationPrincipal } from '@/server/auth/user-context';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { readAdminSession } from '@/server/auth/admin-session';
import { apiJson } from '@/server/http/api-request';
import { queryDatabaseOne } from '@/server/db/database';
import { createHash } from 'node:crypto';

export async function GET(request: Request) {
  const principal = requestApplicationPrincipal(request), userId = principal.userId;
  const ticket = new URL(request.url).searchParams.get('webSocketTicket');
  if (ticket) {
    const owned = await queryDatabaseOne<{ id: string }>(`SELECT id FROM request_record
      WHERE kind='ticket' AND token_hash = ? AND user_id = ? AND state='issued' AND expires_at > ?`,
    [createHash('sha256').update(ticket).digest('hex'), userId, new Date().toISOString()]);
    if (!owned) return new Response(null, { status: 401 });
  }
  const administrator = principal.source === 'admin' ? await readAdminSession(request) : undefined;
  return apiJson(request, { userId, admin: isAiOperationsAdmin(userId) && Boolean(administrator),
    administratorAuthenticated: Boolean(administrator), administratorExpiresAt: administrator?.expiresAt });
}
