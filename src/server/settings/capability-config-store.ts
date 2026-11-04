import { capabilityConfigurationFromEnvironment as configurationFromValues, createCapabilityConfigStore } from '@cjfclonedeep/capability-sdk/host';
import { runtimeConfiguration } from './runtime-configuration';

/** A capability receives only the settings declared by its own manifest. */
export const runtimeCapabilityConfigStore = createCapabilityConfigStore({
  async load(manifest) {
    return configurationFromValues(manifest, runtimeConfiguration());
  },
  async save(manifest, values) {
    const { store } = await import('@/server/db/store');
    await store.saveRuntimeSettings((manifest.configuration?.settings || [])
      .filter(setting => Object.hasOwn(values, setting.key))
      .map(setting => ({
        key: setting.key,
        value: values[setting.key] ?? setting.defaultValue,
        enabled: true,
        secret: Boolean(setting.secret),
      })));
    await store.refreshRuntimeSettings();
  },
  async delete(manifest) {
    const { store } = await import('@/server/db/store');
    await store.saveRuntimeSettings((manifest.configuration?.settings || [])
      .map(setting => ({
        key: setting.key,
        value: setting.defaultValue,
        enabled: true,
        secret: Boolean(setting.secret),
      })));
    await store.refreshRuntimeSettings();
  },
});
