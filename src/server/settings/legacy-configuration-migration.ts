import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { runtimeSettingDefinitions, normalizeRuntimeSettingValue } from '@/config/settings';
import { store } from '@/server/db/store';
import { readRuntimeMeta, writeRuntimeMeta } from '@/server/storage/database-record-store';
import { legacyModelSettings } from './runtime-configuration';

const marker = 'runtime-configuration-file-import-v1';
let pending: Promise<void> | undefined;

/** Preserve existing deployments once. Later .env edits never change business settings. */
export function importLegacyConfigurationOnce() {
  return pending ??= (async () => {
    if (await readRuntimeMeta(marker)) return;
    const text = await readFile(path.join(process.env.WEBPILOT_APP_DIR || process.cwd(), '.env'), 'utf8')
      .catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw error;
      });
    const legacy = parseEnv(text);
    const saved = new Set((await store.listRuntimeSettings()).map(item => item.key));
    const items = runtimeSettingDefinitions.filter(item => !saved.has(item.key) && Object.hasOwn(legacy, item.key))
      .map(item => ({
        key: item.key,
        value: normalizeRuntimeSettingValue(item, legacy[item.key] ?? item.defaultValue),
        enabled: true,
        secret: Boolean(item.secret),
      }));
    if (items.length) await store.saveRuntimeSettings(items);
    if (!(await store.getModelConfig())) {
      const models = legacyModelSettings(legacy);
      if (models) await store.saveModelConfig(models);
    }
    await writeRuntimeMeta(marker, new Date().toISOString());
  })().catch(error => {
    pending = undefined;
    throw error;
  });
}
