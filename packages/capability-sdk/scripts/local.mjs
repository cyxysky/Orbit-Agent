import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createLocalProviders, defaultToolGroups, localToolGroups } from './mcp-providers.mjs';
import { loadConfig, toolConfiguration } from './mcp-config.mjs';
import { createLocalImageResolver } from './local-images.mjs';

let fileHosts = 0;

/** In-process local tools using the same JSON configuration as capability-mcp. */
export async function createLocalCapabilities(options = {}) {
  const projectRoot = await realpath(path.resolve(options.projectRoot || process.cwd()));
  if (projectRoot !== await realpath(process.cwd())) {
    throw new Error('Start the agent with cwd=projectRoot (or chdir before importing tool modules). Local runtimes are process-scoped; createLocalCapabilities never changes global cwd.');
  }
  const { value: config } = await loadConfig(projectRoot, options.configFile);
  const selected = options.tools || defaultToolGroups(config);
  if (!Array.isArray(selected) || selected.some(group => !localToolGroups.includes(group))) throw new Error('Unknown local tool group.');
  const groups = [...new Set(selected)].filter(group => config.tools?.[group]?.enabled !== false);
  const stateDirectory = path.resolve(projectRoot, config.server?.stateDirectory || '.capability-sdk/mcp');
  const providers = await createLocalProviders({ projectRoot, stateDirectory, groups, config });
  const { mountCapabilities, EnvironmentCapabilityConfigStore } = await import('../dist/host/index.js');
  const snapshot = await mountCapabilities({ providers,
    configStore: new EnvironmentCapabilityConfigStore(process.env),
    configurations: Object.fromEntries(providers.map((provider, index) => [provider.manifest.id, toolConfiguration(config, groups[index], projectRoot)])),
    context: { ...options.context, runId: options.context?.runId || `native-${randomUUID()}`,
      configuration: { AGENT_TERMINAL_ENABLED: 'true', AGENT_CODE_SANDBOX_ENABLED: 'true',
        AGENT_CODE_SANDBOX_BACKEND: 'local', AGENT_COMPUTER_ENABLED: 'true', ...options.context?.configuration } },
  });
  if (groups.includes('file')) fileHosts += 1;
  let disposing;
  return { snapshot, projectRoot, stateDirectory,
    instructions: `Tools execute locally in ${projectRoot}. Configure them in capability.config.json.\n${snapshot.skillCatalog.instructions('eager')}`,
    resolveImage: createLocalImageResolver(stateDirectory),
    dispose: () => disposing ||= (async () => {
      try { await snapshot.dispose(); }
      finally { if (groups.includes('file') && --fileHosts === 0) {
        const { disposeUnoRuntime } = await import('../dist/file/node/office/uno.js');
        await disposeUnoRuntime();
      } }
    })(),
  };
}
