import { runtimeConfiguration, runtimeSetting } from '@/server/settings/runtime-configuration';
import { createSelfBootstrapCapability } from './self-bootstrap';
import { refreshExtensionToolCatalog } from './extensions';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { isRuntimeToolEnabled } from '@/server/runtime/self-bootstrap-policy';
import { mediaModelsForConfig } from '@/lib/model-selection';
import { resolveCodexCliPath } from '@/server/ai/codex-cli';
import { prepareCodexIdentityHome } from '@/server/ai/codex-identity';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireToolModule } from '@cjfclonedeep/capability-sdk/managed/node';
import type { CapabilityProvider, CapabilityRunContext } from '@cjfclonedeep/capability-sdk';
import { createNodeConnectorsCapability } from '@cjfclonedeep/capability-sdk/integrations/connectors/node';
import type { AgentConnector } from '@cjfclonedeep/capability-sdk/integrations/connectors';
import { createTextEditorCapability } from '@cjfclonedeep/capability-sdk/text-editor';
import { createFileTextEditorOperations } from '@cjfclonedeep/capability-sdk/text-editor/node';
import { importLegacyTextDocuments, textUserDirectory } from './text-storage';
import { saveCompositionProject } from './video-projects';
import { createDataCapability, createDataSourceRegistry, type AgentDataSource } from '@cjfclonedeep/capability-sdk/data';
import type { MediaOperations } from '@cjfclonedeep/capability-sdk/media';
import { createRemotionMediaOperations } from '@cjfclonedeep/capability-sdk/media/node';
import { fileFormatForMimeType } from '@cjfclonedeep/capability-sdk/file';
import { createAiSdkMediaGenerationOperations } from '@cjfclonedeep/capability-sdk/media/ai-sdk';
import { store } from '@/server/db/store';
import { createNodeCommunicationCapability } from '@cjfclonedeep/capability-sdk/integrations/communication/node';
import type { CommunicationChannel } from '@cjfclonedeep/capability-sdk/integrations/communication';
import type { BrowserCodeAttachmentBinding } from '@cjfclonedeep/capability-sdk/browser/node';
import { artifactApiUrl } from '@/lib/artifacts';
import { artifactPath, artifactsRoot } from '@/server/storage/paths';
import { communicationArtifactReader } from '@/server/storage/artifact-access';
import { resolveExternalIntegrations } from '@/server/integrations/external-integration-vault';
import {
  createExternalCommunicationChannel,
  createExternalDataSource,
  createExternalIntegrationConnector,
} from '@/server/integrations/external-integration-drivers';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


function safeSegment(value: unknown, fallback: string) {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 160) || fallback;
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
    if (markerIndex < 0) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Media sourceRef must be a registered attachment id or Artifact URL.');
    const relative = pathname.slice(markerIndex + marker.length).split('/').map(decodeURIComponent);
    if (relative.some((segment) => !segment || segment === '.' || segment === '..' || /[\\/]/.test(segment))) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Invalid media artifact reference.');
    const inRun = relative[0] === safeSegment(input.context.runId, 'shared');
    const ownUpload = relative[0] === 'uploads' && relative[1] === input.context.userId;
    const ownVideoProject = relative[0] === 'media-projects' && relative[1] === input.context.userId;
    if (!inRun && !ownUpload && !ownVideoProject) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Media sourceRef must belong to this run or be a registered attachment.');
    const resolved = path.resolve(root, ...relative);
    const relativeCheck = path.relative(root, resolved);
    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Media artifact reference escapes the artifact root.');
    return resolved;
  };
  const configuration = mediaModelsForConfig(await store.getModelConfig());
  const generation = createAiSdkMediaGenerationOperations({
    configuration,
    codex: {
      codexPath: resolveCodexCliPath(runtimeSetting('CODEX_PATH'), process.cwd()),
      env: configuration.models.some(model => model.enabled && model.driver === 'codex')
        ? { CODEX_HOME: await prepareCodexIdentityHome('media', true) } : undefined,
    },
    selectedModels: configuration.defaults,
    async readSource(ref, context) {
      context.abortSignal?.throwIfAborted();
      const source = await resolveSource(ref);
      if ((await stat(source)).size > 50 * 1024 * 1024) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, '参考图片不能超过 50 MB。');
      return readFile(source, { signal: context.abortSignal });
    },
    async publishArtifact(file, context) {
      context.abortSignal?.throwIfAborted();
      const format = fileFormatForMimeType(file.mediaType);
      const expectedKind = file.kind === 'speech' ? 'audio' : file.kind;
      if (!format || format.kind !== expectedKind) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, `不支持保存此媒体格式：${file.mediaType}`);
      const directory = artifactPath(safeSegment(input.context.runId, 'shared'), 'media');
      await mkdir(directory, { recursive: true });
      const fileName = `${file.kind}_${randomUUID()}${format.extension}`;
      const destination = path.join(directory, fileName);
      await writeFile(destination, file.data, { signal: context.abortSignal });
      const artifactId = path.relative(root, destination).split(path.sep).join('/');
      const url = artifactApiUrl(destination, { artifactsRoot: root });
      return { artifactId, fileName, mediaType: file.mediaType, url, downloadUrl: `${url}?download=1`, description: `Generated ${file.kind}, already saved. For document use, file plan/list exposes it in availableAssets (ref = artifactId). Use assetName directly; do not download it again.` };
    },
  });
  const processing: MediaOperations = createRemotionMediaOperations({
    ffmpegPath: requireToolModule<string>('ffmpeg-static') || undefined,
    timeoutMs: Number(input.context.configuration.AGENT_MEDIA_TIMEOUT_MS) || 120_000,
    renderTimeoutMs: Number(input.context.configuration.AGENT_VIDEO_RENDER_TIMEOUT_MS) || 900_000,
    resolveSource,
    async publishArtifact(filePath) {
      const extension = path.extname(filePath).toLowerCase() || '.bin';
      const directory = artifactPath(safeSegment(input.context.runId, 'shared'), 'media');
      await mkdir(directory, { recursive: true });
      const artifactId = `media_${randomUUID()}${extension}`;
      const destination = path.join(directory, artifactId);
      await copyFile(filePath, destination);
      const url = artifactApiUrl(destination, { artifactsRoot: root });
      return { artifactId: path.relative(root, destination).split(path.sep).join('/'), fileName: artifactId, mediaType: extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : extension === '.mp4' ? 'video/mp4' : undefined, url, downloadUrl: `${url}?download=1` };
    },
  });
  const composeVideo = processing.composeVideo;
  return { ...processing, ...generation, ...(composeVideo ? { async composeVideo(request, execution) {
    const artifacts = await composeVideo(request, execution);
    for (const artifact of artifacts) {
      const project = await saveCompositionProject({ userId: input.context.userId, composition: request, output: artifact, resolveSource, signal: execution.abortSignal });
      artifact.description = `${artifact.description || ''} Editable project ${project.id} saved. Open the video in chat and choose Edit video to change scenes, timing and audio.`;
    }
    return artifacts;
  } } satisfies Pick<MediaOperations, 'composeVideo'> : {}) };
}

/** The agent's outer deadline must cover the media operation's own budget,
 * including saving the resulting artifact and editable project. */
export async function agentMediaToolTimeoutMs() {
  const configuration = mediaModelsForConfig(await store.getModelConfig());
  return Math.max(
    Number(runtimeSetting('AGENT_VIDEO_RENDER_TIMEOUT_MS')) || 900_000,
    Number(runtimeSetting('AGENT_MEDIA_TIMEOUT_MS')) || 120_000,
    ...configuration.models.filter(model => model.enabled).map(model => model.timeoutMs),
  ) + 30_000;
}

export async function createAgentInfrastructureProviders(input: {
  attachmentBindings?: readonly BrowserCodeAttachmentBinding[];
  userId?: string;
} = {}): Promise<CapabilityProvider[]> {
  const bootstrapAvailable = isAiOperationsAdmin(input.userId) && isRuntimeToolEnabled('selfBootstrap', runtimeConfiguration());
  const extensionProviders = bootstrapAvailable ? await refreshExtensionToolCatalog() : [];
  return [
    ...(bootstrapAvailable ? [createSelfBootstrapCapability(), ...extensionProviders] : []),
    createNodeConnectorsCapability({ connectors: configuredConnectors }),
    createTextEditorCapability({ createOperations(context) {
      return createFileTextEditorOperations({
        directory: textUserDirectory(context.userId),
        prepareStore: store => importLegacyTextDocuments(store, context.userId),
        async publishArtifact(fileName, content, execution) {
          execution.abortSignal?.throwIfAborted();
          const directory = artifactPath(safeSegment(context.runId, 'shared'), 'text-documents', randomUUID());
          await mkdir(directory, { recursive: true });
          const destination = path.join(directory, fileName);
          await writeFile(destination, content, { encoding: 'utf8', signal: execution.abortSignal });
          const artifactId = path.relative(artifactsRoot(), destination).split(path.sep).join('/');
          const url = artifactApiUrl(destination, { artifactsRoot: artifactsRoot() });
          if (!url) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Cannot create a download URL for the text document.');
          const mediaType = fileName.endsWith('.html') ? 'text/html' : fileName.endsWith('.md') ? 'text/markdown' : 'text/plain';
          return { artifactId, fileName, mediaType, url, downloadUrl: `${url}?download=1` };
        },
      });
    } }),
    createDataCapability({ createRegistry: async () => createDataSourceRegistry(await configuredDataSources()) }),
    createNodeCommunicationCapability({ channels: configuredCommunicationChannels, draftDirectory: (context) => artifactPath('users', safeSegment(context.userId, 'shared'), 'communication') }),
  ];
}
