import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { createCapabilityRuntime, defineCapabilityInput, defineCapabilityTool, CodedError, ERROR_CODES, CapabilityTaskQueue,
  type CapabilityProvider, type CapabilityRunContext, type CapabilityExecutionContext } from '../index.ts';
import { extensionCapabilityManifest, extensionIdSchema, extensionMetadataSchema, extensionRequestSchema, extensionToolName,
  parseExtensionToolInput, type ExtensionMetadata, type ExtensionPermission } from './index.ts';

type Version = { id: string; revision: string; source: string; metadata: ExtensionMetadata; validatedAt: string };
type Draft = { id: string; revision: string; source: string; updatedAt: string };
type Registry = { active: Record<string, { revision: string; activatedAt: string }> };
type SandboxResult = { metadata: ExtensionMetadata; output?: unknown };
export type ExtensionManagerOptions = {
  directory: string;
  projectRoot?: string;
  projectDeniedPaths?: readonly string[];
  allowedPermissions?: readonly ExtensionPermission[];
  authorizeManagement(context: CapabilityRunContext): void | Promise<void>;
  authorizeInvocation?(context: CapabilityRunContext, extension: Version): void | Promise<void>;
};

function revision(source: string) { return createHash('sha256').update(source).digest('hex'); }
function error(message: string) { return new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, message); }
function workerExecArguments() {
  // Worker explicitly rejects process-wide V8 flags such as the API owner's
  // --max-old-space-size. Preserve only module-loader hooks needed in source mode.
  const result: string[] = [];
  for (let index = 0; index < process.execArgv.length; index++) {
    const argument = process.execArgv[index];
    if (['--loader', '--experimental-loader', '--import'].includes(argument)) {
      const value = process.execArgv[++index]; if (value) result.push(argument, value);
    } else if (/^--(?:loader|experimental-loader|import)=/.test(argument) || argument === '--no-warnings') result.push(argument);
  }
  return result;
}
function runtimeLifetime(context: CapabilityRunContext) {
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const scoped = { ...context, abortSignal: context.abortSignal
    ? AbortSignal.any([context.abortSignal, controller.signal]) : controller.signal };
  return { context: scoped, pending, async dispose() {
    controller.abort(error('Extension runtime has been disposed.'));
    await Promise.allSettled([...pending]);
  } };
}
const registrySchema = z.object({ active: z.record(extensionIdSchema, z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), activatedAt: z.string() }).strict()) }).strict();

export function createExtensionManager(options: ExtensionManagerOptions) {
  const directory = path.resolve(options.directory);
  const allowedPermissions = new Set(options.allowedPermissions || ['storage:read', 'storage:write']);
  const queue = new CapabilityTaskQueue({ concurrency: 2, maxQueued: 16, queueTimeoutMs: 30_000 });
  const versionCache = new Map<string, { mtime: number; size: number; value: Version }>();
  const deniedPaths = (options.projectDeniedPaths || []).map(item => item.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase());
  async function root() { await fs.mkdir(directory, { recursive: true }); return fs.realpath(directory); }
  async function owned(...parts: string[]) {
    let current = await root();
    for (const part of parts) {
      if (!part || part === '.' || part === '..' || /[\\/:]/.test(part)) throw error('Invalid extension workspace segment.');
      current = path.join(current, part);
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw error('Extension workspace symbolic links are denied.'); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    }
    return current;
  }
  async function read<T>(file: string, fallback?: T): Promise<T> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT' && fallback !== undefined) return fallback; throw cause; }
  }
  async function write(file: string, value: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.partial`;
    try { await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  async function locked<T>(operation: () => Promise<T>): Promise<T> {
    const file = await owned('registry.lock');
    const deadline = Date.now() + 5000;
    for (;;) {
      let handle: Awaited<ReturnType<typeof fs.open>>;
      try {
        handle = await fs.open(file, 'wx', 0o600);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
        const owner = await read<{ pid: number }>(file).catch(() => undefined);
        if (owner?.pid) {
          try { process.kill(owner.pid, 0); }
          catch (failure) { if ((failure as NodeJS.ErrnoException).code === 'ESRCH') { await fs.rm(file, { force: true }); continue; } }
        }
        if (Date.now() > deadline) throw error('Extension workspace is busy. Retry the operation.');
        await new Promise(resolve => setTimeout(resolve, 25));
        continue;
      }
      try { await handle.writeFile(JSON.stringify({ pid: process.pid })); return await operation(); }
      finally { await handle.close(); await fs.rm(file, { force: true }); }
    }
  }
  async function registry(): Promise<Registry> {
    const parsed = registrySchema.parse(await read(await owned('registry.json'), { active: {} }));
    return { active: Object.assign(Object.create(null), parsed.active) };
  }
  async function draft(id: string) { return read<Draft>(await owned('drafts', `${id}.json`)); }
  async function version(id: string, hash: string) {
    const file = await owned('versions', id, `${hash}.json`);
    const stat = await fs.stat(file);
    const cached = versionCache.get(file);
    if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) return cached.value;
    const value = await read<Version>(file);
    if (value.id !== id || value.revision !== hash || revision(value.source) !== hash) throw error('Extension version integrity check failed.');
    value.metadata = extensionMetadataSchema.parse(value.metadata);
    if (versionCache.size >= 128) versionCache.delete(versionCache.keys().next().value!);
    versionCache.set(file, { mtime: stat.mtimeMs, size: stat.size, value });
    return value;
  }
  async function versions(id: string) {
    const files = await fs.readdir(await owned('versions', id)).catch(cause => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause;
    });
    return Promise.all(files.filter(file => /^[a-f0-9]{64}\.json$/.test(file)).map(file => version(id, file.slice(0, -5))));
  }
  async function sandbox(value: Draft | Version, mode: 'inspect' | 'invoke', context: CapabilityRunContext,
    execution?: CapabilityExecutionContext, tool?: string, input?: unknown): Promise<SandboxResult> {
    execution?.abortSignal?.throwIfAborted(); context.abortSignal?.throwIfAborted();
    const metadata = 'metadata' in value ? value.metadata : undefined;
    const permissions = metadata?.manifest.permissions || [];
    if (permissions.some(permission => !allowedPermissions.has(permission))) throw error('Extension requests permissions not granted by its host.');
    const scope = createHash('sha256').update(context.userId || 'anonymous').digest('hex');
    const storageRoot = await owned('state', value.id, scope);
    await fs.mkdir(storageRoot, { recursive: true });
    const workerUrl = new URL('./worker.ts', import.meta.url);
    if (import.meta.url.endsWith('.js')) workerUrl.pathname = workerUrl.pathname.replace(/\.ts$/, '.js');
    const signals = [execution?.abortSignal, context.abortSignal].filter((value): value is AbortSignal => !!value);
    return queue.run(signal => new Promise<SandboxResult>((resolve, reject) => {
      const worker = new Worker(workerUrl, {
        workerData: { source: value.source, id: value.id, mode, tool, input, storageRoot,
          projectRoot: options.projectRoot && path.resolve(options.projectRoot), deniedPaths, permissions,
          userId: context.userId, sessionId: context.sessionId, memoryBytes: 16 * 1024 * 1024, timeoutMs: 1500 },
        env: {}, execArgv: workerExecArguments(),
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
      let finished = false;
      const finish = (cause?: unknown, result?: SandboxResult) => {
        if (finished) return; finished = true;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        void worker.terminate().catch(() => undefined).then(() => {
          if (cause) reject(cause); else resolve(result!);
        });
      };
      const abort = () => finish(signal?.reason || error('Extension execution aborted.'));
      const timer = setTimeout(() => finish(error('Extension worker exceeded its 15 second wall-clock limit.')), 15_000);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      worker.once('error', finish);
      worker.once('exit', code => { if (!finished) finish(error(`Extension worker exited without a result (${code}).`)); });
      worker.once('message', (message: { ok: boolean; error?: string; value?: SandboxResult }) => {
        if (!message.ok) { finish(error(message.error || 'Extension execution failed.')); return; }
        try {
          const result = { ...message.value!, metadata: extensionMetadataSchema.parse(message.value?.metadata) };
          if (result.metadata.manifest.permissions.some(permission => !allowedPermissions.has(permission))) throw error('Extension permission is not granted by the host.');
          // JSON Schema is validated at registration and is the very same schema mounted for the model.
          const names = new Set<string>();
          for (const tool of result.metadata.tools) {
            extensionToolName(value.id, tool.name);
            if (names.has(tool.name)) throw error('Duplicate extension tool name.');
            names.add(tool.name); z.fromJSONSchema(tool.parameters as Parameters<typeof z.fromJSONSchema>[0]);
          }
          finish(undefined, result);
        } catch (cause) { finish(cause); }
      });
    }), { abortSignal: signals.length ? AbortSignal.any(signals) : undefined });
  }
  async function prune(id: string, activeRevision: string | undefined) {
    const saved = (await versions(id)).sort((a, b) => b.validatedAt.localeCompare(a.validatedAt));
    for (const old of saved.slice(8)) if (old.revision !== activeRevision) await fs.rm(await owned('versions', id, `${old.revision}.json`));
  }
  function effective() { return { effective: 'next-agent-execution', runningExecutions: 'retain-their-mounted-version' }; }

  async function execute(raw: unknown, context: CapabilityRunContext, execution?: CapabilityExecutionContext) {
    context.abortSignal?.throwIfAborted(); execution?.abortSignal?.throwIfAborted();
    await options.authorizeManagement(context);
    context.abortSignal?.throwIfAborted(); execution?.abortSignal?.throwIfAborted();
    const input = extensionRequestSchema.parse(raw);
    if (input.action === 'list') {
      const current = await registry();
      const files = await fs.readdir(await owned('drafts')).catch(cause => { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause; });
      const ids = new Set([...Object.keys(current.active), ...files.filter(file => /^[a-z][a-z0-9_]{0,31}\.json$/.test(file)).map(file => file.slice(0, -5))]);
      return { projectRoot: options.projectRoot, directory, permissions: [...allowedPermissions],
        limits: { sourceCharacters: 128_000, heapBytes: 16 * 1024 * 1024, executionMs: 1500, versionsRetained: 8,
          concurrentWorkers: 2, queuedWorkers: 16, activeExtensions: 16, activeTools: 64 }, ...effective(),
        total: ids.size, nextOffset: input.offset + input.limit < ids.size ? input.offset + input.limit : null,
        extensions: await Promise.all([...ids].sort().slice(input.offset, input.offset + input.limit).map(async id => ({ id, active: current.active[id],
          draft: await draft(id).then(({ revision, updatedAt }) => ({ revision, updatedAt })).catch(() => undefined),
          versions: (await versions(id)).map(({ revision, metadata, validatedAt }) => ({ revision, name: metadata.manifest.name,
            version: metadata.manifest.version, permissions: metadata.manifest.permissions, tools: metadata.tools.map(tool => tool.name), validatedAt })) }))) };
    }
    if (input.action === 'read') return input.revision ? version(input.id, input.revision) : draft(input.id);
    if (input.action === 'write') return locked(async () => {
      const previous = await draft(input.id).catch(cause => { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw cause; });
      if (previous && input.expectedRevision !== previous.revision) throw error('Draft changed. Read its current revision before writing.');
      const current = await registry();
      const existing = await fs.readdir(await owned('drafts')).catch(() => []);
      if (!previous && new Set([...existing.map(file => file.replace(/\.json$/, '')), ...Object.keys(current.active)]).size >= 64) throw error('Extension workspace supports at most 64 extensions.');
      const value: Draft = { id: input.id, source: input.source, revision: revision(input.source), updatedAt: new Date().toISOString() };
      await write(await owned('drafts', `${input.id}.json`), value);
      return { id: value.id, revision: value.revision, saved: true, activated: false };
    });
    if (input.action === 'validate') {
      const value = await draft(input.id);
      const result = await sandbox(value, 'inspect', context, execution);
      const saved: Version = { ...value, metadata: result.metadata, validatedAt: new Date().toISOString() };
      await locked(async () => {
        if ((await draft(input.id)).revision !== value.revision) throw error('Draft changed during validation. Validate the latest draft.');
        const target = await owned('versions', input.id, `${value.revision}.json`);
        const existing = await read<Version | null>(target, null);
        if (existing) {
          if (existing.source !== saved.source || JSON.stringify(existing.metadata) !== JSON.stringify(saved.metadata)) {
            throw error('Extension registration is nondeterministic. Manifest and tool definitions must be stable for the same source.');
          }
        } else await write(target, saved);
        await prune(input.id, (await registry()).active[input.id]?.revision);
      });
      return { id: value.id, revision: value.revision, valid: true, functionalAcceptance: 'not-performed', metadata: result.metadata };
    }
    if (input.action === 'probe') {
      const value = await version(input.id, input.expectedRevision);
      if ((await draft(input.id)).revision !== value.revision) throw error('Probe requires the current validated draft.');
      const tool = value.metadata.tools.find(item => item.name === input.tool);
      if (!tool) throw error('Unknown draft tool.');
      const parsed = parseExtensionToolInput(tool.parameters, input.input);
      const result = await sandbox(value, 'invoke', context, execution, input.tool, parsed);
      return { id: input.id, revision: value.revision, tool: input.tool, output: result.output,
        effects: value.metadata.manifest.permissions.includes('storage:write') ? 'May update private extension storage.' : 'Read-only host access.' };
    }
    return locked(async () => {
      const current = await registry();
      const active = current.active[input.id];
      if (input.action === 'remove') {
        if (active) throw error('Disable the active extension before removing it.');
        // All targets are generated from validated IDs inside the pinned manager root.
        for (const parts of [['drafts', `${input.id}.json`], ['versions', input.id], ['state', input.id]]) {
          const target = await owned(...parts); await fs.rm(target, { recursive: true, force: true });
        }
        return { id: input.id, removed: true, ...effective() };
      }
      if (input.action === 'disable') {
        if (active?.revision !== input.expectedRevision) throw error('Active revision changed. Refresh before disabling.');
        delete current.active[input.id];
      } else {
        const hash = input.action === 'rollback' ? input.revision : input.expectedRevision;
        if (input.action === 'rollback' && active?.revision !== input.expectedRevision) throw error('Active revision changed. Refresh before rollback.');
        const saved = await version(input.id, hash);
        if (input.action === 'activate' && (await draft(input.id)).revision !== hash) throw error('Activation requires the current validated draft.');
        const other = Object.entries(current.active).filter(([id]) => id !== input.id);
        if (other.length >= 16) throw error('At most 16 extensions can be active. Disable one before activating another.');
        const activeTools = (await Promise.all(other.map(([id, item]) => version(id, item.revision))))
          .reduce((count, item) => count + item.metadata.tools.length, saved.metadata.tools.length);
        if (activeTools > 64) throw error('Active extension tool limit exceeded (64). Disable unused extensions.');
        current.active[input.id] = { revision: saved.revision, activatedAt: new Date().toISOString() };
      }
      await write(await owned('registry.json'), current);
      return { id: input.id, active: current.active[input.id] || null, ...effective() };
    });
  }

  async function snapshot() {
    const current = await registry();
    const snapshots = await Promise.all(Object.entries(current.active).map(([id, active]) => version(id, active.revision)));
    const providers: CapabilityProvider[] = snapshots.map(value => ({
      manifest: { schemaVersion: 1, id: `com.webpilot.extension.${value.id}`, name: value.metadata.manifest.name,
        version: value.metadata.manifest.version, description: value.metadata.manifest.description,
        skills: [{ id: `extensions.${value.id}`, title: value.metadata.manifest.name, summary: value.metadata.manifest.description,
          content: `Executable extension ${value.id}, revision ${value.revision}. Permissions: ${value.metadata.manifest.permissions.join(', ') || 'none'}.`,
          activation: value.metadata.tools.map(tool => ({ toolName: extensionToolName(value.id, tool.name) })) }] },
      async createRuntime(context) {
        await options.authorizeInvocation?.(context, value);
        const lifetime = runtimeLifetime(context);
        return createCapabilityRuntime({ dispose: lifetime.dispose, tools: Object.fromEntries(value.metadata.tools.map(tool => {
          const name = extensionToolName(value.id, tool.name);
          return [name, defineCapabilityTool({ name, description: `${tool.description}\nExtension ${value.id}, immutable revision ${value.revision}.`,
            input: defineCapabilityInput(tool.parameters, raw => parseExtensionToolInput(tool.parameters, raw)), policy: { concurrency: 'serial', concurrencyGroup: `extension:${value.id}:${context.userId || ''}` },
            async execute(input, execution) {
              let pending: Promise<SandboxResult> | undefined;
              try {
                pending = sandbox(value, 'invoke', lifetime.context, execution, tool.name, input);
                lifetime.pending.add(pending);
                const result = await pending;
                const output = result.output;
                const structured = output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : undefined;
                return { ok: true as const, summary: typeof structured?.summary === 'string' ? structured.summary.slice(0, 1000) : `${value.metadata.manifest.name}: ${tool.name}`,
                  data: structured && Object.hasOwn(structured, 'data') ? structured.data : output };
              } catch (cause) { return { ok: false as const, error: { code: ERROR_CODES.CAPABILITY_EXECUTION_FAILED, message: cause instanceof Error ? cause.message : String(cause) } }; }
              finally { if (pending) lifetime.pending.delete(pending); }
            } })];
        })) });
      },
    }));
    return { providers, catalog: snapshots.flatMap(value => value.metadata.tools.map(tool => ({ name: extensionToolName(value.id, tool.name),
      label: `${value.metadata.manifest.name} · ${tool.name}`, description: tool.description, revision: value.revision }))) };
  }
  function capability(): CapabilityProvider {
    return { manifest: extensionCapabilityManifest, async createRuntime(context) {
      await options.authorizeManagement(context);
      const lifetime = runtimeLifetime(context);
      return createCapabilityRuntime({ dispose: lifetime.dispose, tools: { selfBootstrap: defineCapabilityTool({ name: 'selfBootstrap', description: extensionCapabilityManifest.description!,
        input: defineCapabilityInput(z.toJSONSchema(extensionRequestSchema, { io: 'input' }), raw => extensionRequestSchema.parse(raw)),
        policy: { concurrency: 'serial', concurrencyGroup: 'extensions:manage' },
        async execute(input, execution) {
          const pending = execute(input, lifetime.context, execution);
          lifetime.pending.add(pending);
          try { return { ok: true as const, summary: `Extension ${input.action} completed`, data: await pending }; }
          catch (cause) { return { ok: false as const, error: { code: ERROR_CODES.CAPABILITY_EXECUTION_FAILED, message: cause instanceof Error ? cause.message : String(cause) } }; }
          finally { lifetime.pending.delete(pending); }
        } }) } });
    } };
  }
  return { execute, snapshot, capability };
}
