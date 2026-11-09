import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveExternalIntegration, type ExternalIntegrationConfiguration } from './external-integration-vault';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';

export const connectorDefaultsKey = 'toolDefaultsJson';
export const connectorDisabledToolsKey = 'disabledToolsJson';
export function connectorDisabledTools(configuration: ExternalIntegrationConfiguration): Set<string> {
  return new Set(z.array(z.string().min(1).max(160)).max(1000).parse(JSON.parse(configuration[connectorDisabledToolsKey] || '[]')));
}
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
  if (!integration?.enabled) throw new CodedError(ERROR_CODES.FORBIDDEN, 'MCP integration is disabled or no longer exists.');
  if (connectorDisabledTools(integration.configuration).has(operationId)) throw new CodedError(ERROR_CODES.FORBIDDEN, 'This MCP tool has been disabled by the administrator.');
  const defaults = connectorToolDefaults(integration.configuration);
  return Object.hasOwn(defaults, operationId) ? defaults[operationId] : {};
}
