import { normalizeRuntimeSettingValue, modelProviderDefinitionsForConfig } from '@/config/settings';
import { settingsForms } from '@/config/settings-forms';
import { integrationDriverForm } from '@/config/integration-settings';
import { configurationRequestSchema, preferenceSettingDefinitions, validateSettingValue } from '@/config/settings-schema';
import { store } from '@/server/db/store';
import { runtimeSetting } from './runtime-configuration';
import { selfBootstrapEnabled } from '@/server/runtime/self-bootstrap-policy';
import { ApiRequestError } from '@/server/http/api-request';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { configurationDefinitions, registerConfigurationFields } from './settings-registry';
import { readModelSettingsState, readRuntimeSettingsItems } from './settings-snapshot';
import { readSettingsPreferences, saveSettingsPreferences } from './preferences';
import { saveModelSettings } from './model-settings';
import { saveIntegrationSettings } from './integration-settings';
import { listExternalIntegrations } from '@/server/integrations/external-integration-vault';
import { listExternalIntegrationDrivers, publicExternalIntegrationSummary } from '@/server/integrations/external-integration-drivers';

export { configurationRequestSchema };

export async function saveRuntimeConfiguration(values: Record<string, unknown>) {
  const definitions = new Map(configurationDefinitions().map(field => [field.key, field]));
  const saved = new Map((await store.listRuntimeSettings()).map(item => [item.key, item]));
  const patch = Object.entries(values).map(([key, raw]) => {
    const field = definitions.get(key);
    if (!field) throw new Error(`Unknown registered setting ${key}.`);
    const secret = Boolean(field.secret || field.control === 'secret' || saved.get(key)?.secret);
    if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`Invalid setting value for ${key}.`);
    const normalized = normalizeRuntimeSettingValue(field, validateSettingValue(field, raw));
    const value = secret && raw === '' ? saved.get(key)?.value ?? runtimeSetting(key) ?? field.defaultValue : validateSettingValue(field, normalized);
    return { key, value, secret, enabled: true };
  });
  await store.saveRuntimeSettings(patch);
  return readRuntimeSettingsItems();
}

export async function configurationCatalog() {
  return {
    definitions: configurationDefinitions(),
    forms: [...settingsForms, ...listExternalIntegrationDrivers().map(integrationDriverForm)],
    preferences: preferenceSettingDefinitions,
    modelProviders: modelProviderDefinitionsForConfig((await store.getModelConfig())?.providers),
    integrationDrivers: listExternalIntegrationDrivers(),
    permissions: { selfBootstrapEnabled: selfBootstrapEnabled() },
  };
}

export async function manageConfiguration(raw: unknown, caller: { userId: string; model: boolean }) {
  const request = configurationRequestSchema.parse(raw);
  const publicQuery = request.action === 'query' && (request.domain === 'catalog' || request.domain === 'preferences');
  const ownPreferences = request.action !== 'register' && request.domain === 'preferences';
  if (!publicQuery && !ownPreferences && !isAiOperationsAdmin(caller.userId)) throw new ApiRequestError('Administrator identity is required for global settings.', { status: 403, code: ERROR_CODES.FORBIDDEN });
  if (request.action !== 'query' && (caller.model || request.action === 'register') && !selfBootstrapEnabled()) {
    throw new ApiRequestError('Configuration self-bootstrap requires ORBIT_SELF_BOOTSTRAP_ENABLED=true in the deployment environment.', { status: 403, code: ERROR_CODES.FORBIDDEN });
  }
  await store.refreshRuntimeSettings();
  if (request.action === 'register') {
    await registerConfigurationFields(request.registration);
    await store.refreshRuntimeSettings();
    return configurationCatalog();
  }
  if (request.action === 'set') {
    if (request.domain === 'runtime') return { saved: await saveRuntimeConfiguration(request.values) };
    if (request.domain === 'preferences') return saveSettingsPreferences(caller.userId, request.values);
    if (request.domain === 'model') { await saveModelSettings(request.values); return readModelSettingsState(); }
    return { item: publicExternalIntegrationSummary(await saveIntegrationSettings(request.values, caller.userId)) };
  }
  if (request.domain === 'catalog') {
    const catalog = await configurationCatalog();
    const fields = catalog.definitions.filter(field => (!request.keys || request.keys.includes(field.key)) && (!request.prefix || field.key.startsWith(request.prefix)));
    return { ...catalog, definitions: fields.slice(request.offset, request.offset + request.limit), total: fields.length, nextOffset: request.offset + request.limit < fields.length ? request.offset + request.limit : undefined };
  }
  if (request.domain === 'preferences') return readSettingsPreferences(caller.userId);
  if (request.domain === 'model') return readModelSettingsState();
  if (request.domain === 'integration') return { items: (await listExternalIntegrations()).map(publicExternalIntegrationSummary) };
  const items = (await readRuntimeSettingsItems()).filter(item => (!request.keys || request.keys.includes(item.key)) && (!request.prefix || item.key.startsWith(request.prefix)));
  return { saved: items.slice(request.offset, request.offset + request.limit), total: items.length, nextOffset: request.offset + request.limit < items.length ? request.offset + request.limit : undefined };
}
