import type { ModelConfigRecord } from '@/server/ai/schemas/runtime.schema';

export type RuntimeContextModel = {
  provider?: string;
  model?: string;
  maxContextTokens?: number;
};

// Next route bundles and hot reloads must share the same applied model config.
const contextState = ((globalThis as typeof globalThis & {
  __webPilotModelContextWindows?: { windows: Map<string, number> };
}).__webPilotModelContextWindows ??= { windows: new Map<string, number>() });

export function configureRuntimeModelContexts(providers: ModelConfigRecord['providers'] = {}) {
  const windows = new Map<string, number>();
  for (const [provider, settings] of Object.entries(providers)) {
    for (const [model, capabilities] of Object.entries(settings?.modelCapabilities || {})) {
      const limit = capabilities.maxContextTokens;
      if (typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0) {
        windows.set(`${provider}/${model}`, limit);
      }
    }
  }
  contextState.windows = windows;
}

function positive(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function ratio(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0.01 && number <= 0.99 ? number : fallback;
}

/** Reserve completion and protocol safety space before allocating the input window. */
export function runtimeContextProfile(input: RuntimeContextModel = {}) {
  const model = String(input.model || '').trim();
  const key = `${input.provider || ''}/${model}`;
  const configuredWindow = input.maxContextTokens !== undefined
    ? positive(input.maxContextTokens, 0) || undefined
    : contextState.windows.get(key);
  const windowTokens = configuredWindow ?? positive(process.env.AI_CONTEXT_WINDOW_TOKENS, 256000);
  // Internal accounting only. Provider request parameters are owned by model.ts.
  const outputReserveTokens = positive(process.env.AI_CONTEXT_OUTPUT_RESERVE_TOKENS, 4096);
  const safetyReserveTokens = positive(process.env.AI_CONTEXT_SAFETY_RESERVE_TOKENS, 4096);
  const inputBudgetTokens = windowTokens - outputReserveTokens - safetyReserveTokens;
  if (inputBudgetTokens <= 0) throw new Error('Context window must exceed output and safety reserves.');
  const compressionTriggerRatio = ratio(process.env.AI_CONTEXT_COMPRESSION_TRIGGER_RATIO, 0.82);
  const compressionTriggerTokens = Math.max(1, Math.floor(inputBudgetTokens * compressionTriggerRatio));
  const compressionTargetRatio = ratio(process.env.AI_CONTEXT_COMPRESSION_TARGET_RATIO, 0.6);
  return {
    key, windowTokens, outputReserveTokens, inputBudgetTokens, safetyReserveTokens,
    compressionTriggerTokens, compressionTargetTokens: Math.max(1, Math.min(Math.floor(inputBudgetTokens * compressionTargetRatio), Math.floor(compressionTriggerTokens * 0.9))),
    imageTokens: positive(process.env.AI_IMAGE_CONTEXT_ESTIMATE_TOKENS, 1200),
    protocol: 'preserve-provider-reasoning-and-signatures' as const,
    source: configuredWindow !== undefined ? 'model-capabilities' : 'default-context-window',
  };
}

export function runtimeContextWindowTokens(input: RuntimeContextModel = {}) {
  return runtimeContextProfile(input).windowTokens;
}

export function runtimeContextCompressionThresholdRatio(input: RuntimeContextModel = {}) {
  const profile = runtimeContextProfile(input);
  return profile.compressionTriggerTokens / profile.windowTokens;
}

export function estimateRuntimeTextTokens(text: string) {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4 + nonAscii);
}

export type RuntimeMessageContextEstimate = {
  imageCount: number;
  imageTokens: number;
  textCharacters: number;
  serializedCharacters: number;
  valueTextTokens: number;
  serializedTextTokens: number;
  textTokens: number;
  totalTokens: number;
};

function runtimeImageContextEstimateTokens() {
  const configured = Number(process.env.AI_IMAGE_CONTEXT_ESTIMATE_TOKENS || 1200);
  return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : 1200;
}

export function estimateRuntimeMessageContext(messages: unknown): RuntimeMessageContextEstimate {
  const text: string[] = [];
  const ancestors = new WeakSet<object>();
  let imageCount = 0;

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      text.push(value);
      return value;
    }
    if (typeof value === 'bigint') return walk(String(value));
    if (!value || typeof value !== 'object') return value;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[Binary data]';
    if (ancestors.has(value)) return '[Circular]';
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return value.map(walk);
      const record = value as Record<string, unknown>;
      const mediaType = typeof record.mediaType === 'string' ? record.mediaType : '';
      const isImage = record.type === 'image' || mediaType.startsWith('image/');
      const isFile = record.type === 'file';
      if (isImage) imageCount += 1;
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(record)) {
        // Only media parts own binary data. Tool payloads named data are text.
        if ((isImage || isFile) && (key === 'data' || key === 'image')) continue;
        output[key] = walk(child);
      }
      return output;
    } finally {
      ancestors.delete(value);
    }
  };

  const serialized = JSON.stringify(walk(messages)) || '';
  const valueTextTokens = estimateRuntimeTextTokens(text.join('\n'));
  const serializedTextTokens = estimateRuntimeTextTokens(serialized);
  const textTokens = Math.max(valueTextTokens, serializedTextTokens);
  const imageTokens = imageCount * runtimeImageContextEstimateTokens();
  return {
    imageCount,
    imageTokens,
    textCharacters: text.reduce((sum, value) => sum + value.length, 0),
    serializedCharacters: serialized.length,
    valueTextTokens,
    serializedTextTokens,
    textTokens,
    totalTokens: textTokens + imageTokens,
  };
}
