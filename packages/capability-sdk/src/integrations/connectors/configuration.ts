import { z } from 'zod';

/** Optional metadata contract, carried by an ordinary MCP tool's _meta. */
export const mcpConfigurationMetaKey = 'com.webpilot/configuration';
export type ConnectorConfigurationDescriptor = {
  id: string; title: string; description?: string; schema: Record<string, unknown>; writable: boolean;
};
export type ConnectorConfigurationState = {
  values: Record<string, unknown>; configuredSecrets: string[]; revision: string;
};
export type ConnectorConfigurationPatch = {
  values: Record<string, unknown>; clearKeys: string[]; expectedRevision: string;
};
export type ConnectorSettingField = {
  key: string; label: string; description?: string; required: boolean; secret: boolean;
  control: 'boolean' | 'number' | 'select' | 'text' | 'secret' | 'textarea' | 'json';
  type?: string; options?: { label: string; value: string }[]; min?: number; max?: number; step?: number;
};
export const connectorConfigurationStateSchema = z.object({
  values: z.record(z.string(), z.unknown()), configuredSecrets: z.array(z.string()).max(64),
  revision: z.string().min(1).max(256),
}).strict();
export const connectorConfigurationPatchSchema = z.object({
  values: z.record(z.string().min(1).max(160), z.unknown()),
  clearKeys: z.array(z.string().min(1).max(160)).max(64).default([]),
  expectedRevision: z.string().min(1).max(256),
}).strict();

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function safeKey(key: string) { return key.length > 0 && key.length <= 160 && !['__proto__', 'prototype', 'constructor'].includes(key); }
export function connectorConfigurationProperties(schema: Record<string, unknown>) {
  if (schema.type !== 'object' || !record(schema.properties)) throw new Error('Configuration requires an object schema with declared properties.');
  const properties = schema.properties as Record<string, unknown>;
  if (Object.keys(properties).length > 64 || Object.keys(properties).some(key => !safeKey(key))) throw new Error('Configuration supports at most 64 safe property names.');
  if (JSON.stringify(schema).length > 64_000) throw new Error('Configuration schema exceeds 64,000 characters.');
  return properties;
}
function secretSchema(schema: Record<string, unknown>) { return schema.writeOnly === true || schema.format === 'password'; }
function containsSecret(schema: Record<string, unknown>, depth = 0): boolean {
  if (depth > 8) return true;
  if (secretSchema(schema) || typeof schema.$ref === 'string') return true;
  return Object.values(record(schema.properties) || {}).some(child => containsSecret(record(child) || {}, depth + 1))
    || Boolean(record(schema.items) && containsSecret(record(schema.items)!, depth + 1))
    || ['oneOf', 'anyOf', 'allOf', 'prefixItems'].some(key => Array.isArray(schema[key])
      && (schema[key] as unknown[]).some(child => containsSecret(record(child) || {}, depth + 1)))
    || ['additionalProperties', 'if', 'then', 'else'].some(key => record(schema[key]) && containsSecret(record(schema[key])!, depth + 1));
}

/** Structured values containing secrets are treated as a single write-only field. */
export function connectorSettingFields(schema: Record<string, unknown>): ConnectorSettingField[] {
  return Object.entries(connectorConfigurationProperties(schema)).map(([key, raw]) => {
    const property = record(raw) || {};
    const type = typeof property.type === 'string' ? property.type : undefined;
    const secret = containsSecret(property);
    const choices = Array.isArray(property.enum) && property.enum.length <= 200 ? property.enum : undefined;
    const primitiveChoices = choices?.every(value => value === null || ['string', 'boolean', 'number'].includes(typeof value));
    return { key, type, secret, required: Array.isArray(schema.required) && schema.required.includes(key),
      label: typeof property.title === 'string' ? property.title.slice(0, 160) : key,
      description: typeof property.description === 'string' ? property.description.slice(0, 2000) : undefined,
      control: secret ? 'secret' : primitiveChoices ? 'select' : type === 'boolean' ? 'boolean'
        : type === 'number' || type === 'integer' ? 'number' : type === 'string' ? property.format === 'multiline' ? 'textarea' : 'text' : 'json',
      options: primitiveChoices ? choices!.map(value => ({ label: String(value), value: JSON.stringify(value) })) : undefined,
      min: typeof property.minimum === 'number' && Number.isFinite(property.minimum) ? property.minimum : undefined,
      max: typeof property.maximum === 'number' && Number.isFinite(property.maximum) ? property.maximum : undefined,
      step: type === 'integer' ? 1 : undefined };
  });
}
export function publicConnectorConfiguration(schema: Record<string, unknown>, state: ConnectorConfigurationState): ConnectorConfigurationState {
  const fields = connectorSettingFields(schema);
  return { revision: state.revision,
    values: Object.fromEntries(fields.filter(field => !field.secret && Object.hasOwn(state.values, field.key)).map(field => [field.key, state.values[field.key]])),
    configuredSecrets: fields.filter(field => field.secret && (Object.hasOwn(state.values, field.key) || state.configuredSecrets.includes(field.key))).map(field => field.key) };
}
function validateJson(value: unknown, depth = 0) {
  if (depth > 8) throw new Error('Configuration JSON exceeds eight levels.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new Error('Configuration array is too large.');
    value.forEach(child => validateJson(child, depth + 1)); return;
  }
  const object = record(value);
  if (!object || Object.keys(object).length > 64 || Object.keys(object).some(key => !safeKey(key))) throw new Error('Invalid configuration JSON object.');
  Object.values(object).forEach(child => validateJson(child, depth + 1));
}
/** Bounded structural validation; full tool-specific validation stays with the MCP server. */
export function validateConnectorValues(schema: Record<string, unknown>, values: Record<string, unknown>, partial = true) {
  const properties = connectorConfigurationProperties(schema);
  validateJson(values);
  if (JSON.stringify(values).length > 20_000) throw new Error('Configuration values exceed 20,000 characters.');
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(properties, key)) throw new Error(`Unknown configuration field: ${key}`);
    const property = record(properties[key]) || {}, type = property.type;
    if (typeof type === 'string' && !(type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
      : type === 'object' ? !!record(value) : type === 'integer' ? Number.isInteger(value) : typeof value === type)) throw new Error(`Invalid value type for ${key}.`);
    if (Array.isArray(property.enum) && !property.enum.some(choice => JSON.stringify(choice) === JSON.stringify(value))) throw new Error(`Invalid option for ${key}.`);
    if (typeof value === 'number' && (typeof property.minimum === 'number' && value < property.minimum || typeof property.maximum === 'number' && value > property.maximum)) throw new Error(`Value outside the allowed range for ${key}.`);
    if (typeof value === 'string' && (typeof property.minLength === 'number' && value.length < property.minLength || typeof property.maxLength === 'number' && value.length > property.maxLength)) throw new Error(`Invalid text length for ${key}.`);
  }
  if (!partial && Array.isArray(schema.required)) for (const key of schema.required) {
    if (typeof key === 'string' && !Object.hasOwn(values, key)) throw new Error(`Required configuration field: ${key}`);
  }
}
export function mergeConnectorConfiguration(schema: Record<string, unknown>, current: Record<string, unknown>, patch: ConnectorConfigurationPatch, partial = false) {
  const properties = connectorConfigurationProperties(schema);
  if (patch.clearKeys.some(key => !Object.hasOwn(properties, key))) throw new Error('Cannot clear an unknown configuration field.');
  validateConnectorValues(schema, patch.values);
  const next = { ...current, ...patch.values };
  for (const key of patch.clearKeys) delete next[key];
  validateConnectorValues(schema, next, partial);
  return next;
}
export function parseMcpConfigurationDescriptor(id: string, meta: unknown): ConnectorConfigurationDescriptor | undefined {
  const definition = record(record(meta)?.[mcpConfigurationMetaKey]);
  if (!definition) return undefined;
  if (definition.version !== 1 || !record(definition.schema)) throw new Error('Unsupported MCP configuration metadata version or schema.');
  connectorConfigurationProperties(definition.schema as Record<string, unknown>);
  return { id, title: typeof definition.title === 'string' ? definition.title.slice(0, 160) : id,
    description: typeof definition.description === 'string' ? definition.description.slice(0, 2000) : undefined,
    schema: definition.schema as Record<string, unknown>, writable: definition.writable === true };
}
