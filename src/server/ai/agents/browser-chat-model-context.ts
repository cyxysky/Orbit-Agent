import { createHash } from 'node:crypto';
import { modelMessageSchema, type ModelMessage } from 'ai';
import type { RuntimeContextManifest } from './runtime-context-assembler';
import type { RuntimeKnowledgeState } from './runtime-knowledge-context';
import { stripBrowserChatContextMarkers } from '../../../lib/browser-chat-visible-text';
import { withoutRuntimePromptCacheMetadata } from './runtime-prompt-cache';
import { parseContextSummary } from './runtime-semantic-summary';
import { completeRuntimeModelToolChain } from './runtime-context-compression';

export type BrowserChatModelContextCompression = {
  compressedAt: string;
  continuationSummary: string;
  estimatedTokensAfter: number;
  estimatedTokensBefore: number;
  retainedMessageCount: number;
  summarizedMessageCount: number;
  targetTokens: number;
  thresholdTokens: number;
  windowTokens: number;
};

export type BrowserChatModelContext = {
  version: 2;
  /** Immutable content-addressed records. Storage moves these out of the session header. */
  records: Record<string, ModelMessage>;
  history: string[];
  active: string[];
  lastRequest?: RuntimeContextManifest;
  backgroundRef?: string;
  knowledge?: RuntimeKnowledgeState;
  branches?: Record<string, {
    recordIds: string[];
    active: string[];
    history: string[];
    lastRequest?: RuntimeContextManifest;
    backgroundRef?: string;
    continuationSummary?: string;
    knowledge?: RuntimeKnowledgeState;
  }>;
  lastCompression?: Omit<BrowserChatModelContextCompression, 'continuationSummary'>;
  continuationSummary?: string;
};

const persistentBinaryOmissionText = '[Binary visual input omitted from persistent model context; use the conversation file registry to read it again.]';

function withoutPersistentBinaryParts(message: ModelMessage): ModelMessage {
  if (!Array.isArray(message.content)) return message;
  const content = message.content.filter((part) => (
    !part || typeof part !== 'object' || !('type' in part) || (part.type !== 'file' && part.type !== 'image')
  ));
  if (content.length) return { ...message, content } as ModelMessage;
  return { ...message, content: persistentBinaryOmissionText } as ModelMessage;
}

export function serializableBrowserChatModelMessages(messages: ModelMessage[]) {
  return normalizeBrowserChatModelMessages(messages.map(withoutPersistentBinaryParts));
}

export function compactBrowserChatModelTranscript(messages: ModelMessage[]) {
  // An interrupted/pending exchange is evidence too. Repair only the request view.
  return serializableBrowserChatModelMessages(messages);
}

export function browserChatContextRecordId(message: ModelMessage) {
  return `ctx_${createHash('sha256').update(JSON.stringify(message)).digest('hex')}`;
}

export function browserChatTranscript(context: BrowserChatModelContext) {
  return context.history.map((id) => context.records[id]).filter(Boolean);
}

export function browserChatActiveMessages(context: BrowserChatModelContext) {
  return completeRuntimeModelToolChain(context.active.map((id) => context.records[id]).filter(Boolean));
}

export function archiveBrowserChatContextMessages(context: BrowserChatModelContext, messages: ModelMessage[]) {
  const records = { ...context.records };
  for (const message of serializableBrowserChatModelMessages(messages)) {
    records[browserChatContextRecordId(message)] = message;
  }
  return { ...context, records };
}

function modelMessageText(message: ModelMessage) {
  if (typeof message.content === 'string') return message.content.trim();
  if (!Array.isArray(message.content)) return '';
  return message.content.flatMap((part) => {
    if (!part || typeof part !== 'object') return [];
    const text = 'text' in part && typeof part.text === 'string' ? part.text.trim() : '';
    return text ? [text] : [];
  }).join('\n').trim();
}

function currentTurnContains(messages: ModelMessage[], role: 'user' | 'assistant', text: string) {
  const start = messages.findLastIndex((message) => message.role === 'user');
  return messages.slice(Math.max(0, start)).some((message) => message.role === role && modelMessageText(message) === text.trim());
}
export function appendInterruptedBrowserChatTurn(messages: ModelMessage[], userContent: string, assistantContent: string, inputAlreadyStored = true) {
  const next = [...messages];
  if (!inputAlreadyStored) next.push({ role: 'user', content: userContent });
  const partial = stripBrowserChatContextMarkers(assistantContent).trim();
  if (partial && !currentTurnContains(next, 'assistant', partial)) next.push({ role: 'assistant', content: partial });
  // Interruption is session status, not model-authored text or a command to resume.
  return serializableBrowserChatModelMessages(next);
}
export function appendTerminalBrowserChatTurn(messages: ModelMessage[], userContent: string, assistantContent: string) {
  const next = [...messages];
  if (!currentTurnContains(next, 'user', userContent)) next.push({ role: 'user', content: userContent });
  if (assistantContent.trim() && !currentTurnContains(next, 'assistant', assistantContent)) next.push({ role: 'assistant', content: assistantContent });
  return serializableBrowserChatModelMessages(next);
}

export function normalizeBrowserChatModelMessages(value: unknown): ModelMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    const parsed = modelMessageSchema.safeParse(message);
    if (!parsed.success) return [];
    const normalized = withoutPersistentBinaryParts(parsed.data);
    if (normalized.role === 'assistant' && typeof normalized.content === 'string') {
      const content = stripBrowserChatContextMarkers(normalized.content).trim();
      return content ? [{ ...normalized, content }] : [];
    }
    return [normalized];
  });
}

export function normalizeBrowserChatModelContext(value: unknown): BrowserChatModelContext {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<BrowserChatModelContext> & { transcript?: unknown; activeMessages?: unknown }
    : {};
  const records: Record<string, ModelMessage> = { ...record.records };
  const register = (messages: ModelMessage[]) => messages.map((message) => {
    const id = browserChatContextRecordId(message);
    records[id] = message;
    return id;
  });
  const history = record.transcript !== undefined
    ? register(withoutRuntimePromptCacheMetadata(normalizeBrowserChatModelMessages(record.transcript)))
    : (record.history || []).filter((id) => Boolean(records[id]));
  const active = record.activeMessages !== undefined
    ? register(withoutRuntimePromptCacheMetadata(normalizeBrowserChatModelMessages(record.activeMessages)))
    : register(withoutRuntimePromptCacheMetadata(normalizeBrowserChatModelMessages((record.active || history).map((id) => records[id]).filter(Boolean))));
  const compression = record.lastCompression;
  const continuationSummary = parseContextSummary(record.continuationSummary) ? record.continuationSummary! : '';
  return {
    version: 2,
    records,
    history,
    active,
    ...(record.backgroundRef ? { backgroundRef: record.backgroundRef } : {}),
    ...(record.lastRequest ? { lastRequest: record.lastRequest } : {}),
    ...(record.knowledge ? { knowledge: record.knowledge } : {}),
    ...(record.branches ? { branches: record.branches } : {}),
    ...(compression && typeof compression === 'object' ? { lastCompression: { compressedAt: compression.compressedAt, estimatedTokensBefore: compression.estimatedTokensBefore, estimatedTokensAfter: compression.estimatedTokensAfter, retainedMessageCount: compression.retainedMessageCount, summarizedMessageCount: compression.summarizedMessageCount, targetTokens: compression.targetTokens, thresholdTokens: compression.thresholdTokens, windowTokens: compression.windowTokens } } : {}),
    ...(continuationSummary ? { continuationSummary } : {}),
  };
}
