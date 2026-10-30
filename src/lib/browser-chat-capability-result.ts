function resultObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Decode Orbit's BrowserActionResult envelope at the host boundary. */
export function browserChatCapabilityResult(value: unknown): unknown {
  const outer = resultObject(value);
  if (outer?.ok !== true) return undefined;
  return Array.isArray(outer.content) ? outer : resultObject(outer.actual);
}
