import { parseMediaModelSelection, mediaModelTypeDefinitions, mediaConfigurationForProviders } from '@webpilot/capability-media/model-settings';
export { mediaModelSelectionId, parseMediaModelSelection } from '@webpilot/capability-media/model-settings';
import {
  defaultModelByProvider,
  defaultModelForProvider,
  isModelProvider,
  modelListForProvider,
  modelProviderDefinition,
  modelProviderDefinitionsForConfig,
} from '@/config/settings';
import type { ModelConfigRecord, ModelProvider } from '@/server/ai/schemas/runtime.schema';

export type RuntimeModelConfig = Pick<ModelConfigRecord, 'provider' | 'providers' | 'providerOrder' | 'mediaSelections' | 'updatedAt'>;

export type RuntimeModelSelection = {
  model: string;
  provider: ModelProvider;
};

export type RuntimeModelOption = {
  description?: string;
  group?: string;
  label: string;
  selectedLabel?: string;
  selected?: boolean;
  value: string;
};

export const modelTypeLabels: Record<string, string> = { language: '对话模型', ...Object.fromEntries(mediaModelTypeDefinitions.map(({ id, label }) => [id, label])) };

function mediaProvidersForConfig(config: RuntimeModelConfig | null | undefined) {
  return Object.fromEntries(enabledModelProviders(config).map((provider) => [provider, config!.providers[provider]]));
}

export function mediaModelsForConfig(config: RuntimeModelConfig | null | undefined) {
  return mediaConfigurationForProviders(mediaProvidersForConfig(config), config?.mediaSelections);
}

const modelSelectionSeparator = '::model::';

export function normalizeModelProvider(value?: unknown, fallback: ModelProvider = 'openrouter'): ModelProvider {
  const provider = String(value || '').trim().toLowerCase();
  return isModelProvider(provider) ? provider : fallback;
}

export function modelSelectionValue(provider: ModelProvider, model: string) {
  return `${provider}${modelSelectionSeparator}${encodeURIComponent(model)}`;
}

export function parseModelSelectionValue(value: string): { provider: ModelProvider; model: string } {
  const [providerValue, encodedModel = ''] = value.split(modelSelectionSeparator);
  const provider = normalizeModelProvider(providerValue);
  const fallback = defaultModelByProvider[provider] || modelProviderDefinition(provider).defaultModel;
  try {
    return { provider, model: decodeURIComponent(encodedModel) || fallback };
  } catch {
    return { provider, model: fallback };
  }
}

function modelProviderSettings(config: RuntimeModelConfig | null | undefined, provider: ModelProvider) {
  return config?.providers?.[provider];
}

export function isModelProviderEnabled(config: RuntimeModelConfig | null | undefined, provider: ModelProvider) {
  return config?.providers?.[provider]?.enabled === true;
}

export function enabledModelProviders(config: RuntimeModelConfig | null | undefined) {
  if (!config) return [];
  return modelProviderDefinitionsForConfig(config.providers, config.providerOrder)
    .map((definition) => definition.value)
    .filter((provider) => isModelProviderEnabled(config, provider));
}

export function modelsForProvider(config: RuntimeModelConfig | null | undefined, provider: ModelProvider) {
  return modelListForProvider(modelProviderDefinition(provider), modelProviderSettings(config, provider));
}

export function defaultModelForConfig(config: RuntimeModelConfig | null | undefined, provider: ModelProvider) {
  return defaultModelForProvider(modelProviderDefinition(provider), modelProviderSettings(config, provider));
}

export function normalizeModelId(value: unknown, provider: ModelProvider, config?: RuntimeModelConfig | null) {
  const model = typeof value === 'string' ? value.trim() : '';
  if (parseMediaModelSelection(model)) return defaultModelForConfig(config, provider);
  if (model && !config) return model;
  const models = modelsForProvider(config, provider);
  return model && models.includes(model) ? model : defaultModelForConfig(config, provider);
}

export function normalizeRuntimeModelConfig(config?: Partial<RuntimeModelConfig> | null): RuntimeModelConfig | null {
  if (!config) return null;
  const provider = normalizeModelProvider(config.provider);
  return {
    provider,
    providers: config.providers || {},
    providerOrder: config.providerOrder,
    mediaSelections: config.mediaSelections,
    updatedAt: typeof config.updatedAt === 'string' ? config.updatedAt : '',
  };
}

export function resolveRuntimeModelSelection(
  config: RuntimeModelConfig | null | undefined,
  input: { fallbackProvider?: ModelProvider; model?: unknown; provider?: unknown } = {},
): RuntimeModelSelection {
  const fallbackProvider = config?.provider
    ? normalizeModelProvider(config.provider, input.fallbackProvider || 'openrouter')
    : input.fallbackProvider || 'openrouter';
  const requestedProvider = normalizeModelProvider(input.provider, fallbackProvider);
  const provider = config && !isModelProviderEnabled(config, requestedProvider)
    ? (isModelProviderEnabled(config, fallbackProvider) ? fallbackProvider : enabledModelProviders(config)[0] || fallbackProvider)
    : requestedProvider;
  return {
    provider,
    model: normalizeModelId((provider === requestedProvider ? input.model : undefined) ?? config?.providers[provider]?.selectedModel, provider, config),
  };
}

export function modelSelectionValueForConfig(
  config: RuntimeModelConfig | null | undefined,
  input: { model?: unknown; provider?: unknown },
) {
  const selection = resolveRuntimeModelSelection(config, input);
  return modelSelectionValue(selection.provider, selection.model);
}

export function modelSelectionDiagnosticLabel(
  config: RuntimeModelConfig | null | undefined,
  input: { model?: unknown; provider?: unknown },
) {
  const selection = resolveRuntimeModelSelection(config, input);
  const providerLabel = (provider: string) => config?.providers[provider as ModelProvider]?.displayName?.trim() || modelProviderDefinition(provider as ModelProvider).label;
  const language = config && !enabledModelProviders(config).length ? '尚未启用模型服务商' : `对话模型：${selection.model}\n供应商：${providerLabel(selection.provider)}`;
  const media = mediaModelsForConfig(config);
  return [language, ...mediaModelTypeDefinitions.map(({ id, label }) => {
    const current = media.models.find((model) => model.id === media.defaults[id]);
    return current ? `${label}：${current.name}\n供应商：${providerLabel(parseModelSelectionValue(current.id).provider)}` : `${label}：未配置`;
  })].join('\n\n');
}

export function modelSelectionOptionsForConfig(config: RuntimeModelConfig | null | undefined, input: { model?: unknown; provider?: unknown } = {}): RuntimeModelOption[] {
  const language = resolveRuntimeModelSelection(config, input);
  const media = mediaModelsForConfig(config);
  const mediaOptions: RuntimeModelOption[] = media.models.filter((model) => model.enabled).map((model) => {
    const { provider } = parseModelSelectionValue(model.id);
    const providerLabel = config?.providers[provider]?.displayName?.trim() || modelProviderDefinition(provider).label;
    return {
      group: `${providerLabel} / ${modelTypeLabels[model.kind]}`,
      label: model.name,
      selectedLabel: `${providerLabel} - ${modelTypeLabels[model.kind]} - ${model.name}`,
      selected: media.defaults[model.kind] === model.id,
      value: model.id,
    };
  });
  if (!config) return mediaOptions;
  return [...modelProviderDefinitionsForConfig(config.providers, config.providerOrder).flatMap((provider) => {
    if (!isModelProviderEnabled(config, provider.value)) return [];
    const models = modelsForProvider(config, provider.value);
    const providerLabel = config.providers?.[provider.value]?.displayName?.trim() || provider.label;
    return [...models.map((model) => ({
      group: `${providerLabel} / ${modelTypeLabels.language}`,
      label: model,
      selected: provider.value === language.provider && model === language.model,
      selectedLabel: `${providerLabel} - ${model}`,
      value: modelSelectionValue(provider.value, model),
    }))];
  }), ...mediaOptions];
}
