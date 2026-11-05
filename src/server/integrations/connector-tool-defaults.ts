import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveExternalIntegration, type ExternalIntegrationConfiguration } from './external-integration-vault';

export const connectorDefaultsKey = 'toolDefaultsJson';
const defaultsSchema = z.record(z.string().min(1).max(160), z.record(z.string(), z.unknown()));
export function connectorToolDefaults(configuration: ExternalIntegrationConfiguration) {
  const raw = configuration[connectorDefaultsKey];
  return raw ? defaultsSchema.parse(JSON.parse(raw)) : {};
}
export function connectorDefaultsRevision(configuration: ExternalIntegrationConfiguration) {
  return createHash('sha256').update(configuration[connectorDefaultsKey] || '{}').digest('hex');
}
export async function currentConnectorToolDefaults(id: string, operationId: string) {
  const integration = await resolveExternalIntegration(id);
  if (!integration?.enabled) throw new Error('MCP integration is disabled or no longer exists.');
  const defaults = connectorToolDefaults(integration.configuration);
  return Object.hasOwn(defaults, operationId) ? defaults[operationId] : {};
}
