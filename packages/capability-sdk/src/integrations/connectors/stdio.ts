import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { createStdioTransport } from '../../../runtime/managed/stdio-transport.cjs';
import type { CapabilityExecutionContext } from '../../index.ts';
import type { AgentConnector, ConnectorOperation } from './index.ts';
import { CodedError, ERROR_CODES } from '../../errors.ts';
import { connectorConfigurationPatchSchema, connectorConfigurationStateSchema, mcpConfigurationMetaKey,
  parseMcpConfigurationDescriptor, publicConnectorConfiguration } from './configuration.ts';

export type McpStdioConnection = {
  id: string; name?: string; command: string; args?: string[]; cwd?: string;
  env?: Record<string, string>; timeoutMs?: number;
  argumentDefaults?: (name: string, context: CapabilityExecutionContext) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

/** Each connector owns one process and its environment; imports never start it. */
export function createMcpStdioConnector(input: McpStdioConnection): AgentConnector {
  let connecting: Promise<MCPClient> | undefined;
  let closed = false;
  let cached: Awaited<ReturnType<MCPClient['listTools']>> | undefined;
  let cachedAt = 0;
  const lifetime = new AbortController();
  function signal(context: CapabilityExecutionContext) {
    return AbortSignal.any([lifetime.signal, AbortSignal.timeout(input.timeoutMs || 120_000), ...(context.abortSignal ? [context.abortSignal] : [])]);
  }
  function client() {
    if (closed) throw new CodedError(ERROR_CODES.CONNECTOR_OPERATION_FAILED, 'MCP process has been stopped.');
    return connecting ||= (async () => {
      const transport = createStdioTransport({ command: input.command, args: input.args,
        cwd: input.cwd, env: input.env, stderr: 'ignore' });
      try {
        const connected = await createMCPClient({ transport, clientName: 'capability-sdk', maxRetries: 0,
          initializationOptions: { timeout: input.timeoutMs || 120_000, signal: lifetime.signal } });
        if (closed) { await connected.close(); throw new Error('MCP process was stopped while connecting.'); }
        return connected;
      } catch (error) { await transport.close().catch(() => undefined); connecting = undefined; throw error; }
    })();
  }
  async function tools(context: CapabilityExecutionContext) {
    if (cached && Date.now() - cachedAt < 30_000) return cached.tools;
    const result = await (await client()).listTools({ options: { signal: signal(context) } });
    if (result.tools.length > 10_000) throw new CodedError(ERROR_CODES.CONNECTOR_OPERATION_FAILED, 'MCP tool listing exceeds its size limit.');
    cached = result; cachedAt = Date.now();
    return result.tools;
  }
  async function configuration(id: string, context: CapabilityExecutionContext) {
    const tool = (await tools(context)).find(item => item.name === id);
    const descriptor = tool && parseMcpConfigurationDescriptor(tool.name, tool._meta);
    if (!descriptor) throw new CodedError(ERROR_CODES.CONNECTOR_OPERATION_NOT_FOUND, 'MCP service has no configuration interface.');
    return descriptor;
  }
  async function callConfiguration(id: string, args: Record<string, unknown>, context: CapabilityExecutionContext) {
    const descriptor = await configuration(id, context);
    if (args.action === 'set' && !descriptor.writable) throw new CodedError(ERROR_CODES.FORBIDDEN, 'MCP configuration is read-only.');
    const result = await (await client()).callTool({ name: id, arguments: args, options: { signal: signal(context) } });
    if (result.isError) throw new CodedError(ERROR_CODES.CONNECTOR_OPERATION_FAILED, 'MCP configuration request failed.');
    const content = Array.isArray(result.content) ? result.content as Array<{ type: string; text?: string }> : [];
    const text = content.find(part => part.type === 'text');
    const value = result.structuredContent ?? JSON.parse(text && 'text' in text ? String(text.text) : 'null');
    return publicConnectorConfiguration(descriptor.schema, connectorConfigurationStateSchema.parse(value));
  }
  return {
    id: input.id, name: input.name || input.id, kind: 'mcp',
    async listOperations(context) {
      return (await tools(context)).filter(tool => !tool._meta?.[mcpConfigurationMetaKey]).map(tool => ({
        id: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema,
        readOnly: typeof tool.annotations?.readOnlyHint === 'boolean' ? tool.annotations.readOnlyHint : undefined,
      } satisfies ConnectorOperation));
    },
    async call(name, args, context) {
      const definition = (await tools(context)).find(tool => tool.name === name && !tool._meta?.[mcpConfigurationMetaKey]);
      if (!definition) throw new CodedError(ERROR_CODES.CONNECTOR_OPERATION_NOT_FOUND, 'MCP tool is unavailable.');
      const defaults = await input.argumentDefaults?.(name, context) || {};
      return (await client()).callTool({ name, arguments: { ...defaults, ...args }, options: { signal: signal(context) } });
    },
    settings: {
      async list(context) { return (await tools(context)).flatMap(tool => {
        const descriptor = parseMcpConfigurationDescriptor(tool.name, tool._meta);
        return descriptor ? [descriptor] : [];
      }); },
      read(id, context) { return callConfiguration(id, { action: 'get' }, context); },
      write(id, patch, context) { return callConfiguration(id, { action: 'set', ...connectorConfigurationPatchSchema.parse(patch) }, context); },
    },
    async health() { return { status: closed ? 'unhealthy' : 'healthy', message: closed ? 'MCP process stopped' : undefined }; },
    async dispose() {
      if (closed) return;
      closed = true; lifetime.abort(); cached = undefined;
      const pending = connecting; connecting = undefined;
      if (pending) await pending.then(value => value.close()).catch(() => undefined);
    },
  };
}
