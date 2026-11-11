import { runtimeSetting } from '@/server/settings/runtime-configuration';
import {
  defaultModelForProvider,
  defaultModelProviderSettings,
  modelListForProvider,
  modelProviderDefinitionsForConfig,
  migrateRuntimeSettingValue,
} from '@/config/settings';
import type { ModelProvider, ModelProviderSettings } from '@/server/ai/schemas/runtime.schema';
import { normalizedModelCapabilities } from '@/lib/model-capabilities';
import { store } from '@/server/db/store';
import { maskSecret } from '@/lib/secret-input';
import { configurationDefinitions } from './settings-registry';

function completeProviders(input?: Partial<Record<ModelProvider, ModelProviderSettings>>) {
  const result: Partial<Record<ModelProvider, ModelProviderSettings>> = {};
  for (const definition of modelProviderDefinitionsForConfig(input)) {
    const current = input?.[definition.value];
    const models = modelListForProvider(definition, current);
    const model = defaultModelForProvider(definition, current);
    result[definition.value] = {
      ...defaultModelProviderSettings(definition.value),
      ...current,
      enabled: current?.enabled === true,
      defaultModel: model,
      model,
      models,
      modelCapabilities: normalizedModelCapabilities(definition.value, models, current?.modelCapabilities),
    };
  }
  return result;
}

export async function readRuntimeSettingsItems() {
  const savedByKey = new Map((await store.listRuntimeSettings()).map((item) => [item.key, item]));
  return configurationDefinitions().map((definition) => {
    const saved = savedByKey.get(definition.key);
    const secret = Boolean(saved?.secret || definition.secret || definition.control === 'secret');
    const value = migrateRuntimeSettingValue(
      definition.key,
      saved?.value ?? runtimeSetting(definition.key) ?? definition.defaultValue,
    );
    return {
      key: definition.key,
      value: secret ? '' : value,
      hasValue: secret ? Boolean(value) : undefined,
      secretPreview: secret ? maskSecret(value) : undefined,
      enabled: true,
      secret,
      updatedAt: saved?.updatedAt,
    };
  });
}

export async function readModelSettingsState() {
  const saved = await store.getModelConfig();
  const providers = completeProviders(saved?.providers);
  for (const provider of Object.keys(providers) as ModelProvider[]) {
    const current = providers[provider];
    if (!current) continue;
    providers[provider] = {
      ...current,
      apiKey: '',
      hasApiKey: Boolean(current.apiKey),
      apiKeyPreview: maskSecret(current.apiKey || ''),
    };
  }
  return {
    saved: Boolean(saved),
    config: {
      provider: saved?.provider || 'openai',
      providers,
      providerOrder: saved?.providerOrder,
      mediaSelections: saved?.mediaSelections,
      updatedAt: saved?.updatedAt || '',
    },
  };
}

export async function readEnvironmentSettingsSnapshot() {
  return {
    runtimeItems: await readRuntimeSettingsItems(),
    modelConfig: (await readModelSettingsState()).config,
    definitions: configurationDefinitions(),
  };
}
