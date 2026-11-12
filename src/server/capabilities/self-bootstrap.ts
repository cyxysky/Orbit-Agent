import { z } from 'zod';
import { createCapabilityRuntime, defineCapabilityInput, defineCapabilityTool, toCodedError, type CapabilityProvider } from '@cjfclonedeep/capability-sdk';
import { extensionRequestSchema } from '@cjfclonedeep/capability-sdk/extensions';
import { configurationRequestSchema } from '@/config/settings-schema';
import { configurationCapabilityManifest } from '@/config/configuration-capability';
import { manageConfiguration } from '@/server/settings/configuration-service';
import { orbitExtensions } from './extensions';
import { managedToolManagementSchema } from '@/config/managed-tool-management';
import { manageTools } from './tool-management';

const requestSchema = z.discriminatedUnion('domain', [
  z.object({ domain: z.literal('configuration'), request: configurationRequestSchema }).strict(),
  z.object({ domain: z.literal('extensions'), request: extensionRequestSchema }).strict(),
  z.object({ domain: z.literal('tools'), request: managedToolManagementSchema }).strict(),
]);

export function createSelfBootstrapCapability(): CapabilityProvider {
  return {
    manifest: configurationCapabilityManifest,
    async createRuntime(context) {
      const extensions = await orbitExtensions.capability().createRuntime(context);
      return createCapabilityRuntime({ dispose: () => extensions.dispose?.(), tools: {
        selfBootstrap: defineCapabilityTool({
          name: 'selfBootstrap', description: configurationCapabilityManifest.description || '',
          input: defineCapabilityInput(z.toJSONSchema(requestSchema, { io: 'input' }), raw => requestSchema.parse(raw)),
          policy: { concurrency: 'serial', concurrencyGroup: 'self-bootstrap' },
          async execute(input, execution) {
            try {
              if (input.domain === 'extensions') return await extensions.tools.selfBootstrap.execute(input.request, execution);
              if (input.domain === 'tools') return { ok: true, summary: 'Tool management request completed.', data: await manageTools(input.request, { userId: context.userId || '', model: true, signal: execution.abortSignal, reportProgress: execution.reportProgress }) };
              return { ok: true, summary: 'Configuration request completed.', data: await manageConfiguration(input.request, { userId: context.userId || '', model: true }) };
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
