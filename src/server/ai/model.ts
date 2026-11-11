import { runtimeConfiguration, runtimeSetting, withRuntimeConfiguration } from '@/server/settings/runtime-configuration';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { aiFetch } from './ai-fetch';
import { withAiReasoningSettings } from './ai-sdk-runtime';
import { currentReasoningEffort, withReasoningEffort } from './reasoning-scope';
import type { ReasoningEffortSetting } from '@/lib/reasoning-effort';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { generateText } from 'ai';
import { isModelProvider, defaultModelByProvider, openAICompatibleProviderIndex } from '@/config/settings';
import type { ModelProvider } from './schemas/runtime.schema';
import { ensureAiSdkTelemetryRegistered } from '@/server/ai/ai-sdk-telemetry';
import { filterSensitiveData } from '@/server/capabilities/sensitive-data';
import { normalizeToolInputSchemas } from '@/server/ai/tool-input-schema';
import { normalizeRuntimeCacheUsage } from '@/server/ai/agents/runtime-prompt-cache';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


ensureAiSdkTelemetryRegistered();

type GenerateTextModel = Parameters<typeof generateText>[0]['model'];
type LoadedLanguageModel = LanguageModelV4;
export type ModelSettingsOverride = {
  sessionId?: string;
  provider?: string;
  model?: string;
  supportsImageInput?: boolean;
  maxContextTokens?: number;
  reasoningEffort?: ReasoningEffortSetting;
};

const modelSettingsStorage = ((globalThis as typeof globalThis & {
  __webPilotModelSettingsStorage?: AsyncLocalStorage<ModelSettingsOverride>;
}).__webPilotModelSettingsStorage ??= new AsyncLocalStorage<ModelSettingsOverride>());


function optionalConfigurationValue(name: string) {
  return runtimeSetting(name)?.trim() || undefined;
}

const protectedOpenAICompatibleRequestFields = new Set([
  'model',
  'messages',
  'stream',
  'tools',
  'tool_choice',
]);

function extraOpenAICompatibleRequestParameters(settingKey: string) {
  const raw = String(runtimeSetting(settingKey) || '').trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => !protectedOpenAICompatibleRequestFields.has(key)));
  } catch {
    return {};
  }
}

function mergeExtraOpenAICompatibleRequestParameters(
  body: Record<string, unknown>,
  parameters: Record<string, unknown>,
) {
  return { ...body, ...parameters };
}

function lazyLanguageModel(
  provider: string,
  modelId: string,
  loader: () => Promise<LoadedLanguageModel>,
): GenerateTextModel {
  // Capture before lazy loading, which may run outside the settings scope.
  const reasoningEffort = currentReasoningEffort();
  const configuration = runtimeConfiguration();
  let resolvedModel: Promise<LoadedLanguageModel> | undefined;
  const loadModel = () => (resolvedModel ??= withRuntimeConfiguration(configuration, loader));
  return {
    specificationVersion: 'v4',
    provider,
    modelId,
    supportedUrls: {},
    doGenerate: async (options) => {
      const model = await loadModel();
      const prepared = normalizeToolInputSchemas(await filterSensitiveData(withAiReasoningSettings(options, reasoningEffort)));
      const result = await model.doGenerate(prepared);
      return { ...result, usage: normalizeRuntimeCacheUsage(result.usage) };
    },
    doStream: async (options) => {
      const model = await loadModel();
      const prepared = normalizeToolInputSchemas(await filterSensitiveData(withAiReasoningSettings(options, reasoningEffort)));
      const result = await model.doStream(prepared);
      return { ...result, stream: result.stream.pipeThrough(new TransformStream({
        transform(part, controller) {
          controller.enqueue(part.type === 'finish'
            ? { ...part, usage: normalizeRuntimeCacheUsage(part.usage) } : part);
        },
      })) };
    },
  } satisfies GenerateTextModel;
}

function openAiCompatibleModel(
  provider: 'openai-compatible' | `openai-compatible-${number}`,
  modelId: string,
  baseUrlEnvironmentName: string,
  defaultBaseURL: string,
  apiKeyEnvironmentName: string,
  extraRequestParametersEnvironmentName: string,
) {
  return lazyLanguageModel(provider, modelId, async () => {
    const baseURL = optionalConfigurationValue(baseUrlEnvironmentName) || defaultBaseURL;
    if (!baseURL) {
      throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `${provider} has no Base URL. Configure the complete OpenAI-compatible /v1 endpoint in model settings.`);
    }
    const extraRequestParameters = extraOpenAICompatibleRequestParameters(extraRequestParametersEnvironmentName);
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    return createOpenAICompatible({
      fetch: aiFetch,
      name: provider,
      baseURL,
      apiKey: optionalConfigurationValue(apiKeyEnvironmentName),
      transformRequestBody: (body) => mergeExtraOpenAICompatibleRequestParameters(body, extraRequestParameters),
    })(modelId) as unknown as LoadedLanguageModel;
  });
}

export function withModelSettings<T>(settings: ModelSettingsOverride, callback: () => T): T {
  const sessionId = settings.sessionId?.trim() || modelSettingsStorage.getStore()?.sessionId || randomUUID();
  return modelSettingsStorage.run({ ...settings, sessionId }, () => withReasoningEffort(settings.reasoningEffort, callback));
}

export function getModel(): GenerateTextModel {
  const { provider, model } = getModelSettings();
  if (provider === 'anthropic') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('ANTHROPIC_BASE_URL');
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    return createAnthropic({ fetch: aiFetch, apiKey: runtimeSetting('ANTHROPIC_API_KEY') || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'openai') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('OPENAI_BASE_URL');
    const { createOpenAI } = await import('@ai-sdk/openai');
    return createOpenAI({ fetch: aiFetch, apiKey: runtimeSetting('OPENAI_API_KEY') || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  const index = openAICompatibleProviderIndex(provider);
  if (!index) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Unsupported model protocol: ' + provider);
  const prefix = index === 1 ? 'OPENAI_COMPATIBLE' : 'OPENAI_COMPATIBLE_' + index;
  return openAiCompatibleModel(provider, model, prefix + '_BASE_URL', '', prefix + '_API_KEY', prefix + '_EXTRA_REQUEST_PARAMETERS');
}

export function getModelSettings() {
  const override = modelSettingsStorage.getStore();
  const selected = override?.provider || runtimeSetting('AI_PROVIDER') || 'openai';
  if (!isModelProvider(selected)) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED,
    'Unsupported model provider. Configure an OpenAI-compatible or Anthropic-compatible endpoint.');
  const provider: ModelProvider = selected;
  return {
    provider,
    model: override?.model || runtimeSetting('AI_MODEL') || defaultModelByProvider[provider] || 'custom-model',
    supportsImageInput: override?.supportsImageInput === true,
    maxContextTokens: override?.maxContextTokens,
  };
}
