export { createWeComBotConnection, normalizeWeComInboundMessage, WECOM_BOT_RUNTIME_REVISION, type WeComBotConnection, type WeComInboundMessage, type WeComInboundAttachment } from './wecom-bot.ts';
import { randomUUID } from 'node:crypto';
import { createCapabilityDocumentDatabase } from '@webpilot/capability-sdk/node';
import path from 'node:path';
import type { AgentConnector } from '@webpilot/capability-connectors';
import type { CapabilityExecutionContext, CapabilityRunContext } from '@webpilot/capability-sdk';
export { createWeComMessageArguments, validateWeComMessageContent } from './wecom.ts';
import {
  createCommunicationCapability,
  CommunicationDeliveryError,
  type CommunicationChannel,
  type CommunicationChannelCapabilities,
  type CommunicationDraft,
  type CommunicationDraftStore,
  type CommunicationTarget,
} from './index.ts';

const allTargetKinds = ['user', 'group', 'department', 'email', 'address'] as const;
const allContentFormats = ['text', 'markdown'] as const;

function responseBody(text: string) {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function createJsonWebhookChannel(input: {
  id: string;
  name?: string;
  url: string;
  headers?: Readonly<Record<string, string>>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  capabilities?: CommunicationChannelCapabilities;
  mapBody?: (draft: CommunicationDraft) => unknown;
  verifyResponse?: (response: Response, body: unknown) => void | Promise<void>;
}): CommunicationChannel {
  const capabilities = input.capabilities || {
    targetKinds: allTargetKinds,
    contentFormats: allContentFormats,
    requiresExplicitTargets: false,
  };
  return {
    id: input.id,
    name: input.name || input.id,
    driverId: 'canonical-http-webhook',
    capabilities,
    async send(draft, context) {
      const timeout = AbortSignal.timeout(input.timeoutMs || 30_000);
      const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, timeout]) : timeout;
      const response = await (input.fetchImpl || fetch)(input.url, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...input.headers, 'idempotency-key': draft.id },
        body: JSON.stringify(input.mapBody ? input.mapBody(draft) : {
          targets: draft.targets,
          content: draft.content,
          metadata: draft.metadata,
        }),
      });
      const text = await response.text();
      const body = responseBody(text);
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}: ${text.slice(0, 1_000)}`);
      if (input.verifyResponse) {
        await input.verifyResponse(response, body);
      } else {
        const record = recordValue(body);
        if (record?.ok === false || record?.accepted === false) {
          throw new CommunicationDeliveryError(String(record.message || record.error || 'Webhook rejected the message.'), 'not-sent');
        }
      }
      const record = recordValue(body);
      const deliveryId = record?.id || record?.messageId || response.headers.get('x-request-id');
      return {
        channelId: input.id,
        deliveryIds: deliveryId === undefined || deliveryId === null || String(deliveryId).trim() === ''
          ? []
          : [String(deliveryId).trim()],
        acceptedAt: new Date().toISOString(),
        details: body,
      };
    },
  };
}

function connectorResultError(result: unknown) {
  const record = recordValue(result);
  const content = Array.isArray(record?.content)
    ? record.content.flatMap((item) => {
      const entry = recordValue(item);
      return typeof entry?.text === 'string' ? [entry.text] : [];
    }).join('\n')
    : '';
  if (record?.isError === true) {
    return content || String(record.message || record.error || 'Connector operation rejected the message.');
  }
  for (const value of connectorResultValues(result)) {
    const candidate = recordValue(value);
    if (!candidate) continue;
    if (candidate.ok === false || candidate.success === false || candidate.accepted === false) {
      return String(candidate.message || candidate.error || candidate.errmsg || 'Connector operation rejected the message.');
    }
  }
  return '';
}

function connectorResultValues(value: unknown, depth = 0): unknown[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => connectorResultValues(item, depth + 1));
  const record = recordValue(value);
  if (!record) return [value];
  const values: unknown[] = [record];
  if (record.type === 'text' && typeof record.text === 'string') {
    try {
      values.push(...connectorResultValues(JSON.parse(record.text), depth + 1));
    } catch {
      values.push(record.text);
    }
  }
  for (const key of ['content', 'structuredContent', 'data', 'result', 'response', 'receipt', 'output']) {
    if (record[key] !== undefined) values.push(...connectorResultValues(record[key], depth + 1));
  }
  return values;
}

function deliveryIdFromResult(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = deliveryIdFromResult(item, depth + 1);
      if (candidate) return candidate;
    }
    return undefined;
  }
  const record = recordValue(value);
  if (!record) return undefined;
  for (const key of ['deliveryId', 'delivery_id', 'messageId', 'message_id', 'msgid', 'req_id', 'id']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number') return String(candidate);
  }
  if (record.type === 'text' && typeof record.text === 'string') {
    try {
      return deliveryIdFromResult(JSON.parse(record.text), depth + 1);
    } catch {
      return undefined;
    }
  }
  for (const key of ['content', 'structuredContent', 'data', 'result', 'response', 'receipt', 'output']) {
    const identifier = deliveryIdFromResult(record[key], depth + 1);
    if (identifier) return identifier;
  }
  return undefined;
}

export function createConnectorCommunicationChannel(input: {
  id: string;
  name?: string;
  driverId: string;
  connector: AgentConnector;
  operationId: string;
  requiredOperationIds?: readonly string[];
  capabilities: Omit<CommunicationChannelCapabilities, 'requiresExplicitTargets'>;
  validateContent?: CommunicationChannel['validateContent'];
  defaultTargets?: readonly CommunicationTarget[];
  resolveTargets?: (
    targets: readonly CommunicationTarget[],
    draft: CommunicationDraft,
    context: CapabilityExecutionContext,
  ) => readonly CommunicationTarget[] | Promise<readonly CommunicationTarget[]>;
  mapArguments(draft: CommunicationDraft, target: CommunicationTarget, context: CapabilityExecutionContext): Record<string, unknown> | Promise<Record<string, unknown>>;
  verifyResult?: (result: unknown, target: CommunicationTarget) => void | Promise<void>;
  resolveDeliveryId?: (result: unknown, target: CommunicationTarget) => string | undefined;
}): CommunicationChannel {
  const defaultTargets = [...(input.defaultTargets || [])];
  return {
    id: input.id,
    name: input.name || input.id,
    driverId: input.driverId,
    validateContent: input.validateContent,
    capabilities: {
      ...input.capabilities,
      requiresExplicitTargets: defaultTargets.length === 0,
    },
    async send(draft, context) {
      let attempted = false;
      let accepted = false;
      try {
        input.validateContent?.(draft.content);
        const sourceTargets = draft.targets.length ? draft.targets : defaultTargets;
        const requestedTargets = [...new Map(sourceTargets.map((target) => [`${target.kind}:${target.id}`, target])).values()];
        const resolvedTargets = input.resolveTargets
          ? await input.resolveTargets(requestedTargets, draft, context)
          : requestedTargets;
        const targets = [...new Map(resolvedTargets.map((target) => [JSON.stringify([target.transport, target.kind, target.id]), target])).values()];
        if (!targets.length) throw new Error(`Channel ${input.id} requires a message target.`);
        const deliveryIds: string[] = [];
        const deliveries: Array<{ target: CommunicationTarget; result: unknown }> = [];
        for (const target of targets) {
          context.abortSignal?.throwIfAborted();
          const args = await input.mapArguments(draft, target, context);
          context.abortSignal?.throwIfAborted();
          attempted = true;
          const result = await input.connector.call(input.operationId, args, context);
          await input.verifyResult?.(result, target);
          const resultError = connectorResultError(result);
          if (resultError) throw new Error(resultError);
          accepted = true;
          const deliveryId = input.resolveDeliveryId?.(result, target) || deliveryIdFromResult(result);
          if (deliveryId) deliveryIds.push(deliveryId);
          deliveries.push({ target, result });
        }
        return {
          channelId: input.id,
          deliveryIds,
          acceptedAt: new Date().toISOString(),
          details: { operationId: input.operationId, deliveries },
        };
      } catch (error) {
        throw new CommunicationDeliveryError(error instanceof Error ? error.message : String(error),
          accepted ? 'unknown' : !attempted || (error instanceof CommunicationDeliveryError && error.outcome === 'not-sent') ? 'not-sent' : 'unknown',
          { cause: error });
      }
    },
    async health() {
      try {
        const operations = await input.connector.listOperations({ invocationId: `communication-health-${randomUUID()}` });
        const operationIds = new Set(operations.map((operation) => operation.id));
        const requiredOperationIds = [...new Set([input.operationId, ...(input.requiredOperationIds || [])])];
        const missingOperationIds = requiredOperationIds.filter((operationId) => !operationIds.has(operationId));
        return missingOperationIds.length === 0
          ? { status: 'healthy' }
          : { status: 'unhealthy', message: `Connector does not expose ${missingOperationIds.join(', ')}.` };
      } catch (error) {
        return { status: 'unhealthy', message: error instanceof Error ? error.message : String(error) };
      }
    },
    async dispose() {
      await input.connector.dispose?.();
    },
  };
}

export function createFileCommunicationDraftStore(input: { directory: string }): CommunicationDraftStore {
  const store = createCapabilityDocumentDatabase<CommunicationDraft>({
    directory: input.directory, filename: 'drafts.db', legacyFilename: 'drafts.json',
    readLegacy(value) {
      const file = value as { version?: number; drafts?: CommunicationDraft[] };
      if (file.version !== 2 || !Array.isArray(file.drafts)) throw new Error('Invalid legacy communication store.');
      return file.drafts;
    },
  });
  return {
    async create(input) {
      const draft: CommunicationDraft = { ...input, delivery: undefined, id: randomUUID(), createdAt: new Date().toISOString() };
      store.transaction(() => store.save(draft));
      return draft;
    },
    async get(id) { return store.get(id); },
    async claimDelivery(id) {
      return store.transaction(() => {
        const draft = store.get(id);
        if (!draft) throw new Error(`Unknown draft: ${id}.`);
        const claimed = !draft.delivery || draft.delivery.status === 'failed';
        if (claimed) {
          draft.delivery = { status: 'sending', updatedAt: new Date().toISOString() };
          store.save(draft);
        }
        return { claimed, draft };
      });
    },
    async finishDelivery(id, delivery) {
      store.transaction(() => {
        const draft = store.get(id);
        if (!draft) throw new Error(`Unknown draft: ${id}.`);
        draft.delivery = delivery;
        store.save(draft);
      });
    },
    dispose: store.dispose,
  };
}

export function createNodeCommunicationCapability(input: {
  channels: readonly CommunicationChannel[] | ((context: CapabilityRunContext) => readonly CommunicationChannel[] | Promise<readonly CommunicationChannel[]>);
  draftDirectory?: string | ((context: CapabilityRunContext) => string);
}) {
  return createCommunicationCapability({
    createChannels(context) {
      return typeof input.channels === 'function' ? input.channels(context) : input.channels;
    },
    createDraftStore: input.draftDirectory
      ? (context) => createFileCommunicationDraftStore({
        directory: typeof input.draftDirectory === 'function' ? input.draftDirectory(context) : input.draftDirectory!,
      })
      : undefined,
  });
}
