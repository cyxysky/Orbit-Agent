import type { ModelConfigRecord } from '@/server/ai/schemas/runtime.schema';

export type RuntimeContextModel = {
  provider?: string;
  model?: string;
};

type ContextProfileOverride = { windowTokens?: number; outputReserveTokens?: number; imageTokens?: number };

let configuredModelWindows = new Map<string, number>();

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
  configuredModelWindows = windows;
}

function positive(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function ratio(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0.01 && number <= 0.99 ? number : fallback;
}

/** Profiles describe input budgeting only; they never inject output parameters into a request. */
export function runtimeContextProfile(input: RuntimeContextModel = {}) {
  let profiles: Record<string, ContextProfileOverride> = {};
  try { profiles = JSON.parse(process.env.AI_CONTEXT_MODEL_PROFILES || '{}'); } catch { /* validated below through defaults */ }
  const model = String(input.model || '').trim().toLowerCase();
  const key = `${input.provider || ''}/${model}`;
  const override = profiles?.[key] || profiles?.[model];
  const configuredWindow = configuredModelWindows.get(`${input.provider || ''}/${String(input.model || '').trim()}`);
  const minimaxM3 = /(?:^|\/)minimax-m3(?:$|[-._])/i.test(model);
  const legacyGlm = /(^|[\/:._-])glm(?:[\/:._-]|$)/i.test(model);
  const legacyWindow = positive(process.env.AI_CONTEXT_WINDOW_TOKENS || process.env.AI_MODEL_CONTEXT_TOKENS, 128000);
  const windowTokens = configuredWindow ?? positive(override?.windowTokens, minimaxM3 ? 1_000_000
    : legacyGlm ? positive(process.env.AI_GLM_CONTEXT_WINDOW_TOKENS, 1_000_000) : legacyWindow);
  const prefix = input.provider?.startsWith('openai-compatible')
    ? input.provider.toUpperCase().replaceAll('-', '_') : input.provider?.toUpperCase().replaceAll('-', '_');
  let requestedOutput = 0;
  try {
    const extra = JSON.parse(process.env[`${prefix}_EXTRA_REQUEST_PARAMETERS`] || '{}');
    requestedOutput = positive(extra.max_completion_tokens ?? extra.max_tokens, 0);
  } catch { /* Provider request validation owns malformed request parameters. */ }
  const requestedReserveTokens = Math.max(requestedOutput, positive(override?.outputReserveTokens,
    requestedOutput || (minimaxM3 ? 131072 : Math.min(16384, Math.floor(windowTokens * 0.1)))));
  const safetyTokens = Math.min(Math.max(1024, Math.floor(windowTokens * 0.05)), Math.floor(windowTokens * 0.1));
  const outputReserveTokens = Math.min(requestedReserveTokens, windowTokens - safetyTokens - 1);
  const inputBudgetTokens = Math.max(1, Math.min(Math.floor(windowTokens * 0.85), windowTokens - outputReserveTokens - safetyTokens));
  const compressionTriggerRatio = ratio(process.env.AI_CONTEXT_COMPRESSION_TRIGGER_RATIO, 0.85);
  const compressionTriggerTokens = Math.max(1, Math.min(inputBudgetTokens, Math.floor(windowTokens * compressionTriggerRatio)));
  const compressionTargetRatio = ratio(process.env.AI_CONTEXT_COMPRESSION_TARGET_RATIO, 0.25);
  return {
    key, windowTokens, outputReserveTokens, inputBudgetTokens,
    compressionTriggerTokens, compressionTargetTokens: Math.max(1, Math.floor(compressionTriggerTokens * compressionTargetRatio)),
    imageTokens: positive(override?.imageTokens, positive(process.env.AI_IMAGE_CONTEXT_ESTIMATE_TOKENS, 1200)),
    protocol: 'preserve-provider-reasoning-and-signatures' as const,
    source: configuredWindow !== undefined ? 'model-capabilities' : override ? 'configured-model-profile' : minimaxM3 ? 'minimax-m3-profile' : legacyGlm ? 'legacy-glm-profile' : 'configured-or-conservative-fallback',
  };
}

export function runtimeContextWindowTokens(input: RuntimeContextModel = {}) {
  return runtimeContextProfile(input).windowTokens;
}

export function runtimeContextCompressionThresholdRatio(input: RuntimeContextModel = {}) {
  const profile = runtimeContextProfile(input);
  return profile.compressionTriggerTokens / profile.windowTokens;
}

export function runtimeContextCompressionTargetFloorRatio() {
  return 0.1;
}

export function runtimeContextCompressionTargetCeilingRatio() {
  return 0.2;
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
  textTokens: number;
  totalTokens: number;
};

function runtimeImageContextEstimateTokens() {
  const configured = Number(process.env.AI_IMAGE_CONTEXT_ESTIMATE_TOKENS || 1200);
  return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : 1200;
}

export function estimateRuntimeMessageContext(messages: unknown): RuntimeMessageContextEstimate {
  const text: string[] = [];
  const visited = new WeakSet<object>();
  let imageCount = 0;

  const walk = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      if (key === 'data' || key === 'image' || value.startsWith('data:image/')) return;
      text.push(value);
      return;
    }
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item));
      return;
    }
    const record = value as Record<string, unknown>;
    const mediaType = typeof record.mediaType === 'string'
      ? record.mediaType
      : typeof record.type === 'string'
        ? record.type
        : '';
    const isImage = record.type === 'image'
      || mediaType.startsWith('image/')
      || (record.image !== undefined && typeof record.image !== 'string');
    if (isImage) imageCount += 1;
    for (const [childKey, child] of Object.entries(record)) {
      if (isImage && (childKey === 'data' || childKey === 'image')) continue;
      walk(child, childKey);
    }
  };

  walk(messages);
  const messageOverhead = Array.isArray(messages) ? messages.length * 4 : 0;
  const textTokens = estimateRuntimeTextTokens(text.join('\n')) + messageOverhead;
  const imageTokens = imageCount * runtimeImageContextEstimateTokens();
  return {
    imageCount,
    imageTokens,
    textTokens,
    totalTokens: textTokens + imageTokens,
  };
}
