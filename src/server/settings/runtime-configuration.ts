import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { defaultModelByProvider, defaultModelProviderSettings, isModelProvider, migrateRuntimeSettingValue, modelProviderDefinition, modelProviderDefinitionsForConfig, openAICompatibleProviderIndex, runtimeSettingDefinitions } from '@/config/settings';
import type { ModelConfigRecord, ModelProvider, RuntimeSettingRecord } from '@/server/ai/schemas/runtime.schema';

export type RuntimeConfiguration = Readonly<Record<string, string | undefined>>;
type ConfigurationState = {
  values: RuntimeConfiguration;
  revision: string;
  scope: AsyncLocalStorage<RuntimeConfiguration>;
};
const root = globalThis as typeof globalThis & { __orbitRuntimeConfiguration?: ConfigurationState };
function defaultConfiguration() {
  const values: Record<string, string | undefined> = Object.fromEntries(runtimeSettingDefinitions.map(item => [item.key, item.defaultValue]));
  // Container/service topology remains deployment configuration. Saved tool
  // settings may override these connection defaults without restarting Orbit.
  if (process.env.ORBIT_CODE_SANDBOX_SERVICE_URL) {
    values.AGENT_CODE_SANDBOX_RUNNER_URL = process.env.ORBIT_CODE_SANDBOX_SERVICE_URL;
  }
  if (process.env.CODE_SANDBOX_RUNNER_TOKEN) {
    values.AGENT_CODE_SANDBOX_RUNNER_TOKEN = process.env.CODE_SANDBOX_RUNNER_TOKEN;
  }
  return values;
}

const state = root.__orbitRuntimeConfiguration ??= {
  values: Object.freeze(defaultConfiguration()),
  revision: '',
  scope: new AsyncLocalStorage(),
};

/** Application configuration is persisted data, never a process environment overlay. */
export function runtimeConfiguration(): RuntimeConfiguration {
  return state.scope.getStore() || state.values;
}

export function runtimeSetting(key: string): string | undefined {
  return runtimeConfiguration()[key];
}

export function withRuntimeConfiguration<T>(configuration: RuntimeConfiguration, operation: () => T): T {
  return state.scope.run(configuration, operation);
}

/** Convert a previous model entry during the one-time configuration import. */
export function legacyModelSettings(values: Readonly<Record<string, string | undefined>>) {
  const requested = values.AI_PROVIDER === 'gemini' ? 'google' : values.AI_PROVIDER;
  if (!requested) return undefined;
  if (!isModelProvider(requested)) return undefined;
  const provider = requested as ModelProvider;
  const definition = modelProviderDefinition(provider);
  return {
    provider,
    providers: {
      [provider]: {
        ...defaultModelProviderSettings(provider),
        enabled: true,
        model: values.AI_MODEL || definition.defaultModel,
        defaultModel: values.AI_MODEL || definition.defaultModel,
        models: [values.AI_MODEL || definition.defaultModel],
        apiKey: values[modelApiKeyEnvironment(provider)] || '',
        baseURL: values[modelBaseUrlEnvironment(provider)] || definition.defaultBaseURL || '',
        extraRequestParameters: values[modelExtraRequestParametersEnvironment(provider)] || '',
      },
    },
  };
}

export function publishRuntimeConfiguration(items: readonly RuntimeSettingRecord[], models?: ModelConfigRecord) {
  const values = defaultConfiguration();
  for (const item of items) {
    if (item.enabled !== false) values[item.key] = migrateRuntimeSettingValue(item.key, item.value);
  }
  Object.assign(values, modelConfigurationValues(models));
  const revision = createHash('sha256').update(JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  if (revision === state.revision) return false;
  state.values = Object.freeze(values);
  state.revision = revision;
  return true;
}

const modelApiKeyEnv: Partial<Record<ModelProvider, string>> = {
  'ai-gateway': 'AI_GATEWAY_API_KEY',
  alibaba: 'ALIBABA_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  'azure-openai': 'AZURE_OPENAI_API_KEY',
  bedrock: 'AWS_BEARER_TOKEN_BEDROCK',
  cerebras: 'CEREBRAS_API_KEY',
  codex: '',
  cohere: 'COHERE_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  groq: 'GROQ_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',
  'llama-cpp': 'LLAMA_CPP_API_KEY',
  lmstudio: 'LMSTUDIO_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  ollama: 'OLLAMA_API_KEY',
  openai: 'OPENAI_API_KEY',
  'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
  'openai-compatible-2': 'OPENAI_COMPATIBLE_2_API_KEY',
  'openai-compatible-3': 'OPENAI_COMPATIBLE_3_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  togetherai: 'TOGETHERAI_API_KEY',
  vercel: 'VERCEL_API_KEY',
  xai: 'XAI_API_KEY',
};

const modelBaseUrlEnv: Partial<Record<ModelProvider, string>> = {
  'ai-gateway': 'AI_GATEWAY_BASE_URL',
  alibaba: 'ALIBABA_BASE_URL',
  anthropic: 'ANTHROPIC_BASE_URL',
  'azure-openai': 'AZURE_OPENAI_BASE_URL',
  bedrock: 'AWS_REGION',
  cerebras: 'CEREBRAS_BASE_URL',
  codex: '',
  cohere: 'COHERE_BASE_URL',
  deepinfra: 'DEEPINFRA_BASE_URL',
  deepseek: 'DEEPSEEK_BASE_URL',
  fireworks: 'FIREWORKS_BASE_URL',
  google: '',
  groq: 'GROQ_BASE_URL',
  huggingface: 'HUGGINGFACE_BASE_URL',
  'llama-cpp': 'LLAMA_CPP_BASE_URL',
  lmstudio: 'LMSTUDIO_BASE_URL',
  minimax: 'MINIMAX_BASE_URL',
  mistral: 'MISTRAL_BASE_URL',
  ollama: 'OLLAMA_BASE_URL',
  openai: 'OPENAI_BASE_URL',
  'openai-compatible': 'OPENAI_COMPATIBLE_BASE_URL',
  'openai-compatible-2': 'OPENAI_COMPATIBLE_2_BASE_URL',
  'openai-compatible-3': 'OPENAI_COMPATIBLE_3_BASE_URL',
  openrouter: '',
  perplexity: 'PERPLEXITY_BASE_URL',
  togetherai: 'TOGETHERAI_BASE_URL',
  vercel: 'VERCEL_BASE_URL',
  xai: 'XAI_BASE_URL',
};

const modelExtraRequestParametersEnv: Partial<Record<ModelProvider, string>> = {
  minimax: 'MINIMAX_EXTRA_REQUEST_PARAMETERS',
  'openai-compatible': 'OPENAI_COMPATIBLE_EXTRA_REQUEST_PARAMETERS',
  'openai-compatible-2': 'OPENAI_COMPATIBLE_2_EXTRA_REQUEST_PARAMETERS',
  'openai-compatible-3': 'OPENAI_COMPATIBLE_3_EXTRA_REQUEST_PARAMETERS',
};

function openAICompatibleEnvironmentPrefix(provider: ModelProvider) {
  const index = openAICompatibleProviderIndex(provider);
  if (!index) return '';
  return index === 1 ? 'OPENAI_COMPATIBLE' : `OPENAI_COMPATIBLE_${index}`;
}

function modelApiKeyEnvironment(provider: ModelProvider) {
  const prefix = openAICompatibleEnvironmentPrefix(provider);
  return prefix ? `${prefix}_API_KEY` : modelApiKeyEnv[provider] || '';
}

function modelBaseUrlEnvironment(provider: ModelProvider) {
  const prefix = openAICompatibleEnvironmentPrefix(provider);
  return prefix ? `${prefix}_BASE_URL` : modelBaseUrlEnv[provider] || '';
}

function modelExtraRequestParametersEnvironment(provider: ModelProvider) {
  const prefix = openAICompatibleEnvironmentPrefix(provider);
  return prefix ? `${prefix}_EXTRA_REQUEST_PARAMETERS` : modelExtraRequestParametersEnv[provider] || '';
}


function modelConfigurationValues(config?: ModelConfigRecord) {
  const values: Record<string, string | undefined> = {};
  const normalized = config;
  if (!normalized) {
    values.AI_MODEL_PROVIDER_ENABLED = 'false';
    delete values.AI_PROVIDER;
    delete values.AI_MODEL;
    return values;
  }
  const providerDefinitions = modelProviderDefinitionsForConfig(normalized.providers);
  for (const definition of providerDefinitions) {
    const settings = normalized.providers[definition.value] || defaultModelProviderSettings(definition.value);
    const keyEnv = modelApiKeyEnvironment(definition.value);
    if (keyEnv) values[keyEnv] = settings.apiKey || '';
    const baseUrlEnv = modelBaseUrlEnvironment(definition.value);
    if (baseUrlEnv) values[baseUrlEnv] = settings.baseURL || definition.defaultBaseURL || '';
    const extraRequestParametersEnv = modelExtraRequestParametersEnvironment(definition.value);
    if (extraRequestParametersEnv) values[extraRequestParametersEnv] = settings.extraRequestParameters || '';
  }
  const activeProvider = normalized.providers[normalized.provider]?.enabled
    ? normalized.provider
    : providerDefinitions.find((definition) => normalized.providers[definition.value]?.enabled)?.value;
  if (!activeProvider) {
    values.AI_MODEL_PROVIDER_ENABLED = 'false';
    delete values.AI_PROVIDER;
    delete values.AI_MODEL;
    return values;
  }
  const active = normalized.providers[activeProvider] || defaultModelProviderSettings(activeProvider);
  values.AI_MODEL_PROVIDER_ENABLED = 'true';
  values.AI_PROVIDER = activeProvider;
  values.AI_MODEL = active.defaultModel || active.model || defaultModelByProvider[activeProvider] || modelProviderDefinition(activeProvider).defaultModel;
  return values;
}
