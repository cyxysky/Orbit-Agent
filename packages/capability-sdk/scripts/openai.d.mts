import type { CapabilityRunSnapshot, CapabilityExecutionContext, CapabilityExecutionPolicyOptions, CapabilityContent, ResolvedCapabilityTool, ResponseSession } from '../dist/index.js';
export type OpenAIAdapterOptions = {
  policy?: CapabilityExecutionPolicyOptions;
  abortSignal?: AbortSignal;
  metadata?: Readonly<Record<string, unknown>>;
  responseSession?: ResponseSession;
  resolveImage?: (content: Extract<CapabilityContent, { type: 'image' }>) => Promise<{ data: string; mimeType: string }>;
  execute?: (invocation: { resolvedTool: ResolvedCapabilityTool; input: unknown; context: CapabilityExecutionContext; invoke(): Promise<unknown> }) => Promise<unknown>;
};
export type OpenAIFunctionDefinition = { type: 'function'; name: string; description: string; strict: false; parameters: { type: 'object'; properties: Record<string, unknown>; additionalProperties: boolean; required: string[]; [key: string]: unknown } };
export type ResponsesFunctionCall = { type: 'function_call'; name: string; call_id: string; arguments: string };
export type ResponsesFunctionOutput = { type: 'function_call_output'; call_id: string; output: string | Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'auto' }> };
export declare function toOpenAIResponsesTools(snapshot: CapabilityRunSnapshot, options?: OpenAIAdapterOptions): {
  tools: OpenAIFunctionDefinition[];
  instructions: string;
  invoke(name: string, input: unknown, execution?: Partial<CapabilityExecutionContext>): Promise<unknown>;
  executeCall(call: ResponsesFunctionCall, execution?: Partial<CapabilityExecutionContext>): Promise<ResponsesFunctionOutput>;
  images(result: unknown): Promise<string[]>;
};
export type AgentsToolDefinition = Omit<OpenAIFunctionDefinition, 'type' | 'parameters'> & {
  parameters: { type: 'object'; properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: true };
  execute(input: unknown, context?: unknown, details?: { toolCall?: { callId: string }; signal?: AbortSignal }): Promise<unknown>;
};
export declare function toOpenAIAgentsTools<TTool>(snapshot: CapabilityRunSnapshot, tool: (definition: AgentsToolDefinition) => TTool, options?: OpenAIAdapterOptions & { formatResult?: (result: unknown) => unknown | Promise<unknown> }): TTool[];
