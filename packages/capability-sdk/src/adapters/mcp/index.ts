import { randomUUID } from 'node:crypto';
import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type CallToolResult,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createMcpVisualization, type McpVisualizationOptions } from '../../../scripts/mcp-ui.mjs';
import {
  capabilitySkillReadJsonSchema,
  createCapabilityExecutor,
  disposeOnce,
  type CapabilityExecutionPolicyOptions,
  type CapabilityContent,
  type CapabilityProvider,
  type CapabilityResult,
  type CapabilityRunContext,
} from '../../index.ts';
import {
  mountCapabilities,
  type CapabilityConfigScope,
  type CapabilityConfigStore,
  type CapabilitySkillInstructionMode,
} from '../../host/index.ts';

export type CapabilityMcpServerOptions = {
  /** Shared MCP Apps UI and loopback preview for chart/maps. Enabled by default. */
  visualization?: McpVisualizationOptions;
  policy?: CapabilityExecutionPolicyOptions;
  resolveImage?: (content: Extract<CapabilityContent, { type: 'image' }>) => Promise<{ data: string; mimeType: string }>;
  providers: readonly CapabilityProvider[];
  name?: string;
  version?: string;
  instructions?: string;
  context?: Partial<CapabilityRunContext> | (() => Partial<CapabilityRunContext>);
  configurations?: Readonly<Record<string, CapabilityRunContext['configuration']>>;
  configStore?: CapabilityConfigStore;
  configScope?: CapabilityConfigScope;
  skillMode?: CapabilitySkillInstructionMode;
  skillToolName?: string;
};

function resolvedContext(options: CapabilityMcpServerOptions): CapabilityRunContext {
  const configured = typeof options.context === 'function' ? options.context() : options.context;
  return {
    runId: configured?.runId || `mcp-${randomUUID()}`,
    sessionId: configured?.sessionId,
    userId: configured?.userId,
    abortSignal: configured?.abortSignal,
    metadata: configured?.metadata,
    configuration: configured?.configuration || {},
  };
}

function mcpContent(content: CapabilityContent): CallToolResult['content'][number] {
  if (content.type === 'text') return content;
  if (content.type === 'image' && content.data) return { type: 'image', data: content.data, mimeType: content.mediaType || 'image/png' };
  if (content.type === 'artifact' && content.downloadUrl) {
    return {
      type: 'resource_link',
      name: content.artifactId,
      uri: content.downloadUrl,
      mimeType: content.mediaType,
    };
  }
  return {
    type: 'text',
    text: JSON.stringify(content),
  };
}

export function capabilityResultToMcpResult(result: CapabilityResult): CallToolResult {
  if (!result.ok) {
    return {
      isError: true,
      content: [{ type: 'text', text: result.error.message }],
      structuredContent: {
        ok: false,
        error: result.error,
      },
    };
  }
  const content = result.content?.map(mcpContent) || [];
  if (!content.some((item) => item.type === 'text')) {
    content.unshift({ type: 'text', text: result.summary });
  }
  return {
    content,
    structuredContent: {
      ok: true,
      summary: result.summary,
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.content?.length ? { capabilityContent: result.content } : {}),
    },
  };
}

export async function createCapabilityMcpServer(
  options: CapabilityMcpServerOptions,
) {
  const runContext = resolvedContext(options);
  const executeCapability = createCapabilityExecutor(options.policy);
  const snapshot = await mountCapabilities({
    providers: options.providers,
    context: runContext,
    configurations: options.configurations,
    configStore: options.configStore,
    configScope: options.configScope,
  });
  const skillMode = options.skillMode || 'eager';
  const skillToolName = options.skillToolName || 'skill';
  const skillInstructions = snapshot.skillCatalog.instructions(skillMode, { skillToolName });
  const instructions = [options.instructions, skillInstructions]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('\n\n');
  let visualization: Awaited<ReturnType<typeof createMcpVisualization>>;
  try {
    const server = new McpServer({
      name: options.name || 'webpilot-capabilities',
      version: options.version || '0.1.0',
    }, instructions ? { instructions } : undefined);
    visualization = await createMcpVisualization({ tools: snapshot.tools, options: options.visualization,
      invoke: async (name, input) => {
        const resolved = snapshot.tools[name];
        if (!resolved) throw new Error('Visualization tool is unavailable.');
        const parsed = resolved.tool.input.parse(input);
        return executeCapability(resolved, { invocationId: randomUUID(), abortSignal: snapshot.abortSignal,
          metadata: { transport: 'visualization' } }, context => resolved.tool.execute(parsed, context));
      },
    });
    visualization?.register(server);

    if (skillMode === 'lazy' && snapshot.skills.length) {
      if (snapshot.tools[skillToolName]) {
        throw new Error(`Capability Skill tool name collides with an existing tool: ${skillToolName}.`);
      }
      server.registerTool(skillToolName, {
        title: 'Read Capability Skill',
        description: `Read one Capability Skill by exact id. Available ids: ${snapshot.skills.map((skill) => skill.id).join(', ')}.`,
        inputSchema: fromJsonSchema(capabilitySkillReadJsonSchema(snapshot.skills.map((skill) => skill.id))),
        _meta: {
          'com.webpilot/capabilitySkillTool': true,
        },
      }, async (input: unknown) => {
        const value = input && typeof input === 'object' && !Array.isArray(input)
          ? input as Record<string, unknown>
          : {};
        const skillId = typeof value.skillId === 'string' ? value.skillId.trim() : '';
        const skill = value.action === 'read' ? snapshot.skillCatalog.get(skillId) : undefined;
        if (!skill) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Unknown Capability Skill: ${skillId || '(empty)'}.` }],
          };
        }
        return {
          content: [{ type: 'text', text: skill.content }],
          structuredContent: {
            ok: true,
            loadedRuntimeSkill: {
              id: skill.id,
              title: skill.title,
              content: skill.content,
            },
          },
        };
      });
    }

    for (const [publicName, resolved] of Object.entries(snapshot.tools)) {
      server.registerTool(publicName, {
        title: resolved.tool.name,
        description: resolved.tool.description,
        inputSchema: fromJsonSchema(resolved.tool.input.jsonSchema),
        _meta: {
          'com.webpilot/capabilityId': resolved.capabilityId,
          'com.webpilot/capabilityVersion': resolved.capabilityVersion,
          'com.webpilot/internalToolId': resolved.internalId,
          ...visualization?.toolMeta(publicName),
        },
      }, async (input: unknown, context) => {
        try {
          const parsed = resolved.tool.input.parse(input);
          const abortSignal = snapshot.abortSignal
            ? AbortSignal.any([snapshot.abortSignal, context.mcpReq.signal])
            : context.mcpReq.signal;
          const progressToken = context.mcpReq._meta?.progressToken;
          let progress = 0;
          const executionContext = {
            invocationId: randomUUID(),
            abortSignal,
            metadata: {
              transport: context.http ? 'streamable-http' : 'stdio',
            },
          };
          let result = await executeCapability(resolved, {
            ...executionContext,
            reportProgress: async (event) => {
              await options.policy?.reportProgress?.(event, executionContext);
              if (typeof progressToken !== 'string' && typeof progressToken !== 'number') return;
              progress = Math.max(progress + 1, event.current ?? 0);
              await context.mcpReq.notify({ method: 'notifications/progress', params: {
                progressToken, progress, message: event.message,
                ...(event.total !== undefined ? { total: Math.max(progress, event.total) } : {}),
              } });
            },
          }, (execution) => resolved.tool.execute(parsed, execution));
          if (result.ok && result.content?.some((item) => item.type === 'image' && !item.data) && options.resolveImage) {
            const content = await Promise.all(result.content.map(async (item): Promise<CapabilityContent> => {
              if (item.type !== 'image' || item.data) return item;
              const image = await options.resolveImage!(item);
              return { ...item, data: image.data, mediaType: image.mimeType };
            }));
            result = { ...result, content };
          }
          const response = capabilityResultToMcpResult(result);
          if (visualization) {
            try {
              const view = await visualization.decorate(publicName, result);
              response.content.push(...view.content || []);
              if (view._meta) response._meta = view._meta;
            } catch (error) {
              // Presentation failure must not turn an already-saved chart into
              // a failed tool call that the model might repeat.
              response.content.push({ type: 'text', text: `Visualization unavailable: ${error instanceof Error ? error.message : String(error)}` });
            }
          }
          return response;
        } catch (error) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            }],
          };
        }
      });
    }

    const close = server.close.bind(server);
    server.close = disposeOnce(async () => {
      const settled = await Promise.allSettled([visualization?.close(), snapshot.dispose(), close()]);
      const errors = settled.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'MCP server cleanup failed.');
    });
    return server;
  } catch (error) {
    await visualization?.close();
    try { await snapshot.dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'MCP mount and cleanup failed.', { cause: error }); }
    throw error;
  }
}

export function createCapabilityMcpHandler(options: CapabilityMcpServerOptions): McpHttpHandler {
  return createMcpHandler(() => createCapabilityMcpServer(options));
}

export function serveCapabilityMcpStdio(options: CapabilityMcpServerOptions): StdioServerHandle {
  return serveStdio(() => createCapabilityMcpServer(options));
}
