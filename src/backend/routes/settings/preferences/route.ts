import { z } from 'zod';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { readSettingsPreferences, saveSettingsPreferences } from '@/server/settings/preferences';

export async function GET(request: Request) {
  try { return apiJson(request, await readSettingsPreferences(requestApplicationUserId(request))); }
  catch (error) { return apiError(request, error, { fallback: '读取界面偏好失败' }); }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonRequest(request, z.object({ values: z.record(z.string(), z.unknown()), initializeOnly: z.boolean().optional() }).strict(), { maxBytes: 16000 });
    return apiJson(request, await saveSettingsPreferences(requestApplicationUserId(request), body.values, body.initializeOnly));
  } catch (error) { return apiError(request, error, { fallback: '保存界面偏好失败' }); }
}
