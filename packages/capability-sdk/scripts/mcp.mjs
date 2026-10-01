#!/usr/bin/env node
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createLocalProviders, defaultToolGroups, localToolGroups } from './mcp-providers.mjs';
import { configFilename, configSchema, initConfig, loadConfig, toolConfiguration } from './mcp-config.mjs';
import { createLocalImageResolver } from './local-images.mjs';

const help = `Usage:
  capability-mcp [--project <directory>] [--tools browser,terminal,...]
  capability-mcp setup [--project <directory>] [--clients all] [--scope user]
  capability-mcp init <client|all> [--project <directory>] [--scope user|project]
  capability-mcp init config [--project <directory>]
  capability-mcp --describe-config
  capability-mcp --list

Starts a local stdio MCP server. No model key or extra package is required.
--project     Project root (default: CAPABILITY_PROJECT_DIR or current directory).
--tools       Tool groups to expose (default: all supported local groups).
              Use "all" for defaults or "none" with a custom --config.
--config      Grouped JSON configuration (default: capability.config.json).
              Explicit .mjs options/factories remain supported for business code.
--describe-config  Print the complete configuration schema and field descriptions.
--skill-mode  eager or lazy (default: eager).
--list        Print available groups without starting tools or installing runtimes.
--clients     setup targets: all, or comma-separated cursor,codex,claude-code,
              claude-desktop,vscode,windsurf,devin.
--scope       setup/init all default to user; init <client> uses project where supported.
--name        MCP server name in client configurations (default: capability-sdk).
--dry-run     Preview setup/init without installing or changing files.
--help        Show this help.

Local groups: ${localToolGroups.join(', ')}.
computer requires Windows or AGENT_COMPUTER_ENDPOINT.
maps is opt-in via tools.maps.enabled; online maps/search/routes need Google keys.
chart/maps provide MCP Apps and local preview links; see MCP-UI.zh-CN.md.
Media inspection/frame extraction work locally; OCR, transcription, generation,
databases and business integrations require configured providers via --config.
Runtime: <project>/.capability-sdk/<platform>-<arch> (or CAPABILITY_RUNTIME_HOME).
MCP artifacts and knowledge: <project>/.capability-sdk/mcp.
setup installs/repairs runtimes and configures clients; init only configures clients.
Normal MCP startup never installs runtimes. Existing conflicting entries are kept.
`;

async function installRuntime(projectRoot) {
  const env = { ...process.env };
  // setup explicitly requests installation, including when an earlier npm install skipped it.
  delete env.CAPABILITY_SKIP_RUNTIME_INSTALL;
  delete env.npm_lifecycle_event;
  if (env.CAPABILITY_RUNTIME_HOME) env.CAPABILITY_RUNTIME_HOME = path.resolve(projectRoot, env.CAPABILITY_RUNTIME_HOME);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./runtime.cjs', import.meta.url)), 'install'], {
      cwd: projectRoot, env, stdio: 'inherit', windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Runtime installation failed (${code}); client configurations were not written.`)));
  });
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    project: { type: 'string' }, tools: { type: 'string' }, config: { type: 'string' },
    'skill-mode': { type: 'string' }, list: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    'describe-config': { type: 'boolean' },
    clients: { type: 'string' }, scope: { type: 'string' }, name: { type: 'string' }, 'dry-run': { type: 'boolean' },
  } });
  if (values.help) { console.log(help); return; }
  if (values['describe-config']) { console.log(JSON.stringify(configSchema, null, 2)); return; }
  if (values.list) {
    console.log(JSON.stringify({ available: localToolGroups, defaults: defaultToolGroups() }, null, 2));
    return;
  }
  const setup = positionals.length === 1 && positionals[0] === 'setup';
  const init = positionals.length === 2 && positionals[0] === 'init';
  if (positionals.length && !setup && !init) {
    throw new Error('Unknown command. Use capability-mcp --help.');
  }
  if (!setup && !init && ['clients', 'scope', 'name', 'dry-run'].some(key => values[key] !== undefined)) {
    throw new Error('--clients/--scope/--name/--dry-run require setup or init.');
  }
  if (init && values.clients) throw new Error('Use init <client|all>, or setup --clients <list>.');
  if (values['skill-mode'] && !['eager', 'lazy'].includes(values['skill-mode'])) {
    throw new Error('--skill-mode must be eager or lazy.');
  }
  const projectRoot = await realpath(path.resolve(values.project || process.env.CAPABILITY_PROJECT_DIR || process.cwd()));
  if (!(await stat(projectRoot)).isDirectory()) throw new Error('--project must be a directory.');
  if (positionals.join(' ') === 'init config') {
    if (values['dry-run']) { await loadConfig(projectRoot); console.error(`Keep/create ${path.join(projectRoot, configFilename)}`); }
    else await initConfig(projectRoot);
    return;
  }
  const moduleConfig = values.config?.endsWith('.mjs');
  const loaded = await loadConfig(projectRoot, moduleConfig ? undefined : values.config);
  const config = loaded.value;
  const selection = values.tools ?? 'all';
  const selected = selection === 'all' ? defaultToolGroups(config)
    : selection === 'none' ? [] : [...new Set(selection.split(',').map(value => value.trim()))];
  const unknown = selected.filter(group => !localToolGroups.includes(group));
  if (unknown.length) throw new Error(`Unknown tool groups: ${unknown.join(', ')}. Use --list.`);
  const groups = selected.filter(group => config.tools?.[group]?.enabled !== false);
  if (selection === 'none' && !moduleConfig) throw new Error('--tools none requires an explicit .mjs --config.');
  if (setup || init) {
    if (moduleConfig) await stat(path.resolve(projectRoot, values.config));
    const { planClientConfigurations, printClientPlan, applyClientConfigurations } = await import('./mcp-clients.mjs');
    const plans = await planClientConfigurations(projectRoot, { ...values,
      clients: setup ? values.clients || 'all' : positionals[1],
      scope: values.scope || (setup || ['all', 'claude-desktop', 'windsurf', 'devin'].includes(positionals[1]) ? 'user' : 'project'),
    });
    printClientPlan(plans);
    if (values['dry-run']) {
      if (setup) console.error(`Would install/repair tool runtimes in ${projectRoot}.`);
      if (!values.config) console.error(`Would keep/create ${path.join(projectRoot, configFilename)}.`);
      return;
    }
    if (setup) {
      await stat(new URL('../dist/adapters/mcp/index.js', import.meta.url)).catch(() => { throw new Error('SDK dist is missing. Use a prepared release package; setup does not run a build.'); });
      await installRuntime(projectRoot);
    }
    if (!values.config) await initConfig(projectRoot);
    await applyClientConfigurations(plans);
    return;
  }

  process.chdir(projectRoot);
  const stateDirectory = path.resolve(projectRoot, config.server?.stateDirectory || '.capability-sdk/mcp');
  const mapViews = new Map();
  const providers = await createLocalProviders({ projectRoot, stateDirectory, groups, config,
    onMapView: (record, view) => {
      mapViews.set(record.mapId,{record,view});
      if(mapViews.size>200)mapViews.delete(mapViews.keys().next().value);
    },
  });
  const { createCapabilityMcpServer } = await import('../dist/adapters/mcp/index.js');
  const { EnvironmentCapabilityConfigStore } = await import('../dist/host/index.js');
  const { serveStdio } = await import('@modelcontextprotocol/server/stdio');
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  let custom = {};
  if (moduleConfig) {
    const module = await import(pathToFileURL(path.resolve(projectRoot, values.config)).href);
    custom = typeof module.default === 'function'
      ? await module.default({ projectRoot, stateDirectory, providers }) : module.default;
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
      throw new Error('--config must default-export MCP options or a factory returning them.');
    }
  }
  const configuration = { AGENT_TERMINAL_ENABLED: 'true', AGENT_CODE_SANDBOX_ENABLED: 'true',
    AGENT_CODE_SANDBOX_BACKEND: 'local', AGENT_COMPUTER_ENABLED: 'true' };
  const options = {
    name: config.server?.name || 'capability-sdk', version, providers,
    resolveImage: createLocalImageResolver(stateDirectory),
    visualization: { ...config.server?.visualization, loadMap: async (id, record) => {
      const data = mapViews.get(id) || (record.request?.action === 'show' ? {record,view:{center:record.request.center,zoom:record.request.zoom,markers:record.request.markers,places:[],googleMapsUrl:''}} : undefined);
      if(!data)return undefined;
      const { mapsUrl } = await import('../dist/maps/core.js');
      return {...data,view:{...data.view,googleMapsUrl:mapsUrl(record.request)},
        browserKey:process.env[config.tools?.maps?.browserKeyEnv||'GOOGLE_MAPS_BROWSER_KEY']||'',language:config.tools?.maps?.language||process.env.GOOGLE_MAPS_LANGUAGE||'zh-CN'};
    } },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
    configurations: Object.fromEntries(providers.map((provider, index) => [provider.manifest.id, toolConfiguration(config, groups[index], projectRoot)])),
    skillMode: values['skill-mode'] || config.server?.skillMode || 'eager',
    instructions: `Tools execute on this machine. Project root: ${projectRoot}. Local artifacts: ${stateDirectory}. Media sourceRef accepts local paths and file:// URLs. The built-in media provider supports inspection and frame extraction. Configure tools in ${loaded.filename || path.join(projectRoot, configFilename)}. Read MCP-CONFIG.zh-CN.md and mcp-config.schema.json in the installed capability-sdk package for supported fields, defaults, units and constraints; capability-mcp --describe-config prints the schema. Configuration changes require restarting MCP.`,
    ...custom,
    context: () => {
      const context = typeof custom.context === 'function' ? custom.context() : custom.context;
      return { ...context, configuration: { ...configuration, ...context?.configuration } };
    },
  };
  const handle = serveStdio(() => createCapabilityMcpServer(options), {
    onerror: error => console.error(`[capability-mcp] ${error.message}`),
  });
  let stopping;
  const stop = () => stopping ||= (async () => {
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    try {
      await handle.close();
      if (groups.includes('file')) {
        const { disposeUnoRuntime } = await import('../dist/file/node/office/uno.js');
        await disposeUnoRuntime();
      }
      // Some built-in drivers own process-wide listeners; this dedicated CLI
      // exits only after providers have released their sessions and workers.
      process.exit(0);
    } catch (error) { console.error(`[capability-mcp] ${error.message}`); process.exit(1); }
  })();
  process.stdin.once('end', stop);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (process.platform !== 'win32') process.once('SIGHUP', stop);
  if (process.stdin.readableEnded) await stop();
}

main().catch(error => { console.error(`[capability-mcp] ${error.message}`); process.exitCode = 1; });
