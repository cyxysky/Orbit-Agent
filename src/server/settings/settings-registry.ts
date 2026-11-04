import { runtimeSettingDefinitions, type RuntimeSettingDefinition } from '@/config/settings';
import { registeredSettingSchema, settingsSchemaMetaKey, settingRegistrationSchema, validateSettingValue, type RegisteredSetting } from '@/config/settings-schema';
import { databaseDriver, executeDatabase, parseDatabaseJson, queryDatabaseOne, runDatabaseTransaction } from '@/server/db/database';

type RegistryState = { registered: readonly RegisteredSetting[] };
const root = globalThis as typeof globalThis & { __orbitSettingsRegistry?: RegistryState };
const state = root.__orbitSettingsRegistry ??= { registered: [] };

export function registeredSettings() { return state.registered; }
export function configurationDefinitions(): RuntimeSettingDefinition[] {
  return [...runtimeSettingDefinitions, ...state.registered];
}

export function publishSettingsRegistry(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error('Invalid persisted settings registry.');
  const keys = new Set(runtimeSettingDefinitions.map(field => field.key));
  const definitions = raw.map(value => {
    const { namespace, ...field } = value as RegisteredSetting;
    const parsed = registeredSettingSchema.parse(field);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(namespace) || !parsed.key.startsWith(`PLUGIN_${namespace.toUpperCase()}_`) || keys.has(parsed.key)) throw new Error('Invalid registered settings namespace or duplicate key.');
    keys.add(parsed.key);
    validateSettingValue(parsed, parsed.defaultValue);
    return { ...parsed, secret: parsed.secret || parsed.control === 'secret', namespace };
  });
  state.registered = Object.freeze(definitions);
}

export async function registerConfigurationFields(raw: unknown) {
  const input = settingRegistrationSchema.parse(raw);
  const prefix = `PLUGIN_${input.namespace.toUpperCase()}_`;
  const seen = new Set<string>();
  for (const field of input.fields) {
    if (!field.key.startsWith(prefix) || seen.has(field.key)) throw new Error(`Setting keys must be unique and start with ${prefix}.`);
    seen.add(field.key);
    validateSettingValue(field, field.defaultValue);
  }
  await runDatabaseTransaction(async manager => {
    const timestamp = new Date().toISOString();
    await executeDatabase('INSERT INTO app_config (id, runtime_env_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING', ['[]', timestamp], manager);
    const lock = databaseDriver() === 'postgres' ? ' FOR UPDATE' : '';
    const values = await queryDatabaseOne<{ runtime_env_json: string }>(`SELECT runtime_env_json FROM app_config WHERE id = 1${lock}`, [], manager);
    await executeDatabase('INSERT INTO runtime_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING', [settingsSchemaMetaKey, '[]', timestamp], manager);
    const row = await queryDatabaseOne<{ value: string }>(`SELECT value FROM runtime_meta WHERE key = ?${lock}`, [settingsSchemaMetaKey], manager);
    const fields = new Map(parseDatabaseJson<RegisteredSetting[]>(row?.value, []).map(field => [field.key, field]));
    const saved = new Map(parseDatabaseJson<Array<{ key: string; value: string }>>(values?.runtime_env_json, []).map(item => [item.key, item.value]));
    for (const field of input.fields) {
      const existing = fields.get(field.key);
      if (existing && existing.namespace !== input.namespace) throw new Error('Configuration namespace ownership mismatch.');
      if (existing?.secret && !field.secret && field.control !== 'secret') throw new Error('A secret setting cannot be downgraded to a public setting.');
      if (saved.has(field.key)) validateSettingValue(field, saved.get(field.key));
      fields.set(field.key, { ...field, secret: field.secret || field.control === 'secret', namespace: input.namespace });
    }
    if (fields.size > 2000) throw new Error('The settings registry exceeds 2000 fields.');
    await executeDatabase('UPDATE runtime_meta SET value = ?, updated_at = ? WHERE key = ?', [JSON.stringify([...fields.values()]), timestamp, settingsSchemaMetaKey], manager);
  });
}
