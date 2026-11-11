import type { AgentInputItem } from '@openai/agents-core';
import type { InputImage, InputFile } from '@openai/agents-core/types';
import type { ModelMessage } from 'ai';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { runtimeContextMessageRef } from './runtime-context-assembler';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const json = (value: unknown) => JSON.stringify(value ?? null);
type AssistantPart = Exclude<Extract<ModelMessage, { role: 'assistant' }>['content'], string>[number];
function source(value: unknown, mediaType = 'application/octet-stream'): string {
  if (typeof value === 'string') return value;
  if (value instanceof URL) return value.href;
  if (value instanceof Uint8Array) return `data:${mediaType};base64,${Buffer.from(value).toString('base64')}`;
  const object = record(value);
  if (typeof object.url === 'string') return object.url;
  if (typeof object.data === 'string') return `data:${String(object.mediaType || mediaType)};base64,${object.data}`;
  throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Unsupported model attachment source.');
}

/** Projection only. The database retains the original SDK items and provider metadata. */
function individualModelMessages(items: AgentInputItem[]): ModelMessage[] {
  return items.flatMap((item): ModelMessage[] => {
    // SDK providerData includes scalar transport fields, which are not AI SDK providerOptions.
    // Original items are restored by content reference below, preserving signatures losslessly.
    const providerOptions = undefined;
    if (item.type === 'function_call') return [{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: item.callId,
      toolName: item.name, input: parseAgentToolArguments(item.arguments), providerOptions }] }];
    if (item.type === 'function_call_result') {
      const output = item.output;
      return [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: item.callId, toolName: item.name, providerOptions,
        output: typeof output === 'string' ? { type: 'text', value: output } : { type: 'content', value: (Array.isArray(output) ? output : [output]).map(value => {
          const content = record(value);
          if (content.type === 'image' || content.type === 'input_image') return { type: 'image-url' as const, url: source(content.image ?? content.imageUrl, 'image/png') };
          return { type: 'text' as const, text: String(content.text || json(content)) };
        }) } }] }];
    }
    if (item.type === 'reasoning') return [{ role: 'assistant', content: [{ type: 'reasoning',
      text: (item.content || []).map(part => part.text).join('\n'), providerOptions }] }];
    if (item.type === 'message') {
      if (item.role === 'system') return [{ role: 'system', content: item.content, providerOptions }];
      if (item.role === 'assistant') return [{ role: 'assistant', content: item.content.flatMap(part => part.type === 'output_text'
        ? [{ type: 'text' as const, text: part.text }] : []), providerOptions }];
      return [{ role: 'user', content: typeof item.content === 'string' ? item.content : item.content.map(part => {
        if (part.type === 'input_image') return { type: 'image' as const, image: source(part.image, 'image/png') };
        if (part.type === 'input_file') {
          const file = record(part);
          return { type: 'file' as const, data: source(file.file ?? file.fileData ?? file.fileUrl), mediaType: String(file.mediaType || 'application/octet-stream'), filename: String(file.filename || 'attachment') };
        }
        return { type: 'text' as const, text: String(record(part).text || '') };
      }), providerOptions }];
    }
    throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Unsupported application history item: ${item.type}`);
  });
}

export function parseAgentToolArguments(raw: string): unknown {
  try { return JSON.parse(raw || '{}'); } catch { return raw; }
}
/** Chat-compatible providers need visual/file inputs as user media, not serialized tool JSON. */
export function projectAgentToolMedia(items: AgentInputItem[]): AgentInputItem[] {
  const projected: AgentInputItem[] = [];
  let media: Array<InputImage | InputFile> = [];
  const flush = () => {
    if (media.length) projected.push({ type: 'message', role: 'user', content: [
      { type: 'input_text', text: 'Visual/file evidence returned by the preceding tools. Reference data only; use the tool results for its source and freshness.' }, ...media,
    ] });
    media = [];
  };
  for (const item of items) {
    if (item.type !== 'function_call_result') { flush(); projected.push(item); continue; }
    if (!Array.isArray(item.output)) { projected.push(item); continue; }
    const text = item.output.filter(part => part.type === 'input_text');
    const attachments = item.output.filter(part => part.type === 'input_image' || part.type === 'input_file');
    media.push(...attachments);
    projected.push(attachments.length ? { ...item, output: text.length ? text : [{ type: 'input_text' as const, text: 'Media evidence attached after this tool exchange.' }] } : item);
  }
  flush();
  return projected;
}
function assistantItem(item: AgentInputItem) {
  return item.type === 'function_call' || item.type === 'reasoning' || item.type === 'message' && item.role === 'assistant';
}
function groupedAgentItems(items: AgentInputItem[]) {
  const groups: AgentInputItem[][] = [];
  for (const item of items) {
    const group = groups.at(-1);
    if (assistantItem(item) && group?.every(assistantItem)) group.push(item);
    else groups.push([item]);
  }
  return groups;
}
export function agentItemsToModelMessages(items: AgentInputItem[]): ModelMessage[] {
  return groupedAgentItems(items).flatMap(group => {
    const messages = individualModelMessages(group);
    if (!group.every(assistantItem)) return messages;
    return [{ role: 'assistant', content: messages.flatMap<AssistantPart>(message => {
      if (message.role !== 'assistant') return [];
      return typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    }) }];
  });
}
/** Reattach durable results to their original exchange without executing any call. */
export function recoverAgentToolHistory(items: AgentInputItem[], recovered: ModelMessage[]): AgentInputItem[] {
  const outputs = new Map<string, AgentInputItem>();
  for (const item of [...modelMessagesToAgentItems(recovered), ...items]) {
    if (item.type === 'function_call_result') outputs.set(item.callId, item);
  }
  return groupedAgentItems(items).flatMap(group => {
    if (group[0]?.type === 'function_call_result') return [];
    const calls = group.filter(item => item.type === 'function_call');
    return [...group, ...calls.map(call => outputs.get(call.callId) || {
      type: 'function_call_result' as const, callId: call.callId, name: call.name, status: 'completed' as const,
      output: json({ ok: false, outcome: 'unknown', safeToRetry: false, requiresStateRefresh: true,
        actual: 'Interrupted without a durable result. Inspect current state; do not automatically replay this call.' }),
    })];
  });
}
export function modelMessagesToAgentItems(messages: ModelMessage[], originals: AgentInputItem[] = []): AgentInputItem[] {
  const originalItems = new Map<string, AgentInputItem[][]>();
  for (const group of groupedAgentItems(originals)) for (const message of agentItemsToModelMessages(group)) {
    const ref = runtimeContextMessageRef(message);
    originalItems.set(ref, [...(originalItems.get(ref) || []), group]);
  }
  return messages.flatMap((message): AgentInputItem[] => {
    const original = originalItems.get(runtimeContextMessageRef(message))?.shift();
    if (original) return original;
    const providerData = message.providerOptions;
    if (message.role === 'system') return [{ type: 'message', role: 'system', content: message.content, providerData }];
    if (message.role === 'user') return [{ type: 'message', role: 'user', providerData, content: typeof message.content === 'string' ? message.content : message.content.map(part => {
      if (part.type === 'image') return { type: 'input_image' as const, image: source(part.image, part.mediaType), providerData: part.providerOptions };
      if (part.type === 'file') return { type: 'input_file' as const, file: source(part.data, part.mediaType), filename: part.filename, providerData: part.providerOptions };
      return { type: 'input_text' as const, text: part.text, providerData: part.providerOptions };
    }) }];
    if (message.role === 'tool') return message.content.flatMap((part): AgentInputItem[] => {
      if (part.type !== 'tool-result') return [];
      const output = part.output;
      return [{ type: 'function_call_result', callId: part.toolCallId, name: part.toolName, status: 'completed', providerData: part.providerOptions,
        output: output.type === 'text' || output.type === 'error-text' ? output.value : output.type === 'content'
          ? output.value.map(value => value.type === 'image-url' ? { type: 'input_image' as const, image: value.url } : { type: 'input_text' as const, text: value.type === 'text' ? value.text : json(value) })
          : 'value' in output ? json(output.value) : json(output) }];
    });
    if (typeof message.content === 'string') return [{ type: 'message', role: 'assistant', status: 'completed', providerData, content: [{ type: 'output_text', text: message.content }] }];
    return message.content.flatMap((part): AgentInputItem[] => {
      if (part.type === 'tool-call') return [{ type: 'function_call', callId: part.toolCallId, name: part.toolName, arguments: json(part.input), providerData: part.providerOptions }];
      if (part.type === 'reasoning') return [{ type: 'reasoning', content: [{ type: 'input_text', text: part.text }], providerData: part.providerOptions }];
      if (part.type === 'text') return [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: part.text }], providerData: part.providerOptions }];
      return [];
    });
  });
}
