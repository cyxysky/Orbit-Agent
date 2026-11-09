import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { connectorConfigurationPatchSchema, connectorSettingFields, mergeConnectorConfiguration,
  publicConnectorConfiguration, type AgentConnector, type ConnectorConfigurationDescriptor } from '@cjfclonedeep/capability-sdk/integrations/connectors';
import { createExternalIntegrationConnector } from '@/server/integrations/external-integration-drivers';
import { resolveExternalIntegration, updateExternalIntegrationConfiguration, type ResolvedExternalIntegration } from '@/server/integrations/external-integration-vault';
import { connectorDefaultsKey, connectorDisabledToolsKey, connectorDisabledTools, connectorToolDefaults, connectorDefaultsRevision } from '@/server/integrations/connector-tool-defaults';
import { ApiRequestError } from '@/server/http/api-request';

export const toolSettingsQuerySchema = z.object({
  id: z.string().uuid(), scope: z.enum(['tool', 'service']).default('tool'),
  target: z.string().min(1).max(160).optional(), q: z.string().max(200).default(''),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
const defaultsSaveSchema = connectorConfigurationPatchSchema.extend({
  id: z.string().uuid(), scope: z.enum(['tool', 'service']), target: z.string().min(1).max(160),
}).strict();
export const toolSettingsSaveSchema = z.union([defaultsSaveSchema, z.object({
  id: z.string().uuid(), action: z.literal('set-enabled'), target: z.string().min(1).max(160), enabled: z.boolean(),
}).strict()]);
type Query = z.infer<typeof toolSettingsQuerySchema>;

async function withConnector<T>(id: string, signal: AbortSignal | undefined,
  callback: (integration: ResolvedExternalIntegration, connector: AgentConnector, context: { invocationId: string; abortSignal?: AbortSignal }) => Promise<T>) {
  const integration = await resolveExternalIntegration(id);
  if (!integration || integration.category !== 'connector') throw new ApiRequestError('MCP 集成不存在。', { status: 404 });
  const connector = createExternalIntegrationConnector(integration, 30_000, { administration: true });
  try { return await callback(integration, connector, { invocationId: randomUUID(), abortSignal: signal }); }
  finally { await Promise.resolve(connector.dispose?.()).catch(() => undefined); }
}
async function descriptors(connector: AgentConnector, scope: Query['scope'], context: { invocationId: string; abortSignal?: AbortSignal }): Promise<ConnectorConfigurationDescriptor[]> {
  return scope === 'service' ? await connector.settings?.list(context) || []
    : (await connector.listOperations(context)).map(operation => ({ id: operation.id, title: operation.title || operation.id,
      description: operation.description, schema: operation.inputSchema || {}, writable: true }));
}
function fieldsFor(descriptor: ConnectorConfigurationDescriptor) {
  try { return { fields: connectorSettingFields(descriptor.schema), unsupported: undefined }; }
  catch { return { fields: [], unsupported: '此工具未声明可配置的对象参数结构。' }; }
}
function defaultState(integration: ResolvedExternalIntegration, descriptor: ConnectorConfigurationDescriptor) {
  const defaults = connectorToolDefaults(integration.configuration);
  return publicConnectorConfiguration(descriptor.schema, {
    values: Object.hasOwn(defaults, descriptor.id) ? defaults[descriptor.id] : {}, configuredSecrets: [],
    revision: connectorDefaultsRevision(integration.configuration),
  });
}
export async function readIntegrationToolSettings(query: Query, signal?: AbortSignal) {
  return withConnector(query.id, signal, async (integration, connector, context) => {
    const targets = await descriptors(connector, query.scope, context);
    if (!query.target) {
      const q = query.q.trim().toLocaleLowerCase();
      const filtered = targets.filter(target => !q || `${target.id} ${target.title}`.toLocaleLowerCase().includes(q));
      return { items: filtered.slice(query.offset, query.offset + 20).map(target => ({ id: target.id, title: target.title,
        description: target.description?.slice(0, 2000), writable: target.writable, fieldCount: fieldsFor(target).fields.length,
        enabled: query.scope === 'tool' ? !connectorDisabledTools(integration.configuration).has(target.id) : undefined })),
        total: filtered.length, offset: query.offset, pageSize: 20 };
    }
    const descriptor = targets.find(target => target.id === query.target);
    if (!descriptor) throw new ApiRequestError('工具配置项不存在，请重新加载。', { status: 404 });
    const fields = fieldsFor(descriptor);
    return { title: descriptor.title, description: descriptor.description?.slice(0, 2000), ...fields,
      writable: descriptor.writable && !fields.unsupported,
      state: fields.unsupported ? undefined : query.scope === 'service'
        ? await connector.settings!.read(descriptor.id, context) : defaultState(integration, descriptor) };
  });
}
export async function saveIntegrationToolSettings(body: z.infer<typeof toolSettingsSaveSchema>, signal?: AbortSignal) {
  if ('action' in body) {
    const integration = await resolveExternalIntegration(body.id);
    if (!integration || integration.category !== 'connector') throw new ApiRequestError('MCP 集成不存在。', { status: 404 });
    const updated = await updateExternalIntegrationConfiguration(body.id, current => {
      const disabled = connectorDisabledTools(current.configuration);
      if (body.enabled) disabled.delete(body.target); else disabled.add(body.target);
      const json = JSON.stringify([...disabled].sort());
      if (disabled.size > 1000 || json.length > 20_000) throw new ApiRequestError('停用工具数量超出此服务的配置限制。');
      return { ...current.configuration, [connectorDisabledToolsKey]: json };
    });
    return { enabled: !connectorDisabledTools(updated.configuration).has(body.target) };
  }
  return withConnector(body.id, signal, async (integration, connector, context) => {
    const descriptor = (await descriptors(connector, body.scope, context)).find(target => target.id === body.target);
    if (!descriptor || !descriptor.writable) throw new ApiRequestError('此配置不可写。');
    const fields = fieldsFor(descriptor);
    if (fields.unsupported) throw new ApiRequestError(fields.unsupported);
    if (body.scope === 'service') return { state: await connector.settings!.write(descriptor.id,
      { values: body.values, clearKeys: body.clearKeys, expectedRevision: body.expectedRevision }, context) };
    const updated = await updateExternalIntegrationConfiguration(body.id, current => {
      if (!current || current.updatedAt !== integration.updatedAt || connectorDefaultsRevision(current.configuration) !== body.expectedRevision) {
        throw new ApiRequestError('配置已被修改，请重新加载后保存。', { status: 409 });
      }
      const defaults = connectorToolDefaults(current.configuration);
      const allowed = new Set(fields.fields.map(field => field.key));
      const previous = Object.hasOwn(defaults, descriptor.id) ? defaults[descriptor.id] : {};
      const next = mergeConnectorConfiguration(descriptor.schema,
        Object.fromEntries(Object.entries(previous).filter(([key]) => allowed.has(key))), body, true);
      Object.defineProperty(defaults, descriptor.id, { value: next, enumerable: true, configurable: true, writable: true });
      if (!Object.keys(next).length) delete defaults[descriptor.id];
      const json = JSON.stringify(defaults);
      if (json.length > 20_000) throw new ApiRequestError('此 MCP 集成的参数默认值总大小不能超过 20,000 字符。');
      return { ...current.configuration, [connectorDefaultsKey]: json };
    });
    return { state: defaultState(updated, descriptor) };
  });
}
