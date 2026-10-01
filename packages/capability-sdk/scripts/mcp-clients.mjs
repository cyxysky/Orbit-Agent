import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { applyEdits, modify, parseTree, getNodeValue } from 'jsonc-parser';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

export const clientNames = ['cursor', 'codex', 'claude-code', 'claude-desktop', 'vscode', 'windsurf', 'devin'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;

export function selectClients(value = 'all') {
  const clients = value === 'all' ? clientNames : [...new Set(value.split(',').map(item => item.trim()))];
  if (!clients.length || clients.some(client => !clientNames.includes(client))) {
    throw new Error(`Unknown MCP client. Choose all or: ${clientNames.join(', ')}.`);
  }
  return clients;
}

// Keep paths and schemas per client: VS Code uses servers, Codex uses TOML.
export function clientTargets(projectRoot, scope, { home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  if (!['user', 'project'].includes(scope)) throw new Error('--scope must be user or project.');
  const appData = platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || path.join(home, '.config');
  const user = scope === 'user';
  return {
    cursor: { filename: path.join(user ? home : projectRoot, '.cursor', 'mcp.json'), key: 'mcpServers' },
    codex: { filename: path.join(user ? env.CODEX_HOME || path.join(home, '.codex') : path.join(projectRoot, '.codex'), 'config.toml'), toml: true },
    'claude-code': { filename: user ? path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json') : path.join(projectRoot, '.mcp.json'), key: 'mcpServers' },
    'claude-desktop': { filename: path.join(appData, 'Claude', 'claude_desktop_config.json'), key: 'mcpServers', userOnly: true,
      unsupported: !['win32', 'darwin'].includes(platform) },
    vscode: { filename: user ? path.join(env.VSCODE_PORTABLE ? path.join(env.VSCODE_PORTABLE, 'user-data') : path.join(appData, 'Code'), 'User', 'mcp.json')
      : path.join(projectRoot, '.vscode', 'mcp.json'), key: 'servers', jsonc: true },
    windsurf: { filename: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers', userOnly: true },
    devin: { filename: path.join(platform === 'darwin' ? env.XDG_CONFIG_HOME || path.join(home, '.config') : appData, 'devin', 'mcp_config.json'), key: 'mcpServers', userOnly: true },
  };
}

async function readOptional(filename) {
  try { return await readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

function parseJson(source, target) {
  const errors = [];
  const tree = parseTree(source, errors, { allowTrailingComma: Boolean(target.jsonc), disallowComments: !target.jsonc });
  if (errors.length || tree?.type !== 'object') throw new Error(`Invalid JSON${target.jsonc ? 'C' : ''} object in ${target.filename}.`);
  const checkDuplicates = node => {
    if (node.type === 'object') {
      const keys = node.children.map(child => child.children[0].value);
      if (new Set(keys).size !== keys.length) throw new Error(`Duplicate JSON keys in ${target.filename}; resolve them first.`);
    }
    node.children?.forEach(checkDuplicates);
  };
  checkDuplicates(tree);
  return getNodeValue(tree);
}

function sameConnection(existing, wanted, projectRoot) {
  if (!isObject(existing) || existing.url !== undefined || (existing.type !== undefined && existing.type !== 'stdio')) return false;
  const normalize = value => typeof value === 'string' ? value.replaceAll('${workspaceFolder}', projectRoot).replaceAll('\\', '/') : value;
  const command = value => value === 'node' ? normalize(process.execPath) : normalize(value);
  return command(existing.command) === command(wanted.command)
    && isDeepStrictEqual(existing.args?.map(normalize), wanted.args.map(normalize))
    && Object.entries(wanted.env || {}).every(([key, value]) => existing.env?.[key] === value);
}

function addEntry(previous, target, entry, name, projectRoot) {
  const bom = previous?.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = previous === undefined ? (target.toml ? '' : '{}\n') : previous.slice(bom.length);
  let config;
  if (target.toml) {
    try { config = parseToml(source); }
    catch { throw new Error(`Invalid TOML in ${target.filename}; fix it before setup.`); }
  } else config = parseJson(source, target);
  const key = target.toml ? 'mcp_servers' : target.key;
  const servers = own(config, key);
  if (servers !== undefined && !isObject(servers)) throw new Error(`${key} must be an object in ${target.filename}.`);
  const existing = servers && own(servers, name);
  if (existing !== undefined) {
    if (sameConnection(existing, entry, projectRoot)) return previous;
    throw new Error(`A different ${name} server exists in ${target.filename}. Use --name with another name or edit that entry explicitly.`);
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  let next;
  if (target.toml) {
    next = source + (source.endsWith('\n') || !source ? '' : eol) + eol
      + stringifyToml({ mcp_servers: { [name]: entry } }).replaceAll('\n', eol);
    // Inline TOML tables cannot always be extended. Refuse instead of rewriting unrelated settings.
    try { parseToml(next); }
    catch { throw new Error(`Cannot append to the inline mcp_servers table in ${target.filename}. Convert it to TOML table sections first.`); }
  } else {
    const indentation = source.match(/\n([\t ]+)"/)?.[1] || '  ';
    next = applyEdits(source, modify(source, [key, name], entry, { formattingOptions: {
      insertSpaces: !indentation.includes('\t'), tabSize: indentation.length, eol,
    } }));
    parseJson(next, target);
  }
  return bom + next + (next.endsWith('\n') ? '' : eol);
}

export async function planClientConfigurations(projectRoot, values = {}, environment) {
  const clients = selectClients(values.clients);
  const targets = clientTargets(projectRoot, values.scope || 'user', environment);
  const name = values.name || 'capability-sdk';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('--name must contain only letters, numbers, underscores and hyphens.');
  let entryPath = fileURLToPath(new URL('./mcp.mjs', import.meta.url));
  const installedEntry = path.join(projectRoot, 'node_modules', '@cjfclonedeep', 'capability-sdk', 'scripts', 'mcp.mjs');
  if (await realpath(installedEntry).catch(() => undefined) === await realpath(entryPath)) entryPath = installedEntry;
  const args = [entryPath, '--project', projectRoot];
  for (const key of ['tools', 'config', 'skill-mode']) if (values[key] !== undefined) args.push(`--${key}`, values[key]);
  const runtimeHome = process.env.CAPABILITY_RUNTIME_HOME;
  const base = { command: process.execPath, args, ...(runtimeHome ? { env: { CAPABILITY_RUNTIME_HOME: path.resolve(projectRoot, runtimeHome) } } : {}) };
  const plans = [];
  for (const client of clients) {
    const target = targets[client];
    if (target.unsupported || (target.userOnly && values.scope === 'project')) {
      if (values.clients !== undefined && values.clients !== 'all') throw new Error(`${client} is unavailable for this platform/scope; it requires a supported desktop OS and user scope.`);
      plans.push({ client, skipped: target.unsupported ? 'unsupported OS' : 'requires user scope' });
      continue;
    }
    // Follow an existing symlink instead of replacing the user's symlink with a file.
    const filename = await realpath(target.filename).catch(error => { if (error.code === 'ENOENT') return target.filename; throw error; });
    const previous = await readOptional(filename);
    const entry = ['cursor', 'claude-code', 'vscode'].includes(client) ? { type: 'stdio', ...base } : base;
    const next = addEntry(previous, { ...target, filename }, entry, name, projectRoot);
    plans.push({ client, filename, previous, next });
  }
  return plans;
}

export function printClientPlan(plans) {
  for (const plan of plans) console.error(plan.skipped ? `[${plan.client}] Skip: ${plan.skipped}`
    : `[${plan.client}] ${plan.next === plan.previous ? 'Keep' : plan.previous === undefined ? 'Create' : 'Merge + backup'}: ${plan.filename}`);
}

export async function applyClientConfigurations(plans) {
  // Check every file again before the first write, including files kept unchanged.
  for (const plan of plans) if (!plan.skipped && await readOptional(plan.filename) !== plan.previous) {
    throw new Error(`Configuration changed during setup: ${plan.filename}. Run setup again.`);
  }
  for (const plan of plans) {
    if (plan.skipped || plan.next === plan.previous) continue;
    await mkdir(path.dirname(plan.filename), { recursive: true });
    if (plan.previous === undefined) {
      await writeFile(plan.filename, plan.next, { flag: 'wx', mode: 0o600 });
    } else {
      const backup = `${plan.filename}.capability-${Date.now()}-${randomUUID()}.bak`;
      await writeFile(backup, plan.previous, { flag: 'wx', mode: 0o600 });
      const temporary = `${plan.filename}.${randomUUID()}.tmp`;
      try {
        const info = await lstat(plan.filename);
        if (!info.isFile()) throw new Error(`Configuration target changed: ${plan.filename}.`);
        await writeFile(temporary, plan.next, { flag: 'wx', mode: info.mode & 0o777 });
        if (await readOptional(plan.filename) !== plan.previous) throw new Error(`Configuration changed: ${plan.filename}. Run setup again.`);
        await rename(temporary, plan.filename);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      console.error(`Backup: ${backup}`);
    }
    console.error(`[${plan.client}] Configured: ${plan.filename}`);
  }
  console.error('Configuration complete. Restart/reload each client and enable or trust the MCP server when prompted.');
}
