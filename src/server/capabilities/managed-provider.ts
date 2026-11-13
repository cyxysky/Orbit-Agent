import { defineCapabilityInput, defineCapabilityTool, createCapabilityRuntime, CodedError, ERROR_CODES,
  type CapabilityProvider, type CapabilityResult, type CapabilityExecutionContext, type CapabilityContent } from '@cjfclonedeep/capability-sdk';
import { managedToolCatalog } from '@cjfclonedeep/capability-sdk/managed/node';
import { toolInstaller, managedToolConfigurations, managedToolConnector } from './managed-tools';
import { artifactsRoot } from '@/server/storage/paths';
import { artifactApiUrl } from '@/lib/artifacts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { publishRealtimeRefreshEvent } from '@/server/realtime/ws-refresh';
import type { BrowserActionResult } from '@cjfclonedeep/capability-sdk/browser/node';
import type { ComposeVideoInput, MediaArtifact } from '@cjfclonedeep/capability-sdk/media';
import { saveCompositionProject } from './video-projects';

async function toolResult(value: unknown, sessionId: string, toolId: string): Promise<CapabilityResult> {
  const root = artifactsRoot();
  const workspace = path.join(root, sessionId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  const artifactKeys = new Set(['artifactId', 'sourceArtifactId', 'expectedArtifactId', 'attachmentArtifactIds']);
  function hostArtifactId(reference: string) {
    const filename = path.resolve(workspace, reference);
    const relative = path.relative(workspace, filename);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new CodedError(ERROR_CODES.FORBIDDEN, 'MCP 返回了当前对话目录之外的文件。');
    }
    return path.relative(root, filename).replace(/\\/g, '/');
  }
  function normalize(input: unknown, key = ''): unknown {
    if (typeof input === 'string' && input.startsWith('file://')) {
      const filename = fileURLToPath(input);
      hostArtifactId(filename);
      return artifactApiUrl(filename, { artifactsRoot: root }) + new URL(input).search;
    }
    if (typeof input === 'string' && artifactKeys.has(key) && input && !/^[a-z][a-z\d+.-]*:/i.test(input)) {
      return hostArtifactId(input);
    }
    if (Array.isArray(input)) return input.map(child => normalize(child, key));
    if (input && typeof input === 'object') {
      const object = Object.fromEntries(Object.entries(input).map(([name, child]) => [name, normalize(child, name)]));
      const url = [object.url, object.downloadUrl, object.uri].find(item => typeof item === 'string' && item.includes('/api/artifacts/'));
      if (object.artifactId && typeof url === 'string') {
        const reference = decodeURIComponent(url.split('/api/artifacts/')[1].split('?')[0]);
        object.artifactId = hostArtifactId(path.resolve(root, reference));
      }
      return object;
    }
    return input;
  }
  const raw = normalize(value) as { isError?: boolean; structuredContent?: unknown; content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };
  const structured = raw?.structuredContent as (CapabilityResult & { capabilityContent?: NonNullable<CapabilityResult['content']> }) | undefined;
  if (structured && typeof structured.ok === 'boolean') {
    const content: CapabilityContent[] = [...(structured.capabilityContent || structured.content || [])].filter(item => item.type !== 'image');
    for (const image of raw.content?.filter(item => item.type === 'image' && item.data) || []) {
      if (image.data!.length > 32 * 1024 * 1024) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, 'MCP 图像超过大小限制。');
      const directory = path.join(artifactsRoot(), sessionId, '.mcp-images');
      await mkdir(directory, { recursive: true });
      const filename = path.join(directory, randomUUID() + (image.mimeType === 'image/jpeg' ? '.jpg' : '.png'));
      await writeFile(filename, Buffer.from(image.data!, 'base64'), { mode: 0o600 });
      content.push({ type: 'image', artifactId: filename, mediaType: image.mimeType });
    }
    if (toolId === 'browser') {
      const data = (structured.ok ? structured.data : structured.error.details) as Record<string, unknown> | undefined;
      if (data?.browserSessionId) {
        const operation = { ok: structured.ok, actual: JSON.stringify(data), data,
          ...(data.observation ? { browserObservation: data.observation } : {}),
          ...(data.manualVerification ? { manualVerification: data.manualVerification, waitingForClient: true } : {}),
          referenceImagePaths: content.flatMap(item => item.type === 'image' ? [item.artifactId] : []),
          ...(!structured.ok ? { failureCategory: structured.error.code } : {}),
        } as BrowserActionResult;
        const envelope = { runtime: 'webpilot.browser-action-result' as const, result: operation };
        return structured.ok ? { ...structured, content, data: envelope } : { ...structured, content, error: { ...structured.error, details: envelope } };
      }
    }
    return { ...structured, content };
  }
  const text = raw.content?.filter(part => part.type === 'text').map(part => part.text || '').join('\n') || '';
  let parsed: CapabilityResult | undefined;
  try { parsed = JSON.parse(text) as CapabilityResult; } catch { /* third-party MCP text result */ }
  if (parsed && typeof parsed.ok === 'boolean') return normalize(parsed) as CapabilityResult;
  return raw.isError ? { ok: false, error: { code: ERROR_CODES.CAPABILITY_EXECUTION_FAILED, message: text || 'MCP tool failed' }, data: raw }
    : { ok: true, summary: text.slice(0, 2000) || 'MCP tool completed', data: raw };
}

export async function createManagedToolProviders(input: {
  allowed: ReadonlySet<string>; userId: string; sessionId: string; runId: string;
  attachments?: readonly { ref: string; path: string; name: string }[];
  credentials?: readonly unknown[] | (() => readonly unknown[] | undefined);
  sourcePageUrl?: () => string;
  beforeCall?: (id: string, args: Record<string, unknown>, context: CapabilityExecutionContext) => Promise<Record<string, string> | undefined>;
  afterCall?: (id: string, result: CapabilityResult) => Promise<void>;
}): Promise<CapabilityProvider[]> {
  const configurations = await managedToolConfigurations();
  const installer = toolInstaller();
  return managedToolCatalog().flatMap(definition => {
    if (!input.allowed.has(definition.id) || !configurations[definition.id]?.enabled) return [];
    const installed = installer.installed(definition.id);
    if (!installed) return [];
    return [{
      manifest: { schemaVersion: 1, id: 'com.orbit.mcp.' + definition.id.toLowerCase(), name: definition.title, description: definition.description, version: installed.version },
      async createRuntime() {
        const tools = Object.fromEntries(installed.tools.map(remote => [remote.name, defineCapabilityTool({
          name: remote.name, description: remote.description || definition.description,
          input: defineCapabilityInput(remote.inputSchema, value => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CodedError(ERROR_CODES.INVALID_INPUT, 'MCP 工具参数需要对象。');
            return value as Record<string, unknown>;
          }),
          async execute(args, context) {
            const bindings = new Map((input.attachments || []).map(binding => [binding.ref, binding]));
            async function bind(reference: string) {
              const source = bindings.get(reference);
              if (!source) return reference.startsWith(input.sessionId + '/') ? reference.slice(input.sessionId.length + 1) : reference;
              const directory = path.join(artifactsRoot(), input.sessionId, '.inputs');
              await mkdir(directory, { recursive: true });
              const name = createHash('sha256').update(source.ref + source.path).digest('hex').slice(0, 24) + path.extname(source.name);
              await copyFile(source.path, path.join(directory, name));
              return path.posix.join('.inputs', name);
            }
            const referenceKeys = new Set(['artifactId', 'sourceArtifactId', 'sourceRef', 'audioRef', 'maskRef', 'sourceRefs', 'attachmentArtifactIds', 'ref']);
            async function forward(value: unknown, key = ''): Promise<unknown> {
              if (typeof value === 'string' && referenceKeys.has(key)) return bind(value);
              if (Array.isArray(value)) return Promise.all(value.map(item => forward(item, key)));
              if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([name, child]) => [name, await forward(child, name)])));
              return value;
            }
            const forwarded = await forward(args) as Record<string, unknown>;
            if (typeof forwarded.attachmentId === 'string' && bindings.has(forwarded.attachmentId)) {
              forwarded.artifactId = await bind(forwarded.attachmentId); delete forwarded.attachmentId;
            }
            const env = await input.beforeCall?.(definition.id, forwarded, context);
            const metadata = definition.id === 'browser' ? { credentials: typeof input.credentials === 'function' ? input.credentials() : input.credentials, targetId: env?.BROWSER_CDP_TARGET_ID }
              : definition.id === 'file' ? { sourcePageUrl: input.sourcePageUrl?.(),
                attachments: await Promise.all((input.attachments || []).map(async source => ({ ...source, path: path.join(artifactsRoot(), input.sessionId, await bind(source.ref)) }))) } : undefined;
            const connector = await managedToolConnector({ ...input, id: definition.id, env,
              metadata });
            const result = await toolResult(await connector.call(remote.name, forwarded, context), input.sessionId, definition.id);
            await input.afterCall?.(definition.id, result);
            if (definition.id === 'media' && forwarded.action === 'composeVideo' && result.ok && Array.isArray(result.data)) {
              for (const artifact of result.data as MediaArtifact[]) {
                try {
                  const project = await saveCompositionProject({ userId: input.userId, composition: forwarded as unknown as ComposeVideoInput, output: artifact, signal: context.abortSignal,
                    async resolveSource(ref) {
                      const directory = await realpath(path.join(artifactsRoot(), input.sessionId));
                      const filename = await realpath(path.resolve(directory, ref));
                      if (!filename.startsWith(directory + path.sep)) throw new CodedError(ERROR_CODES.FORBIDDEN, '视频素材超出当前对话。');
                      return filename;
                    } });
                  artifact.description = `${artifact.description || ''} Editable video project ${project.id} saved.`;
                } catch (error) {
                  artifact.description = `${artifact.description || ''} Video saved; editable project could not be saved: ${error instanceof Error ? error.message : String(error)}`;
                }
              }
            }
            if (definition.id === 'chart' && result.ok && ['create', 'update'].includes(String(forwarded.action))) {
              const data = result.data as { chart?: { chartId?: string; revision?: number }; chartId?: string; revision?: number } | undefined;
              const chart = data?.chart || data;
              if (chart?.chartId) void publishRealtimeRefreshEvent({ entityType: 'chart', id: input.sessionId + '/' + chart.chartId, userId: input.userId, patch: { revision: chart.revision } }).catch(() => undefined);
            }
            return result;
          },
        })]));
        return createCapabilityRuntime({ tools });
      },
    } satisfies CapabilityProvider];
  });
}
