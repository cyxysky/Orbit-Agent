import { requestApplicationUserId } from '@/server/auth/user-context';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { adminSettingsPasswordEnabled } from '@/server/settings/admin-settings-access';
import { apiJson } from '@/server/http/api-request';

export async function GET(request: Request) {
  const userId = requestApplicationUserId(request);
  return apiJson(request, { userId, admin: isAiOperationsAdmin(userId), adminSettingsPasswordRequired: adminSettingsPasswordEnabled() });
}
