import path from 'node:path';
import { copyFile, mkdir, realpath, stat } from 'node:fs/promises';
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
        createStore: () => createFileSystemMapStore(path.join(stateDirectory,'maps')),
        onView: onMapView,
        createClientOptions: context => ({ configuration: context.configuration,
          reserveRequest: (kind, signal) => reserveMapsRequest(path.join(stateDirectory,'maps-quota'), kind,
            Number(context.configuration[kind === 'search' ? 'GOOGLE_MAPS_SEARCH_MONTHLY_LIMIT' : 'GOOGLE_MAPS_ROUTES_MONTHLY_LIMIT'] || (kind === 'search' ? 4500 : 9000)), signal),
        }),
      });
    },
    async browser() {
      const { createBrowserMcpCapability } = await import('../dist/browser/mcp.js');
      const browser = config.tools?.browser || {};
      return createBrowserMcpCapability({ maxSessions: browser.maxSessions, idleTimeoutMs: browser.idleTimeoutMs, sessionOptions: {
        headless: browser.headless ?? ((process.env.HEADLESS_BROWSER ?? process.env.BROWSER_HEADLESS) !== 'false'),
        isolated: browser.isolated ?? true,
        slowMoMs: browser.slowMoMs,
        configuration: toolConfiguration(config, 'browser', projectRoot),
      } });
    },
    async terminal() {
      const { createNodeTerminalCapability } = await import('../dist/execution/terminal/node.js');
      return createNodeTerminalCapability({ cwd: path.resolve(projectRoot, config.tools?.terminal?.cwd || '.') });
    },
    async code() {
      const { createCodeSandboxCapability } = await import('../dist/execution/code/index.js');
      const { createNodeProcessCodeSandbox } = await import('../dist/execution/code/node.js');
      const { withLocalCodeArtifacts } = await import('./mcp-code-artifacts.mjs');
      return createCodeSandboxCapability({ createExecutor: () => withLocalCodeArtifacts(
        createNodeProcessCodeSandbox({ workspaceDirectory: path.join(stateDirectory, 'code', randomUUID()),
          maxConcurrent: config.tools?.code?.maxConcurrent ?? Number(process.env.AGENT_CODE_SANDBOX_MAX_CONCURRENCY || 2) }),
        path.join(artifactsRoot, 'code'),
      ) });
    },
    async file() {
      const { createNodeFileCapability } = await import('../dist/file/node/capability.js');
      return createNodeFileCapability({ workspace: { artifactsRoot }, visualInputAvailable: false });
    },
    async chart() {
      const { createNodeChartCapability } = await import('../dist/chart/node.js');
      return createNodeChartCapability({ directory: path.join(artifactsRoot, 'charts'), retainedRevisions: config.tools?.chart?.retainedRevisions });
    },
    async knowledge() {
      const { createNodeKnowledgeCapability } = await import('../dist/knowledge/node.js');
      return createNodeKnowledgeCapability({ directory: path.join(stateDirectory, 'knowledge') });
    },
    async media() {
      const { createNodeMediaCapability, createFfmpegMediaOperations } = await import('../dist/media/node.js');
      return createNodeMediaCapability({ createOperations: () => createFfmpegMediaOperations({
        timeoutMs: config.tools?.media?.timeoutMs ?? Number(process.env.AGENT_MEDIA_TIMEOUT_MS || 120000),
        async resolveSource(sourceRef) {
          if (/^[a-z][a-z\d+.-]*:\/\//i.test(sourceRef) && !sourceRef.startsWith('file://')) {
            throw new Error('Media sourceRef must be a local file path or file:// URL. Download remote media first.');
          }
          const filename = await realpath(sourceRef.startsWith('file://')
            ? fileURLToPath(sourceRef) : path.resolve(projectRoot, sourceRef));
          if (!(await stat(filename)).isFile()) throw new Error('Media sourceRef must point to a file.');
          return filename;
        },
        async publishArtifact(filename) {
          const artifactId = randomUUID();
          const directory = path.join(artifactsRoot, 'media', artifactId);
          await mkdir(directory, { recursive: true });
          const target = path.join(directory, path.basename(filename));
          await copyFile(filename, target);
          return { artifactId, fileName: path.basename(target), mediaType: 'image/jpeg',
            url: pathToFileURL(target).href, downloadUrl: pathToFileURL(target).href };
        },
      }) });
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
