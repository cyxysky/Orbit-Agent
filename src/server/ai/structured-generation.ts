import { APICallError, NoObjectGeneratedError, NoOutputGeneratedError, Output, generateText, type ModelMessage } from 'ai';
import { z } from 'zod';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';

type GenerationOptions = Pick<Parameters<typeof generateText>[0], 'model' | 'temperature' | 'telemetry' | 'abortSignal' | 'maxOutputTokens'>;

function schemaFeedback(schema: z.ZodType, text: string | undefined) {
  if (!text) return 'Return a complete JSON object, with no prose or Markdown fences.';
  try {
    const result = schema.safeParse(JSON.parse(text));
    if (!result.success) return result.error.issues.slice(0, 8).map(issue => `${issue.path.join('.') || 'root'}: ${issue.message.slice(0, 500)}`).join('\n');
  } catch { return 'The previous response was not valid JSON. Correct its syntax and return the complete object.'; }
  return 'Return the requested JSON object as the final output.';
}

function unsupportedResponseFormat(error: unknown) {
  return APICallError.isInstance(error) && [400, 422].includes(error.statusCode || 0)
    && /response.?format|json.?schema|structured.?output/i.test(error.message)
    && /unsupported|not supported|not allowed|unknown|unrecognized|invalid parameter|invalid schema/i.test(error.message);
}

/** One corrective attempt, shared deadline, and strict validation on every path. */
export async function generateStructuredOutput<T>({ schema, system, prompt, ...options }: GenerationOptions & {
  schema: z.ZodType<T>; system: string; prompt: string;
}): Promise<{ data: T; rawText: string }> {
  const messages: ModelMessage[] = [{ role: 'user', content: prompt }];
  const instructions = [system,
    'Return one JSON instance matching the schema below. The schema describes the result; it is not the result.',
    'Do not copy schema metadata such as $schema, properties or additionalProperties into the result. Include only fields defined for the instance.',
    'Return complete JSON without explanations or Markdown fences.',
    JSON.stringify(z.toJSONSchema(schema)),
  ].join('\n');
  let structured = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    options.abortSignal?.throwIfAborted();
    try {
      const response = await generateText({ ...options, maxRetries: 1, system: instructions, messages,
        ...(structured ? { output: Output.object({ schema }) } : {}) });
      if (response.finishReason === 'length') {
        throw new NoObjectGeneratedError({ message: 'Structured response was truncated.', text: response.text,
          response: response.response, usage: response.usage, finishReason: response.finishReason });
      }
      const data = structured ? schema.parse(response.output) : schema.parse(JSON.parse(response.text));
      return { data, rawText: response.text };
    } catch (error) {
      options.abortSignal?.throwIfAborted();
      const unsupported = unsupportedResponseFormat(error);
      const invalid = NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)
        || error instanceof SyntaxError || error instanceof z.ZodError;
      if (!unsupported && !invalid) throw error;
      const finishReason = NoObjectGeneratedError.isInstance(error) ? error.finishReason : undefined;
      if (attempt === 1 || finishReason === 'content-filter') {
        // Never put rejected model text or provider request credentials in logs.
        throw new CodedError(ERROR_CODES.VALIDATION_FAILED,
          `Structured model output failed validation after ${attempt + 1} attempt(s)${finishReason ? ` (finishReason=${finishReason})` : ''}. No result was accepted.`);
      }
      if (unsupported) structured = false;
      const text = NoObjectGeneratedError.isInstance(error) ? error.text : undefined;
      if (text) messages.push({ role: 'assistant', content: text.slice(0, 24_000) });
      messages.push({ role: 'user', content: [
        'The previous output was rejected. Return a corrected instance of the same schema using the original evidence.',
        'Preserve valid claims and exact evidence; do not invent facts to satisfy validation.',
        finishReason === 'length' ? 'The response was truncated. Use concise field values and complete the JSON.' : schemaFeedback(schema, text),
      ].join('\n') });
    }
  }
  throw new CodedError(ERROR_CODES.VALIDATION_FAILED, 'No structured result was accepted.');
}
