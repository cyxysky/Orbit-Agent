import { requestApplicationUserId } from '@/server/auth/user-context';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { adminSettingsPasswordEnabled } from '@/server/settings/admin-settings-access';
import { apiJson } from '@/server/http/api-request';
import { queryDatabaseOne } from '@/server/db/database';
import { createHash } from 'node:crypto';

export async function GET(request: Request) {
  const userId = requestApplicationUserId(request);
  const ticket = new URL(request.url).searchParams.get('webSocketTicket');
  if (ticket) {
    const owned = await queryDatabaseOne<{ id: string }>(`SELECT id FROM websocket_ticket
      WHERE token_hash = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?`,
    [createHash('sha256').update(ticket).digest('hex'), userId, new Date().toISOString()]);
    if (!owned) return new Response(null, { status: 401 });
  }
  return apiJson(request, { userId, admin: isAiOperationsAdmin(userId), adminSettingsPasswordRequired: adminSettingsPasswordEnabled() });
}
