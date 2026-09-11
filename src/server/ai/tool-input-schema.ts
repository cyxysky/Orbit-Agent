import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';

export function normalizeToolInputSchemas(options: LanguageModelV4CallOptions): LanguageModelV4CallOptions {
  if (!options.tools?.length) return options;
  return {
    ...options,
    tools: options.tools.map((tool) => {
      if (tool.type !== 'function') return tool;
      const schema = tool.inputSchema;
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)
        || (schema.type !== undefined && schema.type !== 'object')) {
        const error = new Error(`Invalid schema for function '${tool.name}': tool input schema must have an object root.`);
        error.name = 'AI_InvalidToolInputSchemaError';
        throw error;
      }
      if (schema.type === 'object') return tool;
      // Tool arguments are objects. Zod unions can omit the root type even
      // when every branch is an object; retain all branch constraints.
      return { ...tool, inputSchema: { ...schema, type: 'object' as const } };
    }),
  };
}
