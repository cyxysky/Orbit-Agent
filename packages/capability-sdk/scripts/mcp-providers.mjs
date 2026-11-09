import path from 'node:path';
import { copyFile, mkdir, realpath, stat, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { toolConfiguration } from './mcp-config.mjs';

export const localToolGroups = ['browser', 'terminal', 'code', 'file', 'chart', 'knowledge', 'media', 'computer', 'maps'];

export function defaultToolGroups(config = {}) {
  return localToolGroups.filter(name => name === 'maps' ? config.tools?.maps?.enabled === true : name !== 'computer' || process.platform === 'win32'
    || config.tools?.computer?.enabled === true
    || Boolean(config.tools?.computer?.endpoint ?? process.env.AGENT_COMPUTER_ENDPOINT));
}

// Imports happen after the CLI selects the project, including modules that resolve
// runtime paths at initialization. Unselected tool groups are never imported.
export async function createLocalProviders({ projectRoot, stateDirectory, groups, config = {}, onMapView }) {
  const artifactsRoot = path.join(stateDirectory, 'artifacts');
  const factories = {
    async maps() {
      const { createMapsCapability, createFileSystemMapStore, reserveMapsRequest } = await import('../dist/maps/node.js');
      return createMapsCapability({
        createStore: () => createFileSystemMapStore(process.env.CAPABILITY_MAPS_DIRECTORY || path.join(stateDirectory,'maps')),
        onView: onMapView,
        createClientOptions: context => ({ configuration: context.configuration,
          reserveRequest: (kind, signal) => reserveMapsRequest(process.env.CAPABILITY_MAPS_QUOTA_DIRECTORY || path.join(stateDirectory,'maps-quota'), kind,
            Number(context.configuration[kind === 'search' ? 'GOOGLE_MAPS_SEARCH_MONTHLY_LIMIT' : 'GOOGLE_MAPS_ROUTES_MONTHLY_LIMIT'] || (kind === 'search' ? 4500 : 9000)), signal),
        }),
      });
    },
    async browser() {
      const { createBrowserMcpCapability } = await import('../dist/browser/mcp.js');
      const browser = config.tools?.browser || {};
      const { nodeArtifactRelativePath } = await import('../dist/file/node/artifacts.js');
      return createBrowserMcpCapability({ maxSessions: browser.maxSessions, idleTimeoutMs: browser.idleTimeoutMs,
        async resolveCredentials() {
          if (!process.env.CAPABILITY_TOOL_CONTEXT_FILE) return [];
          return JSON.parse(await readFile(process.env.CAPABILITY_TOOL_CONTEXT_FILE, 'utf8')).metadata?.credentials || [];
        },
        async resolveTarget() {
          if (!process.env.CAPABILITY_TOOL_CONTEXT_FILE) return undefined;
          return JSON.parse(await readFile(process.env.CAPABILITY_TOOL_CONTEXT_FILE, 'utf8')).metadata?.targetId;
        },
        async resolveAttachmentArtifact(artifactId) {
          if (path.isAbsolute(artifactId) || /^[a-z][a-z\d+.-]*:/i.test(artifactId)) {
            throw new Error('Use a relative artifactId returned by a file/code tool, not a local path or URL.');
          }
          const root = await realpath(artifactsRoot);
          const candidate = path.resolve(root, artifactId);
          nodeArtifactRelativePath(root, candidate);
          const filename = await realpath(candidate);
          nodeArtifactRelativePath(root, filename);
          if (!(await stat(filename)).isFile()) throw new Error('Upload artifact must be a file.');
          return { name: path.basename(filename), path: filename };
        }, sessionOptions: {
        headless: browser.headless ?? ((process.env.HEADLESS_BROWSER ?? process.env.BROWSER_HEADLESS) !== 'false'),
        isolated: process.env.BROWSER_CDP_TARGET_ID ? false : browser.isolated ?? process.env.BROWSER_ISOLATED !== 'false',
        attachTargetId: process.env.BROWSER_CDP_TARGET_ID,
        sessionGroupId: process.env.BROWSER_SESSION_GROUP_ID,
        slowMoMs: browser.slowMoMs,
        configuration: { ...toolConfiguration(config, 'browser', projectRoot),
          ...(process.env.BROWSER_CDP_TARGET_ID ? { BROWSER_CDP_ENDPOINT: process.env.BROWSER_CDP_ENDPOINT } : {}) },
      } });
    },
    async terminal() {
      const { createNodeTerminalCapability } = await import('../dist/execution/terminal/node.js');
      return createNodeTerminalCapability({ cwd: path.resolve(projectRoot, config.tools?.terminal?.cwd || process.env.AGENT_TERMINAL_CWD || '.') });
    },
    async code() {
      const { createCodeSandboxCapability } = await import('../dist/execution/code/index.js');
      const { createNodeProcessCodeSandbox } = await import('../dist/execution/code/node.js');
      const { withLocalCodeArtifacts } = await import('./mcp-code-artifacts.mjs');
      const { createHttpCodeSandboxExecutor } = await import('../dist/execution/code/remote.js');
      return createCodeSandboxCapability({ createExecutor: context => withLocalCodeArtifacts(
        context.configuration.AGENT_CODE_SANDBOX_BACKEND === 'remote'
          ? createHttpCodeSandboxExecutor({ url: context.configuration.AGENT_CODE_SANDBOX_RUNNER_URL || '',
            token: context.configuration.AGENT_CODE_SANDBOX_RUNNER_TOKEN, requiredIsolation: 'linux-landlock-v1' })
          : createNodeProcessCodeSandbox({ workspaceDirectory: path.join(stateDirectory, 'code', randomUUID()),
            maxConcurrent: config.tools?.code?.maxConcurrent ?? Number(process.env.AGENT_CODE_SANDBOX_MAX_CONCURRENCY || 2) }),
        artifactsRoot, context.runId,
      ) });
    },
    async file() {
      const { createNodeFileCapability } = await import('../dist/file/node/capability.js');
      return createNodeFileCapability({ workspace: { artifactsRoot }, artifactReadScope: 'workspace',
        attachmentBindings: async () => process.env.CAPABILITY_TOOL_CONTEXT_FILE
          ? JSON.parse(await readFile(process.env.CAPABILITY_TOOL_CONTEXT_FILE, 'utf8')).metadata?.attachments : undefined,
        sourcePageUrl: async () => process.env.CAPABILITY_TOOL_CONTEXT_FILE
          ? JSON.parse(await readFile(process.env.CAPABILITY_TOOL_CONTEXT_FILE, 'utf8')).metadata?.sourcePageUrl : undefined,
        visualInputAvailable: process.env.CAPABILITY_VISUAL_INPUT_AVAILABLE !== 'false' && config.tools?.file?.visualInputAvailable !== false,
        includeVisualVerification: process.env.CAPABILITY_VISUAL_INPUT_AVAILABLE !== 'false' && config.tools?.file?.visualInputAvailable !== false });
    },
    async chart() {
      const { createNodeChartCapability } = await import('../dist/chart/node.js');
      return createNodeChartCapability({ directory: path.join(artifactsRoot, 'charts'), retainedRevisions: config.tools?.chart?.retainedRevisions });
    },
    async knowledge() {
      const { createNodeKnowledgeCapability } = await import('../dist/knowledge/node.js');
      return createNodeKnowledgeCapability({ directory: process.env.CAPABILITY_KNOWLEDGE_DIR || path.join(stateDirectory, 'knowledge'),
        readOnly: process.env.CAPABILITY_KNOWLEDGE_READ_ONLY === 'true' });
    },
    async media() {
      const { createNodeMediaCapability, createFfmpegMediaOperations, createRemotionMediaOperations } = await import('../dist/media/node.js');
      const { sanitizeNodeArtifactFileName } = await import('../dist/file/node/artifacts.js');
      const { createLocalMediaGeneration } = await import('./mcp-media.mjs');
      const settings=config.tools?.media || {};
      async function resolveSource(sourceRef) {
          if (/^[a-z][a-z\d+.-]*:\/\//i.test(sourceRef) && !sourceRef.startsWith('file://')) {
            throw new Error('Media sourceRef must be a local file path or file:// URL. Download remote media first.');
          }
          const filename = await realpath(sourceRef.startsWith('file://')
            ? fileURLToPath(sourceRef) : path.resolve(projectRoot, sourceRef));
          const root = await realpath(projectRoot);
          const relative = path.relative(root, filename);
          if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Media sourceRef must remain inside this MCP project.');
          if (!(await stat(filename)).isFile()) throw new Error('Media sourceRef must point to a file.');
          return filename;
      }
      const generation=await createLocalMediaGeneration({projectRoot,artifactsRoot,settings,resolveSource});
      const processing = process.env.CAPABILITY_VIDEO_RENDERER === 'remotion' ? createRemotionMediaOperations : createFfmpegMediaOperations;
      return createNodeMediaCapability({ createOperations: context => ({...processing({
        timeoutMs: settings.timeoutMs ?? Number(process.env.AGENT_MEDIA_TIMEOUT_MS || 120000),
        resolveSource,
        async publishArtifact(filename) {
          const artifactId = randomUUID();
          const namespace = path.posix.join(sanitizeNodeArtifactFileName(context.runId, 'adhoc'), 'media');
          const directory = path.join(artifactsRoot, namespace, artifactId);
          await mkdir(directory, { recursive: true });
          const target = path.join(directory, path.basename(filename));
          await copyFile(filename, target);
          const { artifactContentType } = await import('../dist/file/formats.js');
          return { artifactId: path.posix.join(namespace, artifactId, path.basename(target)),
            fileName: path.basename(target), mediaType: artifactContentType(target),
            url: pathToFileURL(target).href, downloadUrl: pathToFileURL(target).href };
        },
      }),...generation}) });
    },
    async computer() {
      if (process.platform !== 'win32' && !(config.tools?.computer?.endpoint ?? process.env.AGENT_COMPUTER_ENDPOINT)) {
        throw new Error('computer requires Windows or AGENT_COMPUTER_ENDPOINT.');
      }
      const { createNodeComputerCapability } = await import('../dist/computer/node.js');
      return createNodeComputerCapability({ screenshotDirectory: path.join(artifactsRoot, 'computer') });
    },
  };
  const providers = [];
  for (const group of groups) providers.push(await factories[group]());
  return providers;
}
