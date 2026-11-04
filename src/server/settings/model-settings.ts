import { z } from 'zod';
import {
  defaultModelByProvider,
  defaultModelForProvider,
  isOpenAICompatibleProvider,
  isModelProvider,
  modelListForProvider,
  modelProviderDefinitionsForConfig,
  modelProviderDefinition,
} from '@/config/settings';
import type { ModelProvider, ModelProviderSettings } from '@/server/ai/schemas/runtime.schema';
import { normalizedModelCapabilities } from '@/lib/model-capabilities';
import { store } from '@/server/db/store';
import { ApiRequestError } from '@/server/http/api-request';
import { normalizeModelProvider } from '@/lib/model-selection';
import { providerMediaSettingsSchema, mediaModelSelectionsSchema } from '@cjfclonedeep/capability-sdk/media/model-settings';

const providerPatchSchema = z.object({
  selectedModel: z.string().max(500).optional(),
  displayName: z.string().max(80).optional(),
  enabled: z.boolean().optional(),
  defaultModel: z.string().max(500).optional(),
  model: z.string().max(500).optional(),
  models: z.array(z.string().max(500)).max(200).optional(),
  apiKey: z.string().max(20000).optional(),
  baseURL: z.string().max(4000).optional(),
  extraRequestParameters: z.string().max(16000).optional(),
  modelCapabilities: z.record(z.string().max(500), z.object({ imageInput: z.boolean().optional(), maxContextTokens: z.number().int().positive().optional() }).strict()).optional(),
  media: z.partialRecord(z.enum(['image', 'video', 'speech']), z.record(z.string(), z.unknown())).optional(),
  hasApiKey: z.boolean().optional(),
  apiKeyPreview: z.string().optional(),
  updatedAt: z.string().optional(),
}).strict();

function normalizeExtraRequestParameters(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  if (value.length > 16_000) {
    throw new ApiRequestError('Extra request parameters must be at most 16 KB.', { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ApiRequestError('Extra request parameters must be valid JSON.', { status: 400 });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiRequestError('Extra request parameters must be a JSON object.', { status: 400 });
  }
  return JSON.stringify(parsed);
}

function readProviderSettings(value: unknown): Partial<Record<ModelProvider, ModelProviderSettings>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: Partial<Record<ModelProvider, ModelProviderSettings>> = {};
  for (const definition of modelProviderDefinitionsForConfig(input)) {
    const raw = input[definition.value];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const rawModels = Array.isArray(item.models)
      ? item.models.map((model) => typeof model === 'string' ? model : '').filter(Boolean)
      : [];
    const models = modelListForProvider(definition, {
      models: rawModels,
      defaultModel: typeof item.defaultModel === 'string' ? item.defaultModel : undefined,
      model: typeof item.model === 'string' ? item.model : undefined,
    });
    const model = defaultModelForProvider(definition, {
      models,
      defaultModel: typeof item.defaultModel === 'string' ? item.defaultModel : undefined,
      model: typeof item.model === 'string' ? item.model : undefined,
    });
    const rawCapabilities = item.modelCapabilities && typeof item.modelCapabilities === 'object' && !Array.isArray(item.modelCapabilities)
      ? item.modelCapabilities as Record<string, unknown>
      : {};
    const configuredCapabilities = Object.fromEntries(Object.entries(rawCapabilities).flatMap(([modelId, capability]) => {
      if (!capability || typeof capability !== 'object' || Array.isArray(capability)) return [];
      const imageInput = (capability as Record<string, unknown>).imageInput;
      const maxContextTokens = z.number().int().positive().optional().parse((capability as Record<string, unknown>).maxContextTokens);
      return typeof imageInput === 'boolean' ? [[modelId, { imageInput, maxContextTokens }]] : [];
    }));
    result[definition.value] = {
      selectedModel: typeof item.selectedModel === 'string' ? item.selectedModel : undefined,
      media: providerMediaSettingsSchema.parse(item.media || {}),
      displayName: typeof item.displayName === 'string' ? item.displayName.trim().slice(0, 80) : '',
      enabled: item.enabled === true,
      defaultModel: model,
      model,
      models,
      modelCapabilities: normalizedModelCapabilities(definition.value, models, configuredCapabilities),
      ...(typeof item.apiKey === 'string' && item.apiKey ? { apiKey: item.apiKey } : {}),
      baseURL: typeof item.baseURL === 'string' ? item.baseURL : definition.defaultBaseURL || '',
      extraRequestParameters: normalizeExtraRequestParameters(item.extraRequestParameters),
    };
  }
  return result;
}

export async function saveModelSettings(input: Record<string, unknown>) {
  const knownKeys = new Set(['provider', 'providers', 'providerOrder', 'mediaSelections', 'updatedAt', 'removedProviders', 'model', 'apiKey', 'baseURL', 'extraRequestParameters']);
  if (Object.keys(input).some(key => !knownKeys.has(key))) throw new ApiRequestError('包含未知的模型配置字段。');
  if (input.provider !== undefined && !isModelProvider(input.provider)) throw new ApiRequestError('未知的模型供应商。');
  if (input.providers !== undefined && (!input.providers || typeof input.providers !== 'object' || Array.isArray(input.providers))) throw new ApiRequestError('供应商配置必须是对象。');
  const removedProviders = z.array(z.string()).max(100).optional().parse(input.removedProviders)?.map((value) => {
    if (!isOpenAICompatibleProvider(value)) throw new ApiRequestError('只能删除自定义供应商。', { status: 400 });
    return value;
  }) || [];
  await store.saveModelConfig(existing => {
    const body: Record<string, unknown> = { ...input, provider: input.provider ?? existing?.provider };
    if (input.providers && typeof input.providers === 'object' && !Array.isArray(input.providers)) {
      body.providers = Object.fromEntries(Object.entries(input.providers).map(([provider, patch]) => {
        if (!isModelProvider(provider)) throw new ApiRequestError('未知的模型供应商。');
        const previous = existing?.providers[provider as ModelProvider];
        const values = providerPatchSchema.parse(patch);
        const media = values.media === undefined ? previous?.media : Object.fromEntries(Object.entries(z.record(z.string(), z.record(z.string(), z.unknown())).parse(values.media))
          .map(([kind, settings]) => [kind, { ...previous?.media?.[kind as keyof NonNullable<ModelProviderSettings['media']>], ...settings }]));
        const modelCapabilities = values.modelCapabilities === undefined ? previous?.modelCapabilities : Object.fromEntries(Object.entries(z.record(z.string(), z.record(z.string(), z.unknown())).parse(values.modelCapabilities))
          .map(([model, capability]) => [model, { ...previous?.modelCapabilities?.[model], ...capability }]));
        return [provider, { ...previous, ...values, media, modelCapabilities }];
      }));
    }
    const provider = normalizeModelProvider(body.provider);
    const providersInput = readProviderSettings(body.providers);
    if (!Object.keys(providersInput).length && (!existing || ['model', 'apiKey', 'baseURL', 'extraRequestParameters'].some(key => key in input))) {
      const definition = modelProviderDefinition(provider);
      const bodyModel = typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : defaultModelByProvider[provider] || definition.defaultModel;
      const models = modelListForProvider(definition, { model: bodyModel });
      const model = defaultModelForProvider(definition, { models, model: bodyModel });
      providersInput[provider] = {
        enabled: false,
        defaultModel: model,
        model,
        models,
        modelCapabilities: normalizedModelCapabilities(provider, models),
        ...(typeof body.apiKey === 'string' && body.apiKey.trim() ? { apiKey: body.apiKey } : {}),
        baseURL: typeof body.baseURL === 'string' ? body.baseURL : definition.defaultBaseURL || '',
        extraRequestParameters: normalizeExtraRequestParameters(body.extraRequestParameters),
      };
    }
    const providerOrder = body.providerOrder === undefined
      ? undefined
      : z.array(z.custom<ModelProvider>(isModelProvider)).max(100).parse(body.providerOrder);
    return { provider, providers: providersInput, providerOrder, mediaSelections: input.mediaSelections === undefined ? undefined : mediaModelSelectionsSchema.parse(input.mediaSelections) };
  }, removedProviders);
  await store.refreshRuntimeSettings();
}
