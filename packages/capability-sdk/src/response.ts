import type { CapabilityInputSchema, JsonSchema } from './index.ts';

export type ResponseBlock<T = Record<string, unknown>> = { type: string; params: T };
export type StructuredResponse = { status: 'passed' | 'failed' | 'blocked'; blocks: ResponseBlock[] };
export type ResponseResource = { topic: string; id: string };

/** Pure contracts: safe to import in a browser, with no runtime or React dependency. */
export interface ResponseDefinition<T = Record<string, unknown>> {
  type: string;
  description: string;
  params: CapabilityInputSchema<T>;
  /** Omit for output types that do not require a generation tool. */
  tools?: readonly string[];
  examples?: readonly T[];
  resource?(params: T): ResponseResource;
  toText(params: T): string;
  mapText?(params: T, transform: (text: string) => string): T;
  /** Opt-in projection of incomplete streamed params. Other types publish atomically. */
  partial?(params: unknown): T | undefined;
}

export function defineResponseType<T extends Record<string, unknown>>(definition: ResponseDefinition<T>): ResponseDefinition<T> {
  return Object.freeze(definition);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}

export class ResponseRegistry {
  readonly #definitions = new Map<string, ResponseDefinition>();

  register(definitions: readonly ResponseDefinition[]) {
    for (const definition of definitions) {
      if (!definition.type.trim() || this.#definitions.has(definition.type)) throw new Error(`Duplicate or empty response type: ${definition.type}`);
      for (const example of definition.examples || []) definition.params.parse(example);
      this.#definitions.set(definition.type, definition);
    }
    return this;
  }

  definitions() { return [...this.#definitions.values()]; }
  get(type: string) { return this.#definitions.get(type); }
  /** Assemble a catalog from package manifests without importing their runtimes. */
  registerManifests(manifests: readonly { responses?: readonly ResponseDefinition[] }[]) {
    for (const manifest of manifests) this.register(manifest.responses || []);
    return this;
  }
  forTools(tools: ReadonlySet<string>) {
    return new ResponseRegistry().register(this.definitions().filter(definition => !definition.tools?.length || definition.tools.some(name => tools.has(name))));
  }
  require(type: string) {
    const definition = this.get(type);
    if (!definition) throw new Error(`Unknown response type: ${type}`);
    return definition;
  }

  parse(value: unknown): ResponseBlock {
    const block = object(value);
    if (Object.keys(block).some(key => key !== 'type' && key !== 'params') || typeof block.type !== 'string') throw new Error('Response blocks require only type and params.');
    return { type: block.type, params: this.require(block.type).params.parse(block.params) };
  }

  parseResponse(value: unknown): StructuredResponse {
    const response = object(value);
    if (Object.keys(response).some(key => key !== 'status' && key !== 'blocks')) throw new Error('Unknown response field.');
    const status = response.status;
    if (status !== 'passed' && status !== 'failed' && status !== 'blocked') throw new Error('Invalid response status.');
    if (!Array.isArray(response.blocks) || !response.blocks.length || response.blocks.length > 64) throw new Error('Expected 1 to 64 response blocks.');
    return { status, blocks: response.blocks.map((block, index) => {
      try { return this.parse(block); }
      catch (error) { throw new Error(`blocks.${index}: ${error instanceof Error ? error.message : String(error)}`); }
    }) };
  }

  /** Keep model instructions and examples aligned with the same registered schemas. */
  modelInstructions() {
    return [
      'Every final answer, including prose-only answers and clarification questions, must be submitted through finalResponse. Ordinary assistant text is progress narration, not a completed response.',
      'When a successful tool returns content entries with type="response", finish with finalResponse and include their exact block values. Plain text identifiers do not render registered views.',
      'Registered block types for this run:',
      ...this.definitions().map(definition => {
        const example = definition.examples?.[0];
        const block = example ? this.parse({ type: definition.type, params: example }) : undefined;
        return `${definition.type}: ${definition.description}${block ? ` Example block: ${JSON.stringify(block)}` : ''}`;
      }),
    ].join('\n');
  }

  input(): CapabilityInputSchema<StructuredResponse> {
    const variants = this.definitions().map((definition, index) => ({
      type: 'object', additionalProperties: false, required: ['type', 'params'],
      description: definition.description,
      properties: { type: { type: 'string', const: definition.type }, params: relocateSchema(definition.params.jsonSchema, `#/properties/blocks/items/anyOf/${index}/properties/params`) },
      ...(definition.examples?.length ? { examples: definition.examples.map(params => ({ type: definition.type, params })) } : {}),
    }));
    const jsonSchema: JsonSchema = {
      type: 'object', additionalProperties: false, required: ['status', 'blocks'],
      properties: {
        status: { type: 'string', enum: ['passed', 'failed', 'blocked'] },
        blocks: { type: 'array', minItems: 1, maxItems: 64, items: { anyOf: variants } },
      },
    };
    return { jsonSchema, parse: value => this.parseResponse(value) };
  }

  /** Publish only a contiguous prefix; an incomplete block must not shift later positions. */
  partial(value: unknown): ResponseBlock[] {
    if (!value || typeof value !== 'object' || !Array.isArray((value as { blocks?: unknown }).blocks)) return [];
    const result: ResponseBlock[] = [];
    for (const valueBlock of (value as { blocks: unknown[] }).blocks.slice(0, 64)) {
      try {
        const block = object(valueBlock);
        const definition = this.require(String(block.type || ''));
        const params = definition.partial?.(block.params);
        result.push(params ? this.parse({ type: definition.type, params }) : this.parse(block));
      } catch { break; }
    }
    return result;
  }

  toText(block: ResponseBlock) {
    try { const parsed = this.parse(block); return this.require(parsed.type).toText(parsed.params); }
    catch { return '此内容暂时无法显示。'; }
  }

  mapText(block: ResponseBlock, transform: (text: string) => string): ResponseBlock {
    const parsed = this.parse(block);
    const definition = this.require(parsed.type);
    return definition.mapText ? this.parse({ type: parsed.type, params: definition.mapText(parsed.params, transform) }) : parsed;
  }

  resource(block: ResponseBlock) {
    const parsed = this.parse(block);
    return this.require(parsed.type).resource?.(parsed.params);
  }

  /** Consume only successful standard CapabilityResult content, never prose IDs. */
  toolBlocks(toolName: string, value: unknown): ResponseBlock[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const result = value as { ok?: unknown; content?: unknown };
    if (result.ok !== true || !Array.isArray(result.content)) return [];
    return result.content.flatMap(entry => {
      try {
        const content = object(entry);
        if (content.type !== 'response') return [];
        const block = this.parse(content.block);
        const definition = this.require(block.type);
        if (definition.tools?.length && !definition.tools.includes(toolName)) return [];
        return [block];
      } catch { return []; }
    });
  }

  identity(block: ResponseBlock) {
    try {
      const resource = this.resource(block);
      if (resource) return JSON.stringify(['resource', resource.topic, resource.id]);
    } catch { /* Preserve unavailable historical views by their envelope identity. */ }
    return JSON.stringify(canonical(block));
  }

  /** Explicit positions/repeated views win; latest generated resource fills omissions. */
  missing(explicit: readonly ResponseBlock[], generated: readonly ResponseBlock[]) {
    const represented = new Set(explicit.map(block => this.identity(block)));
    const latest = new Map<string, ResponseBlock>();
    for (const value of generated) {
      const block = this.parse(value);
      const identity = this.identity(block);
      if (!represented.has(identity)) latest.set(identity, block);
    }
    return [...latest.values()];
  }

  assemble(explicit: readonly ResponseBlock[], generated: readonly ResponseBlock[] = []): ResponseBlock[] {
    const validated = explicit.map(block => this.parse(block));
    return [...validated, ...this.missing(validated, generated)];
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, canonical(entry)]));
}

/** One instance per response/turn, shared by all framework tool callbacks. */
export class ResponseSession {
  readonly #generated = new Map<string, ResponseBlock>();
  #explicit: StructuredResponse | undefined;
  constructor(readonly registry: ResponseRegistry) {}

  observe(toolName: string, result: unknown) {
    const blocks = this.registry.toolBlocks(toolName, result);
    for (const block of blocks) this.#generated.set(this.registry.identity(block), block);
    return blocks;
  }

  accept(value: unknown) {
    const response = this.registry.parseResponse(value);
    this.#explicit = response;
    return response;
  }

  get accepted() { return Boolean(this.#explicit); }

  /** Normal completion requires an accepted final tool call; hosts may report interruption/failure. */
  finish(fallback: { status?: StructuredResponse['status']; blocks?: readonly ResponseBlock[] } = {}): StructuredResponse {
    if (!this.#explicit && fallback.status !== 'failed' && fallback.status !== 'blocked') {
      throw new Error('A successful response requires an accepted finalResponse call.');
    }
    return {
      status: this.#explicit?.status ?? fallback.status ?? 'passed',
      blocks: this.registry.assemble(this.#explicit?.blocks ?? fallback.blocks ?? [], [...this.#generated.values()]),
    };
  }
}

function relocateSchema(schema: JsonSchema, root: string): JsonSchema {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema').map(([key, child]) => [key,
      key === '$ref' && typeof child === 'string' && child.startsWith('#') ? root + child.slice(1) : visit(child)]));
  };
  return visit(schema) as JsonSchema;
}

export type ResponseExport = { format: 'markdown'; body: string } | { format: 'image'; artifactId: string };
export type ResponseServerContext = { scopeId: string; userId: string; readOnly: boolean; signal?: AbortSignal };
export class ResponseOperationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export interface ResponseHandler<T = Record<string, unknown>> {
  definition: ResponseDefinition<T>;
  operations: Readonly<Record<string, {
    mutates?: boolean;
    execute(params: T, input: unknown, context: ResponseServerContext): Promise<unknown>;
  }>>;
  export?(params: T, context: ResponseServerContext): Promise<ResponseExport[]>;
}

export class ResponseHandlerRegistry {
  readonly #handlers = new Map<string, ResponseHandler>();
  constructor(readonly definitions: ResponseRegistry) {}
  register(handlers: readonly ResponseHandler[]) {
    for (const handler of handlers) {
      if (this.definitions.require(handler.definition.type) !== handler.definition) throw new Error(`Mismatched response definition: ${handler.definition.type}`);
      if (this.#handlers.has(handler.definition.type)) throw new Error(`Duplicate response handler: ${handler.definition.type}`);
      this.#handlers.set(handler.definition.type, handler);
    }
    return this;
  }
  assertComplete() {
    for (const definition of this.definitions.definitions()) {
      if (definition.resource && !this.#handlers.has(definition.type)) throw new Error(`Missing response resource handler: ${definition.type}`);
    }
    return this;
  }
  async execute(block: ResponseBlock, operation: string, input: unknown, context: ResponseServerContext) {
    const parsed = this.definitions.parse(block);
    const operations = this.#handlers.get(parsed.type)?.operations;
    const handler = operations && Object.hasOwn(operations, operation) ? operations[operation] : undefined;
    if (!handler) throw new ResponseOperationError('Unsupported response operation.', 404);
    if (handler.mutates && context.readOnly) throw new ResponseOperationError('This response is read-only.', 403);
    context.signal?.throwIfAborted();
    return handler.execute(parsed.params, input, context);
  }
  async export(block: ResponseBlock, context: ResponseServerContext): Promise<ResponseExport[]> {
    const parsed = this.definitions.parse(block);
    const handler = this.#handlers.get(parsed.type);
    return handler?.export ? handler.export(parsed.params, context) : [{ format: 'markdown', body: this.definitions.toText(parsed) }];
  }
}
