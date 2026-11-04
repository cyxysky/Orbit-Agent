import { preferenceSettingDefinitions, validateSettingValue } from '@/config/settings-schema';
import { databaseDriver, executeDatabase, parseDatabaseJson, queryDatabaseOne, runDatabaseTransaction } from '@/server/db/database';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import { resolveWorkspaceBrand } from '@/brand/product';

export type SettingsPreferences = Record<string, string>;
const defaults = Object.fromEntries(preferenceSettingDefinitions.map(field => [field.key, field.defaultValue || '']));
const metaKey = (userId: string) => `settings.preferences.${normalizeApplicationUserId(userId)}`;

export async function readSettingsPreferences(userId: string) {
  const row = await queryDatabaseOne<{ value: string }>('SELECT value FROM runtime_meta WHERE key = ?', [metaKey(userId)]);
  return { values: { ...defaults, ...parseDatabaseJson<SettingsPreferences>(row?.value, {}) }, initialized: Boolean(row) };
}

export async function saveSettingsPreferences(userId: string, patch: Record<string, unknown>, initializeOnly = false) {
  const values: SettingsPreferences = {};
  for (const [key, value] of Object.entries(patch)) {
    const definition = preferenceSettingDefinitions.find(field => field.key === key);
    if (!definition) throw new Error(`Unknown preference ${key}.`);
    values[key] = validateSettingValue(definition, value);
  }
  return runDatabaseTransaction(async manager => {
    const key = metaKey(userId);
    const lock = databaseDriver() === 'postgres' ? ' FOR UPDATE' : '';
    const timestamp = new Date().toISOString();
    const inserted = await queryDatabaseOne<{ key: string }>(
      'INSERT INTO runtime_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING RETURNING key',
      [key, JSON.stringify({ ...defaults, ...values }), timestamp], manager);
    const row = await queryDatabaseOne<{ value: string }>(`SELECT value FROM runtime_meta WHERE key = ?${lock}`, [key], manager);
    const saved = { ...defaults, ...parseDatabaseJson<SettingsPreferences>(row?.value, {}) };
    const next = initializeOnly && !inserted ? saved : { ...saved, ...values };
    const brand = resolveWorkspaceBrand({ prefix: next.UI_BRAND_PREFIX, text: next.UI_BRAND_TEXT });
    next.UI_BRAND_PREFIX = brand.brandPrefix;
    next.UI_BRAND_TEXT = brand.brandText;
    await executeDatabase('UPDATE runtime_meta SET value = ?, updated_at = ? WHERE key = ?', [JSON.stringify(next), timestamp, key], manager);
    return { values: next, initialized: true };
  });
}
