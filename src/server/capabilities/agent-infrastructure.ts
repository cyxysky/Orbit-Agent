import { mediaModelsForConfig } from '@/lib/model-selection';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegStaticPath from 'ffmpeg-static';
import type { CapabilityProvider, CapabilityRunContext } from '@webpilot/capability-sdk';
import { createCodeSandboxCapability } from '@webpilot/capability-code-sandbox';
import { createNodeProcessCodeSandbox } from '@webpilot/capability-code-sandbox/node';
import { createHttpCodeSandboxExecutor } from '@webpilot/capability-code-sandbox/remote';
import { createNodeConnectorsCapability } from '@webpilot/capability-connectors/node';
import type { AgentConnector } from '@webpilot/capability-connectors';
import { createNodeKnowledgeCapability } from '@webpilot/capability-knowledge/node';
import { createDataCapability, createDataSourceRegistry, type AgentDataSource } from '@webpilot/capability-data';
import { createMediaCapability, type MediaOperations } from '@webpilot/capability-media';
import { createFfmpegMediaOperations } from '@webpilot/capability-media/node';
import { fileFormatForMimeType } from '@webpilot/capability-file';
import { createAiSdkMediaGenerationOperations } from '@webpilot/capability-media/ai-sdk';
import { store } from '@/server/db/store';
import { createNodeCommunicationCapability } from '@webpilot/capability-communication/node';
import type { CommunicationChannel } from '@webpilot/capability-communication';
import { createNodeGitCapability } from '@webpilot/capability-git/node';
import { createNodeComputerCapability } from '@webpilot/capability-computer/node';
import { createNodeWorkflowCapability } from '@webpilot/capability-workflow/node';
import type { BrowserCodeAttachmentBinding } from '@webpilot/capability-browser/node';
import { artifactApiUrl } from '@/lib/artifacts';
import { artifactPath, artifactsRoot, codeSandboxRoot } from '@/server/storage/paths';
import { communicationArtifactReader } from '@/server/storage/artifact-access';
import { resolveExternalIntegrations } from '@/server/integrations/external-integration-vault';
import { withCodeSandboxArtifacts } from './code-sandbox-artifacts';
import {
  createExternalCommunicationChannel,
  createExternalDataSource,
  createExternalIntegrationConnector,
} from '@/server/integrations/external-integration-drivers';

function safeSegment(value: unknown, fallback: string) {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 160) || fallback;
}

function createAgentCodeSandboxCapability(): CapabilityProvider {
  return createCodeSandboxCapability({
    createExecutor(context) {
      const backend = context.configuration.AGENT_CODE_SANDBOX_BACKEND === 'local' ? 'local' : 'remote';
      if (backend === 'remote') {
        return withCodeSandboxArtifacts(createHttpCodeSandboxExecutor({
          url: String(context.configuration.AGENT_CODE_SANDBOX_RUNNER_URL || '').trim(),
          token: String(context.configuration.AGENT_CODE_SANDBOX_RUNNER_TOKEN || '').trim() || undefined,
        }), context);
      }
      return withCodeSandboxArtifacts(createNodeProcessCodeSandbox({
        workspaceDirectory: codeSandboxRoot('agent-infrastructure', 'code', safeSegment(context.userId, 'shared'), safeSegment(context.runId, 'run'), randomUUID()),
        maxConcurrent: Number(context.configuration.AGENT_CODE_SANDBOX_MAX_CONCURRENCY) || 2,
      }), context);
    },
  });
}

async function configuredConnectors(context: CapabilityRunContext): Promise<AgentConnector[]> {
  const timeoutMs = Number(context.configuration.AGENT_CONNECTOR_TIMEOUT_MS) || 30_000;
  return (await resolveExternalIntegrations('connector'))
    .map((record) => createExternalIntegrationConnector(record, timeoutMs));
}

async function configuredCommunicationChannels(context: CapabilityRunContext): Promise<CommunicationChannel[]> {
  const timeoutMs = Number(context.configuration.AGENT_COMMUNICATION_TIMEOUT_MS) || 30_000;
  return (await resolveExternalIntegrations('communication'))
    .map((record) => createExternalCommunicationChannel(record, timeoutMs, communicationArtifactReader(context.userId)));
}

async function configuredDataSources(): Promise<AgentDataSource[]> {
  const sources: AgentDataSource[] = [];
  try {
    for (const record of await resolveExternalIntegrations('data')) {
      sources.push(await createExternalDataSource(record, 15_000));
    }
    return sources;
  } catch (error) {
    await Promise.allSettled(sources.map((source) => source.dispose?.()));
    throw error;
  }
}

export async function createConfiguredMediaOperations(input: { context: CapabilityRunContext; attachments: readonly BrowserCodeAttachmentBinding[] }): Promise<MediaOperations> {
  const byRef = new Map(input.attachments.map((attachment) => [attachment.ref, attachment.path]));
  const root = artifactsRoot();
  const resolveSource = async (sourceRef: string) => {
    const attachment = byRef.get(sourceRef);
    if (attachment) return attachment;
    let pathname = sourceRef;
    try { pathname = new URL(sourceRef, 'http://webpilot.local').pathname; } catch { /* validate the raw path below */ }
    const marker = '/api/artifacts/';
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) throw new Error('Media sourceRef must be a registered attachment id or Artifact URL.');
    const relative = pathname.slice(markerIndex + marker.length).split('/').map(decodeURIComponent);
    if (relative.some((segment) => !segment || segment === '.' || segment === '..' || /[\\/]/.test(segment))) throw new Error('Invalid media artifact reference.');
    const inRun = relative[0] === safeSegment(input.context.runId, 'shared');
    const ownUpload = relative[0] === 'uploads' && relative[1] === input.context.userId;
    if (!inRun && !ownUpload) throw new Error('Media sourceRef must belong to this run or be a registered attachment.');
    const resolved = path.resolve(root, ...relative);
    const relativeCheck = path.relative(root, resolved);
    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) throw new Error('Media artifact reference escapes the artifact root.');
    return resolved;
  };
  const configuration = mediaModelsForConfig(await store.getModelConfig());
  const generation = createAiSdkMediaGenerationOperations({
    configuration,
    selectedModels: configuration.defaults,
    async readSource(ref, context) {
      context.abortSignal?.throwIfAborted();
      const source = await resolveSource(ref);
      if ((await stat(source)).size > 50 * 1024 * 1024) throw new Error('参考图片不能超过 50 MB。');
      return readFile(source, { signal: context.abortSignal });
    },
    async publishArtifact(file, context) {
      context.abortSignal?.throwIfAborted();
      const format = fileFormatForMimeType(file.mediaType);
      const expectedKind = file.kind === 'speech' ? 'audio' : file.kind;
      if (!format || format.kind !== expectedKind) throw new Error(`不支持保存此媒体格式：${file.mediaType}`);
      const directory = artifactPath(safeSegment(input.context.runId, 'shared'), 'media');
      await mkdir(directory, { recursive: true });
      const fileName = `${file.kind}_${randomUUID()}${format.extension}`;
      const destination = path.join(directory, fileName);
      await writeFile(destination, file.data, { signal: context.abortSignal });
      const artifactId = path.relative(root, destination).split(path.sep).join('/');
      const url = artifactApiUrl(destination, { artifactsRoot: root });
      return { artifactId, fileName, mediaType: file.mediaType, url, downloadUrl: `${url}?download=1`, description: `Generated ${file.kind}` };
    },
  });
  const processing: MediaOperations = ffmpegStaticPath ? createFfmpegMediaOperations({
    ffmpegPath: ffmpegStaticPath,
    timeoutMs: Number(input.context.configuration.AGENT_MEDIA_TIMEOUT_MS) || 120_000,
    resolveSource,
    async publishArtifact(filePath) {
      const extension = path.extname(filePath).toLowerCase() || '.bin';
      const directory = artifactPath(safeSegment(input.context.runId, 'shared'), 'media');
      await mkdir(directory, { recursive: true });
      const artifactId = `media_${randomUUID()}${extension}`;
      const destination = path.join(directory, artifactId);
      await copyFile(filePath, destination);
      const url = artifactApiUrl(destination, { artifactsRoot: root });
      return { artifactId: path.relative(root, destination).split(path.sep).join('/'), fileName: artifactId, mediaType: extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : undefined, url, downloadUrl: `${url}?download=1` };
    },
  }) : { inspect: async () => { throw new Error('FFmpeg runtime is unavailable.'); } };
  return { ...processing, ...generation };
}

export function createAgentInfrastructureProviders(input: {
  attachmentBindings?: readonly BrowserCodeAttachmentBinding[];
} = {}): CapabilityProvider[] {
  return [
    createAgentCodeSandboxCapability(),
    createNodeConnectorsCapability({ connectors: configuredConnectors }),
    createNodeKnowledgeCapability({ directory: (context) => artifactPath('agent-infrastructure', 'knowledge', safeSegment(context.userId, 'shared')) }),
    createDataCapability({ createRegistry: async () => createDataSourceRegistry(await configuredDataSources()) }),
    createMediaCapability({ createOperations: (context) => createConfiguredMediaOperations({ context, attachments: input.attachmentBindings || [] }) }),
    createNodeCommunicationCapability({ channels: configuredCommunicationChannels, draftDirectory: (context) => artifactPath('agent-infrastructure', 'communication', safeSegment(context.userId, 'shared')) }),
    createNodeGitCapability({ repository: (context) => String(context.configuration.AGENT_GIT_REPOSITORY || '').trim() || process.cwd() }),
    createNodeComputerCapability({
      screenshotDirectory: (context) => artifactPath(
        safeSegment(context.runId, 'shared'),
        'computer',
      ),
    }),
    createNodeWorkflowCapability({ directory: (context) => artifactPath('agent-infrastructure', 'workflows', safeSegment(context.userId, 'shared')) }),
  ];
}

export const agentInfrastructureToolNames = Object.freeze([
  'codeSandbox',
  'connectors',
  'knowledge',
  'data',
  'media',
  'communication',
  'git',
  'computer',
  'workflow',
] as const);
