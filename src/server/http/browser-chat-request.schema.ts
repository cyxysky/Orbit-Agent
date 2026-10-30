import { z } from 'zod';
import { reasoningEffortValues } from '@/lib/reasoning-effort';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional();

export const browserChatAttachmentSchema = z.object({
  id: text(120),
  name: text(500),
  type: text(200),
  size: z.number().finite().nonnegative().optional(),
  path: text(4_000),
  url: text(4_000),
  kind: z.enum(['image', 'file', 'tab']).optional(),
  sourceUrl: optionalText(4_000),
}).strict();

const browserChatSettingsSchema = z.object({
  safetyMode: z.enum(['strict', 'full']).default('strict'),
  disabledTools: z.array(text(80)).max(64).optional(),
  modelProvider: optionalText(120),
  model: optionalText(240),
  reasoningEffort: z.enum(reasoningEffortValues).optional(),
});

export const createBrowserChatSessionRequestSchema = browserChatSettingsSchema.extend({
  targetUrl: text(4_000).default(''),
  title: optionalText(240),
}).strict();

export const sendBrowserChatMessageRequestSchema = browserChatSettingsSchema.extend({
  content: text(100_000).default(''),
  clientMessageId: optionalText(120),
  subagentId: text(160).min(1).optional(),
  attachments: z.array(browserChatAttachmentSchema).max(8).default([]),
  skillIds: z.array(text(120)).max(200).default([]),
}).strict();

export const deleteBrowserChatSessionsRequestSchema = z.object({
  ids: z.array(text(120)).min(1).max(200),
}).strict();

export const setBrowserChatGroupRequestSchema = z.object({
  groupId: text(120).default(''),
}).strict();

export const updateBrowserChatSessionRequestSchema = z.object({
  title: text(240).min(1).optional(),
  reasoningEffort: z.enum(reasoningEffortValues).optional(),
}).strict().refine(value => value.title !== undefined || value.reasoningEffort !== undefined, 'Supply a title or reasoning effort.');

export const browserChatToolConfirmationRequestSchema = z.object({
  confirmationId: text(120).min(1),
  action: z.enum(['confirm', 'cancel']),
}).strict();
