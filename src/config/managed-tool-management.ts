import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(60);
export const managedToolConfigurationSchema = z.object({
  enabled: z.boolean(),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(20000)).refine(value => Object.keys(value).length <= 100),
  config: z.record(z.string(), z.unknown()),
}).strict();
export const managedToolManagementSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('status'), id }).strict(),
  z.object({ action: z.literal('check'), id }).strict(),
  z.object({ action: z.literal('install'), id }).strict(),
  z.object({ action: z.literal('retry'), id }).strict(),
  z.object({ action: z.literal('cancel'), id, jobId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('wait'), id, jobId: z.string().uuid(), timeoutMs: z.number().int().min(500).max(15000).default(10000) }).strict(),
  z.object({ action: z.literal('configure'), id, configuration: managedToolConfigurationSchema, clearEnv: z.array(z.string()).max(100).optional() }).strict(),
  z.object({ action: z.literal('stop'), id }).strict(),
  z.object({ action: z.literal('uninstall'), id }).strict(),
]);
