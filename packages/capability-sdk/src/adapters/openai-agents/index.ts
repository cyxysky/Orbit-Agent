import { tool, type FunctionTool, type ToolInputParameters } from '@openai/agents-core';
import { asSchema, type ToolSet } from 'ai';
import { CodedError, ERROR_CODES } from '../../errors.ts';

export type AgentsToolInvocation = {
  name: string;
  input: unknown;
  callId: string;
  signal?: AbortSignal;
  validate(): Promise<void>;
  invoke(): Promise<unknown>;
};
type AgentsParameters = Extract<ToolInputParameters, { type: 'object'; additionalProperties: true }>;

/** Adapt existing CAP/AI SDK tool definitions without duplicating their execution policy. */
export async function adaptAISDKToolsForAgents(definitions: ToolSet, options: {
  signal?: AbortSignal;
  needsApproval?: boolean;
  execute?: (invocation: AgentsToolInvocation) => Promise<unknown>;
} = {}): Promise<Array<FunctionTool<unknown, AgentsParameters, unknown>>> {
  return Promise.all(Object.entries(definitions).map(async ([name, definition]) => {
    const schema = asSchema(definition.inputSchema);
    // AI SDK can attach non-enumerable Standard Schema adapters to this object.
    // Pass pure JSON so Agents does not mistake JSON Schema for a strict Standard Schema.
    const parameters = JSON.parse(JSON.stringify(await schema.jsonSchema)) as Awaited<typeof schema.jsonSchema>;
    if (parameters.type !== 'object') throw new CodedError(ERROR_CODES.VALIDATION_FAILED, `Tool ${name} requires an object input schema.`);
    return tool<AgentsParameters, unknown, unknown>({
      name,
      description: typeof definition.description === 'function'
        ? definition.description({ context: undefined }) : definition.description || '',
      // The SDK's non-strict TS type is narrower than JSON Schema. Keep the exact schema;
      // authoritative validation, including additionalProperties, still runs in CAP below.
      parameters: parameters as unknown as AgentsParameters,
      strict: false,
      needsApproval: options.needsApproval,
      errorFunction: null,
      async execute(input: unknown, _context: unknown, details?: { toolCall?: { callId: string }; signal?: AbortSignal }) {
        const callId = details?.toolCall?.callId;
        if (!callId) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, 'A tool invocation requires its runtime call ID.');
        const signals = [options.signal, details?.signal].filter((value): value is AbortSignal => Boolean(value));
        const signal = signals.length ? AbortSignal.any(signals) : undefined;
        signal?.throwIfAborted();
        let validatedInput = input;
        let validated = false;
        const validate = async () => {
          if (validated) return;
          const parsed = await schema.validate?.(input);
          if (parsed && !parsed.success) throw parsed.error;
          validatedInput = parsed?.success ? parsed.value : input;
          validated = true;
        };
        const invoke = async () => {
          await validate();
          if (!definition.execute) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, `Tool ${name} has no executor.`);
          return definition.execute(validatedInput, {
            toolCallId: callId, messages: [], abortSignal: signal, context: undefined,
          });
        };
        return options.execute ? options.execute({ name, input, callId, signal, validate, invoke }) : invoke();
      },
    });
  }));
}
