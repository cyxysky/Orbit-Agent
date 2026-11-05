import { z } from 'zod';
import type { CapabilityManifest } from '../index.ts';

export const extensionIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).refine(value => !value.includes('__'), 'Double underscores are reserved for tool namespacing.');
export const extensionPermissionSchema = z.enum(['storage:read', 'storage:write', 'project:read']);
export const extensionManifestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
  description: z.string().trim().min(1).max(1000),
  permissions: z.array(extensionPermissionSchema).max(3).default([]),
}).strict();

// Schemas supplied by executable extensions must not introduce host-side code,
// reference resolution, or unbounded regular-expression validation.
export function validateExtensionParameters(schema: Record<string, unknown>, depth = 0): void {
  if (depth > 8) throw new Error('Extension parameter schema exceeds eight levels.');
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
    'title', 'description', 'default', 'examples', '$schema']);
  if (Object.keys(schema).some(key => !allowed.has(key))) throw new Error('Unsupported extension schema keyword; regexes and references are not allowed.');
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(schema.type))) throw new Error('Extension schemas require an explicit structural type.');
  for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) throw new Error('Invalid schema bound.');
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length > 100
    || schema.enum.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value)))) throw new Error('Enums must contain at most 100 primitive values.');
  const children: unknown[] = [];
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)
      || Object.keys(schema.properties).length > 64) throw new Error('Invalid extension schema properties.');
    children.push(...Object.values(schema.properties));
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length > 64
    || schema.required.some(value => typeof value !== 'string'))) throw new Error('Invalid required properties.');
  if (schema.items !== undefined) children.push(schema.items);
  if (typeof schema.additionalProperties !== 'boolean' && schema.additionalProperties !== undefined) children.push(schema.additionalProperties);
  for (const child of children) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) throw new Error('Invalid nested extension schema.');
    validateExtensionParameters(child as Record<string, unknown>, depth + 1);
  }
}
export function parseExtensionToolInput(schema: Record<string, unknown>, input: unknown) {
  const serialized = JSON.stringify(input);
  if (!serialized || serialized.length > 256_000) throw new Error('Extension tool input exceeds 256,000 characters.');
  validateExtensionParameters(schema);
  return z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).parse(input);
}
export const extensionToolSchema = z.object({
  name: extensionIdSchema,
  description: z.string().trim().min(1).max(2000),
  parameters: z.record(z.string(), z.unknown()).refine(value => {
    try { validateExtensionParameters(value); return value.type === 'object'; } catch { return false; }
  }, 'Tool parameters must be a bounded structural object JSON Schema without regexes or references.'),
}).strict();
export const extensionMetadataSchema = z.object({
  manifest: extensionManifestSchema,
  tools: z.array(extensionToolSchema).min(1).max(20),
  hooks: z.array(z.enum(['load', 'beforeInvoke', 'afterInvoke', 'unload'])).max(4),
}).strict();
export type ExtensionMetadata = z.infer<typeof extensionMetadataSchema>;
export type ExtensionPermission = z.infer<typeof extensionPermissionSchema>;
export interface ExtensionContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly storage: { get(key: string): unknown; set(key: string, value: unknown): void; remove(key: string): void };
  readonly project: { readText(relativePath: string): string; list(relativePath?: string): { name: string; directory: boolean }[] };
}
export interface ExtensionAPI {
  registerTool<TInput = unknown>(definition: { name: string; description: string; parameters: Record<string, unknown>;
    execute(input: TInput, context: ExtensionContext): unknown | Promise<unknown> }): void;
  on(event: 'load' | 'unload', handler: (context: ExtensionContext) => unknown | Promise<unknown>): void;
  on(event: 'beforeInvoke' | 'afterInvoke', handler: (event: { tool: string; input?: unknown; result?: unknown }, context: ExtensionContext) => unknown | Promise<unknown>): void;
}

const id = extensionIdSchema;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const extensionRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(5) }).strict(),
  z.object({ action: z.literal('read'), id, revision: hash.optional() }).strict(),
  z.object({ action: z.literal('write'), id, source: z.string().min(1).max(128_000), expectedRevision: hash.optional() }).strict(),
  z.object({ action: z.literal('validate'), id }).strict(),
  z.object({ action: z.literal('probe'), id, tool: extensionIdSchema, input: z.unknown(), expectedRevision: hash }).strict(),
  z.object({ action: z.literal('activate'), id, expectedRevision: hash }).strict(),
  z.object({ action: z.literal('disable'), id, expectedRevision: hash }).strict(),
  z.object({ action: z.literal('rollback'), id, revision: hash, expectedRevision: hash }).strict(),
  z.object({ action: z.literal('remove'), id }).strict(),
]);
export type ExtensionRequest = z.infer<typeof extensionRequestSchema>;

export function extensionToolName(id: string, name: string) {
  const publicName = `ext_${id}__${name}`;
  if (publicName.length > 64) throw new Error('Namespaced extension tool names cannot exceed 64 characters. Shorten the extension or tool ID.');
  return publicName;
}
export function isExtensionToolName(name: string) { return name.length <= 64 && /^ext_[a-z][a-z0-9_]{0,31}__[a-z][a-z0-9_]{0,31}$/.test(name); }

export const extensionRuntimeSkill = {
  id: 'extensions.manage', title: 'Executable extensions', required: true,
  summary: '<system_skill id="extensions.manage"><title>自举与扩展</title><description>编写、验证和管理受限的可执行扩展；不依赖终端、浏览器或知识库开关。</description></system_skill>',
  activation: [{ toolName: 'selfBootstrap' }],
  content: [
    '# Executable extensions',
    'selfBootstrap manages TypeScript/JavaScript extensions in a host-owned workspace. It does not patch installed bundles or grant arbitrary host execution. list reports the fixed project root, extension directory, active versions, drafts and limits.',
    'write saves a draft. When replacing a draft, supply its current expectedRevision from read/list. validate checks syntax, module initialization and tool schemas only; it is not a functional acceptance result.',
    'probe runs one draft tool with real input and the declared permissions. It can change that extension\'s private storage; report such effects. activate requires the exact validated revision. disable/rollback require the current active expectedRevision. remove requires an inactive extension and removes its drafts, versions and private state.',
    'Activation, disable and rollback affect newly mounted Agent executions (including a later turn in the same conversation). Already mounted executions retain their immutable version. Do not spawn children merely to refresh tools. Begin the next turn to use newly activated ext_<id>__<tool> tools.',
    'An extension exports const manifest = {name,version,description,permissions:[]} and a default function(api). Call api.registerTool({name,description,parameters,execute(input,ctx)}) and optionally api.on("load"|"beforeInvoke"|"afterInvoke"|"unload", handler). execute and hooks may be async, but no external async resources or module imports exist.',
    'Tool execute returns JSON data, or {summary:string,data:JSON}. Context includes userId/sessionId, ctx.storage.get(key)/set(key,value)/remove(key) for private per-user storage, and ctx.project.readText(path)/list(path) for approved read-only project access. Declare storage:read, storage:write or project:read. File paths are relative. No process, require, Node modules, shell, network, environment variables or arbitrary filesystem access are available.',
    'Example: export const manifest={name:"Text statistics",version:"1.0.0",description:"Count supplied text",permissions:[]}; export default api=>{api.registerTool({name:"count",description:"Count characters",parameters:{type:"object",properties:{text:{type:"string"}},required:["text"],additionalProperties:false},execute(input){return {summary:"Counted characters",data:{characters:Array.from(input.text).length}}}})};',
    'Registered PLUGIN_* configuration fields are data, not executable extensions. Claim success only for the actual changed behavior and verified tool results; do not register status fields or write knowledge documents as a substitute for implementing the requested extension.',
  ].join('\n'),
} as const;

export const extensionCapabilityManifest: CapabilityManifest = {
  schemaVersion: 1, id: 'com.webpilot.extensions', name: 'Executable extensions', version: '1.0.0',
  description: 'Manage isolated executable extensions and immutable activation snapshots.',
  permissions: ['extensions:manage'], skills: [extensionRuntimeSkill],
};
