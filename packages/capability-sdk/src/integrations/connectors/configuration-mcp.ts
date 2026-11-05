import { fromJsonSchema, type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { connectorConfigurationPatchSchema, connectorConfigurationProperties, mergeConnectorConfiguration,
  publicConnectorConfiguration, mcpConfigurationMetaKey, type ConnectorConfigurationState } from './configuration.ts';

/** The service owns authorization, persistence, revision checks and applying changes to its runtime. */
export type McpConfigurationHost = {
  name: string; title: string; description?: string; schema: Record<string, unknown>;
  authorize(action: 'get' | 'set', context: unknown): void | Promise<void>;
  read(context: unknown): Promise<Omit<ConnectorConfigurationState, 'configuredSecrets'>>;
  write?(values: Record<string, unknown>, expectedRevision: string, context: unknown): Promise<void>;
};

/** Optional Orbit contract on standard tools/list and tools/call; not a standard MCP settings API. */
export function registerMcpConfigurationTool(server: McpServer, host: McpConfigurationHost) {
  connectorConfigurationProperties(host.schema);
  const input = z.discriminatedUnion('action', [z.object({ action: z.literal('get') }).strict(),
    connectorConfigurationPatchSchema.extend({ action: z.literal('set') }).strict()]);
  let pending: Promise<unknown> = Promise.resolve();
  return server.registerTool(host.name, {
    title: host.title, description: host.description,
    inputSchema: fromJsonSchema({ type: 'object', properties: { action: { type: 'string', enum: ['get', 'set'] },
      values: { type: 'object', additionalProperties: true }, clearKeys: { type: 'array', items: { type: 'string' } },
      expectedRevision: { type: 'string' } }, required: ['action'], additionalProperties: false }),
    _meta: { [mcpConfigurationMetaKey]: { version: 1, title: host.title, description: host.description,
      schema: host.schema, writable: Boolean(host.write) } },
  }, async (raw, context) => {
    const patch = input.parse(raw);
    await host.authorize(patch.action, context);
    const operation = async () => {
      let state = await host.read(context);
      if (patch.action === 'set') {
        if (!host.write) throw new Error('Configuration is read-only.');
        if (state.revision !== patch.expectedRevision) throw new Error('Configuration changed. Reload before saving.');
        const values = mergeConnectorConfiguration(host.schema, state.values, patch);
        await host.write(values, patch.expectedRevision, context);
        state = await host.read(context);
      }
      const result = publicConnectorConfiguration(host.schema, { ...state, configuredSecrets: [] });
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    };
    const result = pending.then(operation);
    pending = result.then(() => undefined, () => undefined);
    return result;
  });
}
