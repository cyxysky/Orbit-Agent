import { randomUUID } from 'node:crypto';
import { createCapabilityExecutor } from '../dist/index.js';

// A union of actions remains a flat function signature. The original parser
// below still enforces all action-specific constraints before executing.
function functionParameters(schema) {
  const { $schema, ...result } = structuredClone(schema);
  const variants = result.anyOf || result.oneOf;
  if (variants && !result.type) {
    if (!variants.every(value => value.type === 'object' && !value.$ref)) {
      throw new Error('OpenAI tools require an object input schema.');
    }
    const properties = {};
    for (const variant of variants) for (const [name, value] of Object.entries(variant.properties || {})) {
      if (!properties[name]) properties[name] = value;
      else if (JSON.stringify(properties[name]) !== JSON.stringify(value)) {
        const choices = properties[name].anyOf || [properties[name]];
        if (!choices.some(choice => JSON.stringify(choice) === JSON.stringify(value))) choices.push(value);
        properties[name] = { anyOf: choices };
      }
    }
    delete result.anyOf; delete result.oneOf;
    Object.assign(result, { type: 'object', properties,
      required: (variants[0].required || []).filter(key => variants.every(value => value.required?.includes(key))),
      additionalProperties: false });
  }
  if (result.type !== 'object') throw new Error('OpenAI tools require an object input schema.');
  result.properties ||= {};
  result.required ||= [];
  result.additionalProperties ??= true;
  return result;
}

/** Keep binary image payloads out of text while preserving artifact metadata. */
function textResult(result) {
  return JSON.stringify(result, (key, value) => {
    if (value && typeof value === 'object' && value.type === 'image' && value.data) {
      const { data, ...metadata } = value; return { ...metadata, imageProvidedSeparately: true };
    }
    return value;
  }) ?? 'null';
}

export function toOpenAIResponsesTools(snapshot, options = {}) {
  const executeCapability = createCapabilityExecutor(options.policy);
  const entries = new Map(Object.entries(snapshot.tools));
  const tools = [...entries].map(([name, resolved]) => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error(`Invalid OpenAI function name: ${name}`);
    return { type: 'function', name, description: resolved.tool.description,
      parameters: functionParameters(resolved.tool.input.jsonSchema), strict: false };
  });
  const instructions = snapshot.skillCatalog?.instructions('eager')
    || snapshot.skills.map(skill => `${skill.title}\n${skill.content}`).join('\n\n');
  async function invoke(name, input, execution = {}) {
    const resolved = entries.get(name);
    if (!resolved) throw new Error(`Unknown capability tool: ${name}`);
    const signals = [snapshot.abortSignal, options.abortSignal, execution.abortSignal].filter(Boolean);
    const context = { invocationId: execution.invocationId || randomUUID(),
      abortSignal: signals.length ? AbortSignal.any(signals) : undefined,
      metadata: { ...options.metadata, ...execution.metadata } };
    const parsed = resolved.tool.input.parse(input);
    const result = await executeCapability(resolved, context, context => {
      const invoke = () => resolved.tool.execute(parsed, context);
      return options.execute ? options.execute({ resolvedTool: resolved, input: parsed, context, invoke }) : invoke();
    });
    options.responseSession?.observe(name, result);
    return result;
  }
  async function images(result) {
    return Promise.all((result?.content || []).filter(item => item.type === 'image').map(async item => {
      const resolved = item.data ? { data: item.data, mimeType: item.mediaType || 'image/png' }
        : await options.resolveImage?.(item);
      if (!resolved) throw new Error('Image tool output requires resolveImage for artifacts without inline data.');
      return `data:${resolved.mimeType};base64,${resolved.data}`;
    }));
  }
  async function executeCall(call, execution = {}) {
    if (call.type !== 'function_call' || typeof call.call_id !== 'string' || !call.call_id) {
      throw new Error('Expected a Responses function_call with call_id.');
    }
    // Errors propagate to the host. It decides whether to expose them to a model.
    const result = await invoke(call.name, JSON.parse(call.arguments), { ...execution, invocationId: call.call_id });
    const outputImages = await images(result);
    return { type: 'function_call_output', call_id: call.call_id,
      output: outputImages.length ? [{ type: 'input_text', text: textResult(result) },
        ...outputImages.map(image_url => ({ type: 'input_image', image_url, detail: 'auto' }))] : textResult(result) };
  }
  return { tools, instructions, invoke, executeCall, images };
}

/** Pass the official @openai/agents tool factory; no SDK dependency or MCP hop. */
export function toOpenAIAgentsTools(snapshot, tool, options = {}) {
  const adapter = toOpenAIResponsesTools(snapshot, options);
  return adapter.tools.map(({ type, ...definition }) => tool({ ...definition,
    // Agents SDK's non-strict schema type requires this flag. The capability
    // parser remains authoritative and rejects unknown/action-invalid fields.
    parameters: { ...definition.parameters, additionalProperties: true },
    execute: async (input, _runContext, details) => {
      const result = await adapter.invoke(definition.name, input, {
        invocationId: details?.toolCall?.callId,
        abortSignal: details?.signal,
      });
      if (options.formatResult) return options.formatResult(result);
      const images = await adapter.images(result);
      return images.length ? [{ type: 'text', text: textResult(result) },
        ...images.map(image => ({ type: 'image', image }))] : result;
    },
  }));
}
