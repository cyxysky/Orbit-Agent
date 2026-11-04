import { z } from 'zod';
import { configurationCapabilityManifest, configurationRequestSchema } from '@/config/configuration-capability';
import { manageConfiguration } from '@/server/settings/configuration-service';
import { createCapabilityRuntime, defineCapabilityInput, defineCapabilityTool, toCodedError, type CapabilityProvider } from '@cjfclonedeep/capability-sdk';

export function createConfigurationCapability(): CapabilityProvider {
  return {
    manifest: configurationCapabilityManifest,
    async createRuntime(context) {
      return createCapabilityRuntime({ tools: {
        configuration: defineCapabilityTool({
          name: 'configuration', description: configurationCapabilityManifest.description || '',
          input: defineCapabilityInput(z.toJSONSchema(configurationRequestSchema, { io: 'input' }), value => configurationRequestSchema.parse(value)),
          policy: { concurrency: 'serial', concurrencyGroup: 'configuration-store' },
          async execute(input) {
            try {
              const data = await manageConfiguration(input, { userId: context.userId || '', model: true });
              return { ok: true, summary: 'Configuration request completed.', data };
            } catch (error) {
              const coded = toCodedError(error);
              return { ok: false, error: { code: coded.code, message: coded.message } };
            }
          },
        }),
      } });
    },
  };
}
