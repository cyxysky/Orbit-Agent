import { z } from 'zod';
import { resolveExternalIntegration, upsertExternalIntegration } from '@/server/integrations/external-integration-vault';
import { resolveExternalIntegrationConfiguration } from '@/server/integrations/external-integration-drivers';
import { refreshCommunicationRuntime } from '@/server/integrations/communication-runtime';
import { ApiRequestError } from '@/server/http/api-request';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';
export const categorySchema = z.enum(['connector', 'communication', 'data']);
const configurationSchema = z.record(z.string().max(100), z.string().max(20_000)).refine(
  (value) => Object.keys(value).length <= 50,
  '配置字段过多。',
);
export const integrationSchema = z.object({
  id: z.string().uuid().optional(),
  category: categorySchema,
  driverId: z.string().trim().min(2).max(100),
  name: z.string().trim().min(1).max(200),
  configuration: configurationSchema,
  clearFields: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  enabled: z.boolean(),
}).strict();

export async function saveIntegrationSettings(raw: unknown, userId: string) {
  const body = integrationSchema.parse(raw);
  const existing = body.id ? await resolveExternalIntegration(body.id) : undefined;
  if (body.id && !existing) {
    throw new ApiRequestError('外部集成不存在。', { code: ERROR_CODES.INTEGRATION_NOT_FOUND, status: 404 });
  }
  const item = await upsertExternalIntegration({
    id: body.id,
    category: body.category,
    driverId: body.driverId,
    name: body.name,
    configuration: (current, items) => {
      const configuration = resolveExternalIntegrationConfiguration({
        driverId: body.driverId,
        category: body.category,
        configuration: {
          ...body.configuration,
          ...(body.driverId === 'wecom-aibot-mcp' ? { ownerUserId: current?.configuration.ownerUserId || userId } : {}),
        },
        clearFields: body.clearFields,
        existing: current,
      });
      if (body.driverId === 'wecom-aibot-mcp' && configuration.botId) {
        const duplicate = items.find(item => item.id !== body.id && item.driverId === body.driverId
          && item.configuration.botId === configuration.botId);
        if (duplicate) throw new ApiRequestError('此机器人已配置到另一个渠道，请修改已有渠道，避免长连接互相断开。');
      }
      return configuration;
    },
    enabled: body.enabled,
  });
  await refreshCommunicationRuntime();
  return item;
}
