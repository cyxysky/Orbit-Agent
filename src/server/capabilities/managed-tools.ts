import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { realpath, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createManagedToolInstaller, managedToolCatalog, managedToolRuntimeConfiguration, minimalProcessEnvironment, type ManagedToolStatus } from '@cjfclonedeep/capability-sdk/managed/node';
import { createMcpStdioConnector } from '@cjfclonedeep/capability-sdk/integrations/connectors/node';
import type { AgentConnector } from '@cjfclonedeep/capability-sdk/integrations/connectors';
import { appDataRoot, artifactsRoot } from '@/server/storage/paths';
import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import { readRuntimeMeta } from '@/server/storage/database-record-store';
import { executeDatabase } from '@/server/db/database';
import { encryptCredentialSecret, decryptCredentialSecret } from '@/server/credentials/credential-master-key';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { mediaModelsForConfig } from '@/lib/model-selection';
import { store } from '@/server/db/store';
import { isRuntimeToolEnabled } from '@/server/runtime/self-bootstrap-policy';

export type ManagedToolConfiguration = { enabled: boolean; env: Record<string, string>; config: Record<string, unknown> };
const settingsKey = 'managed-mcp-tools.v1';
const aad = (id: string) => Buffer.from('orbit-managed-mcp-tools-v1:' + id);
const pool = new Map<string, { connector: AgentConnector; touched: number; active: number; id: string; userId: string; sessionId: string; contextFile: string }>();
const root = () => path.resolve(process.env.CAPABILITY_TOOLS_HOME || path.join(appDataRoot(), 'tool-components'));
export function toolInstaller() {
  const source = process.env.CAPABILITY_SDK_ROOT || path.join(process.cwd(), 'packages', 'capability-sdk');
  return createManagedToolInstaller({ root: root(), sdkRoot: existsSync(path.join(source, 'scripts/mcp-providers.mjs')) ? source : undefined,
    version: process.env.CAPABILITY_SDK_VERSION || '0.3.0', registry: process.env.CAPABILITY_TOOL_REGISTRY || 'https://registry.npmjs.org' });
}
export async function managedToolConfigurations(): Promise<Record<string, ManagedToolConfiguration>> {
  const entries = await Promise.all(managedToolCatalog().map(async tool => {
    const stored = await readRuntimeMeta(settingsKey + ':' + tool.id);
    if (!stored) return [tool.id, undefined] as const;
    const plaintext = decryptCredentialSecret({ aad: aad(tool.id), envelope: stored, formatError: '工具配置密文无效', keyMismatchError: '无法解密工具配置', decryptionError: '读取工具配置失败' });
    return [tool.id, JSON.parse(plaintext) as ManagedToolConfiguration] as const;
  }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, ManagedToolConfiguration] => Boolean(entry[1])));
}
export async function saveManagedToolConfiguration(id: string, value: ManagedToolConfiguration) {
  if (!managedToolCatalog().some(tool => tool.id === id)) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, '未知工具');
  await managedToolRuntimeConfiguration(id, value.config, process.cwd(), { ...runtimeConfiguration(), ...value.env });
  await stopManagedTool(id);
  await executeDatabase('INSERT INTO runtime_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    [settingsKey + ':' + id, encryptCredentialSecret(JSON.stringify(value), aad(id)), new Date().toISOString()]);
}
export async function listManagedTools() {
  const configurations = await managedToolConfigurations();
  return toolInstaller().list().map(tool => ({ ...tool, enabled: configurations[tool.id]?.enabled === true,
    running: [...pool.values()].some(entry => entry.id === tool.id),
    configuration: { config: configurations[tool.id]?.config || {}, envKeys: Object.keys(configurations[tool.id]?.env || {}) } }));
}
export function isManagedToolInstalled(id: string) { return toolInstaller().status(id).state === 'ready'; }
async function closeEntry(entry: typeof pool extends Map<string, infer Value> ? Value : never) {
  try { await entry.connector.dispose?.(); }
  finally {
    const directory = path.dirname(entry.contextFile);
    if (!/^[a-f0-9]{64}$/.test(path.basename(directory))) throw new Error('Invalid MCP instance directory.');
    const [actual, parent] = await Promise.all([realpath(directory), realpath(path.join(root(), '.instances'))]);
    if (!actual.startsWith(parent + path.sep)) throw new Error('MCP instance directory escapes its workspace.');
    await rm(directory, { recursive: true, force: true });
  }
}
export async function disposeManagedTools() {
  const entries = [...pool.values()]; pool.clear();
  await Promise.allSettled(entries.map(closeEntry));
}
export async function stopManagedSessionTools(userId: string, sessionId: string) {
  const closing: Promise<void>[] = [];
  for (const [key, entry] of pool) if (entry.userId === userId && entry.sessionId === sessionId) {
    pool.delete(key); closing.push(closeEntry(entry));
  }
  await Promise.allSettled(closing);
}
export async function stopManagedTool(id: string, options: { force?: boolean } = {}) {
  if (!options.force && [...pool.values()].some(entry => entry.id === id && entry.active)) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, '工具正在执行，请完成或停止任务后再修改。');
  const closing: Promise<unknown>[] = [];
  for (const [key, entry] of pool) if (entry.id === id) {
    pool.delete(key); closing.push(closeEntry(entry));
  }
  await Promise.allSettled(closing);
}
export async function managedToolConnector(input: { id: string; userId: string; sessionId: string; runId: string;
  env?: Record<string, string>; metadata?: Record<string, unknown>; observe?: boolean }): Promise<AgentConnector> {
  const installed = toolInstaller().installed(input.id);
  if (!installed) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, '请先在设置 → 工具能力中单独安装此工具。');
  const configuration = (await managedToolConfigurations())[input.id];
  if (!configuration?.enabled) throw new CodedError(ERROR_CODES.FORBIDDEN, '此工具尚未启用。');
  const effective = { ...runtimeConfiguration(), ...configuration.env, ...input.env };
  Object.assign(effective, await managedToolRuntimeConfiguration(input.id, configuration.config, process.cwd(), effective));
  if (!isRuntimeToolEnabled(input.id, effective)) throw new CodedError(ERROR_CODES.FORBIDDEN, '部署权限或全局设置禁止执行此工具。');
  if (!/^[a-zA-Z0-9_-]+$/.test(input.sessionId) || !input.userId || !input.runId) throw new CodedError(ERROR_CODES.INVALID_INPUT, '工具需要有效的用户、对话和执行范围。');
  const prefixes: Record<string, string[]> = {
    browser: ['BROWSER_', 'PLAYWRIGHT_', 'HEADLESS_BROWSER', 'AI_WEB_TEST_'], file: ['AGENT_FILE_', 'OFFICE_', 'LIBREOFFICE_', 'PDF_'],
    media: ['AGENT_MEDIA_', 'AGENT_VIDEO_', 'REMOTION_'], maps: ['GOOGLE_MAPS_'], terminal: ['AGENT_TERMINAL_'],
    codeSandbox: ['AGENT_CODE_SANDBOX_'], computer: ['AGENT_COMPUTER_'], chart: ['AGENT_CHART_'], knowledge: ['AGENT_KNOWLEDGE_'],
  };
  const values = Object.fromEntries(Object.entries(runtimeConfiguration()).filter(([key, value]) => typeof value === 'string' && (prefixes[input.id] || []).some(prefix => key.startsWith(prefix)))) as Record<string, string>;
  const enableKey = { terminal: 'AGENT_TERMINAL_ENABLED', computer: 'AGENT_COMPUTER_ENABLED', codeSandbox: 'AGENT_CODE_SANDBOX_ENABLED' }[input.id as 'terminal' | 'computer' | 'codeSandbox'];
  if (enableKey) values[enableKey] = 'true';
  const media = input.id === 'media' ? mediaModelsForConfig(await store.getModelConfig()) : undefined;
  const scopeEnvironment = Object.fromEntries(Object.entries(input.env || {}).filter(([key]) => key !== 'BROWSER_CDP_TARGET_ID'));
  const scopeId = managedToolCatalog().find(tool => tool.id === input.id)?.scope === 'session' ? input.sessionId : input.runId;
  const scope = createHash('sha256').update(JSON.stringify([input.id, input.userId, input.sessionId, scopeId, installed.release, configuration, values, scopeEnvironment, media])).digest('hex');
  let cached = pool.get(scope);
  if (!cached) {
    const directory = path.join(root(), '.instances', scope);
    mkdirSync(directory, { recursive: true });
    const contextFile = path.join(directory, 'context.json');
    const configFile = path.join(directory, 'config.json');
    const atomicWrite = (filename: string, data: unknown) => {
      const temporary = filename + '.' + randomUUID() + '.tmp';
      writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 }); renameSync(temporary, filename);
    };
    atomicWrite(contextFile, { userId: input.userId, sessionId: input.sessionId, runId: input.runId,
      metadata: input.metadata, configuration: { ...values, ...configuration.env, ...input.env } });
    atomicWrite(configFile, configuration.config);
    const additionalEnvironment: Record<string, string> = {};
    if (media) {
      const modelsFile = path.join(directory, 'models.json'); atomicWrite(modelsFile, media);
      additionalEnvironment.CAPABILITY_MEDIA_MODELS_FILE = modelsFile;
      additionalEnvironment.CAPABILITY_VIDEO_RENDERER = 'remotion';
    }
    const workspace = path.join(artifactsRoot(), input.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_'));
    mkdirSync(workspace, { recursive: true });
    const connector = createMcpStdioConnector({ id: input.id, command: process.execPath,
      args: [path.join(installed.release, installed.entry), ...installed.args, '--project', workspace], cwd: workspace,
      env: { ...minimalProcessEnvironment(), ...values, ...additionalEnvironment, ...configuration.env, ...input.env,
        CAPABILITY_RUNTIME_HOME: installed.runtimeDirectory, CAPABILITY_PROJECT_DIR: workspace,
        CAPABILITY_ARTIFACTS_DIR: workspace, CAPABILITY_STATE_DIR: path.join(directory, 'state'),
        CAPABILITY_MCP_VISUALIZATION: 'false',
        ...(input.id === 'maps' ? { CAPABILITY_MAPS_DIRECTORY: path.join(workspace, 'maps'), CAPABILITY_MAPS_QUOTA_DIRECTORY: path.join(appDataRoot(), '.data', 'maps-usage') } : {}),
        CAPABILITY_TOOL_CONTEXT_FILE: contextFile, CAPABILITY_TOOL_CONFIG_FILE: configFile },
      timeoutMs: 900_000 });
    cached = { id: input.id, userId: input.userId, sessionId: input.sessionId, connector, touched: Date.now(), active: 0, contextFile };
    pool.set(scope, cached);
  } else if (input.metadata) {
    const temporary = cached.contextFile + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify({ userId: input.userId, sessionId: input.sessionId, runId: input.runId, metadata: input.metadata, configuration: { ...values, ...configuration.env, ...input.env } }), { mode: 0o600 });
    renameSync(temporary, cached.contextFile);
  }
  const entry = cached;
  const call = entry.connector.call.bind(entry.connector);
  return { ...entry.connector, async call(name, args, context) {
    if (!input.observe) entry.active++; entry.touched = Date.now();
    try { return await call(name, args, context); }
    finally { if (!input.observe) entry.active--; entry.touched = Date.now(); }
  }, dispose: undefined };
}
const timer = setInterval(() => {
  const threshold = Date.now() - 5 * 60_000;
  for (const [key, entry] of pool) if (!entry.active && entry.touched < threshold) {
    pool.delete(key); void closeEntry(entry).catch(() => undefined);
  }
}, 30_000);
timer.unref();
export type { ManagedToolStatus };
