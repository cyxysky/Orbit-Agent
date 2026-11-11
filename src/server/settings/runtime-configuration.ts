import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { defaultModelByProvider, defaultModelProviderSettings, isModelProvider, migrateRuntimeSettingValue, modelProviderDefinition, modelProviderDefinitionsForConfig, openAICompatibleProviderIndex } from '@/config/settings';
import type { ModelConfigRecord, ModelProvider, RuntimeSettingRecord } from '@/server/ai/schemas/runtime.schema';
import { configurationDefinitions } from './settings-registry';

export type RuntimeConfiguration = Readonly<Record<string, string | undefined>>;
type ConfigurationState = {
  values: RuntimeConfiguration;
  revision: string;
  scope: AsyncLocalStorage<RuntimeConfiguration>;
};
const root = globalThis as typeof globalThis & { __orbitRuntimeConfiguration?: ConfigurationState };
function defaultConfiguration() {
  const values: Record<string, string | undefined> = Object.fromEntries(configurationDefinitions().map(item => [item.key, item.defaultValue]));
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
  const requested = values.AI_PROVIDER;
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

const modelApiKeyEnv: Partial<Record<ModelProvider, string>> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
const modelBaseUrlEnv: Partial<Record<ModelProvider, string>> = { openai: 'OPENAI_BASE_URL', anthropic: 'ANTHROPIC_BASE_URL' };
const modelExtraRequestParametersEnv: Partial<Record<ModelProvider, string>> = {};

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
