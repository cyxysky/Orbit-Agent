type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RecordValue;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RecordValue : {};
  } catch { return {}; }
}
function tokens(value: unknown) {
  const parsed = record(value);
  const number = Number(parsed.total || parsed.totalTokens || value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/** The same projection is used for persisted log metadata and operational metrics. */
export function browserChatLogUsage(value: unknown) {
  const log = record(value);
  if (!['ai:runtime:object', 'ai:runtime:response'].includes(String(log.phase || '').trim())) return;
  const details = record(log.details), payload = record(details.value);
  const output = record(payload.aiOutput || details.aiOutput), response = record(output.response);
  const usage = record(output.usage || response.usage);
  const inputTokens = tokens(usage.inputTokens || usage.promptTokens || usage.input_tokens || usage.prompt_tokens);
  const outputTokens = tokens(usage.outputTokens || usage.completionTokens || usage.output_tokens || usage.completion_tokens);
  const totalTokens = Math.max(inputTokens + outputTokens, tokens(usage.totalTokens || usage.total_tokens));
  return totalTokens ? { inputTokens, outputTokens, totalTokens } : undefined;
}
