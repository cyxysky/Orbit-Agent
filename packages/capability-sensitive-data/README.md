# @webpilot/capability-sensitive-data

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Sensitive-data filtering at the final model-provider boundary. This package is middleware, **not a CapabilityProvider or an MCP tool**. It does not mount through host. SDK is an internal dependency; you need neither host nor a Capability adapter for its portable client.
## 1. Install and start a redaction service

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-sensitive-data
npm install -D tsx typescript @types/node
```

Use Node >=22.16. Either configure an existing trusted HTTP redaction service with GLINER_SERVICE_URL, or install the included local Python >=3.10 runtime. From your consuming project directory:

```sh
node node_modules/@webpilot/capability-sensitive-data/scripts/install-runtime.cjs
node node_modules/@webpilot/capability-sensitive-data/scripts/start-runtime.cjs
```

Keep the start process running; the default endpoint is http://127.0.0.1:18001. Installation creates .venv-gliner in the consuming working directory and downloads Python/model dependencies. GLINER_BOOTSTRAP_PYTHON selects the installer interpreter; GLINER_PYTHON_PATH selects the running interpreter. Model cache defaults to .data/gliner-models. The start script binds only loopback. For external deployment you operate the service yourself. GLINER_SERVICE_API_KEY maps to x-api-key.

The HTTP contract is POST `<serviceUrl>/redact` with `{ texts: string[], labels?: string[], threshold?: number }`, returning `{ texts: string[], replacements?: [...] }` with exactly the same text count and order. Do not point this client at an arbitrary model completion endpoint.

## 2. Create the client and make a first call

Save as redaction.ts:

```ts
import { createSensitiveDataRedactor, sensitiveDataFilterConfigFromEnvironment } from '@webpilot/capability-sensitive-data';
export const config = sensitiveDataFilterConfigFromEnvironment({
  ...process.env,
  AI_SENSITIVE_DATA_FILTER_ENABLED: 'true',
  GLINER_SERVICE_URL: process.env.GLINER_SERVICE_URL || 'http://127.0.0.1:18001',
});
export const redact = createSensitiveDataRedactor({ getConfig: () => config });
```

Save as first-call.ts and run `npx tsx first-call.ts`. The actual replacements depend on the configured detectors; verify returned texts before connecting a real model.

```ts
import { redact } from './redaction.js';
const result = await redact(['Example contact: ada@example.com'], AbortSignal.timeout(60_000));
console.log(result.texts);
console.log(result.replacements);
```

## 3. Connect to any Agent framework

Save as boundary.ts. This complete adapter defines an explicit text/tool prompt shape; map your framework's actual outbound prompt into these semantic fields, then map it back in the supplied send callback. Filter the final assembled prompt on every step, including system, assistant history, tool arguments and tool results. Do not recursively rewrite the complete HTTP request: authorization headers, model IDs, tool names, call IDs and transport URLs are protocol fields. Binary image/audio data is outside this text filter.

```ts
import { config, redact } from './redaction.js';

// Apply only to textual fields in your framework's outbound request schema.
// Transport control fields, IDs, URLs and binary payloads must remain unchanged.
type Part = { kind: 'text'; text: string }
  | { kind: 'tool-call'; callId: string; name: string; arguments: unknown }
  | { kind: 'tool-result'; callId: string; result: unknown };
export type OutboundPrompt = {
  system: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: Part[] }>;
};

function mapStrings(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform)]));
  }
  return value;
}
function mapPrompt(prompt: OutboundPrompt, transform: (text: string) => string): OutboundPrompt {
  return { system: transform(prompt.system), messages: prompt.messages.map(message => ({
    ...message, content: message.content.map(part => {
      if (part.kind === 'text') return { ...part, text: transform(part.text) };
      if (part.kind === 'tool-call') return { ...part, arguments: mapStrings(part.arguments, transform) };
      return { ...part, result: mapStrings(part.result, transform) };
    }),
  })) };
}
export async function filterPrompt(prompt: OutboundPrompt, signal?: AbortSignal) {
  if (!config.enabled) return prompt;
  try {
    const texts: string[] = [];
    mapPrompt(prompt, text => { texts.push(text); return text; });
    if (!texts.length) return prompt;
    const result = await redact(texts, signal);
    let index = 0;
    return mapPrompt(prompt, () => result.texts[index++]);
  } catch (error) {
    if (config.failureMode === 'open') { console.error('Redaction failed open'); return prompt; }
    throw error;
  }
}

// Your model adapter invokes this boundary on EVERY step, including after tool results.
export async function callFilteredModel<T>(prompt: OutboundPrompt,
  send: (prompt: OutboundPrompt, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
  const filtered = await filterPrompt(prompt, signal);
  return send(filtered, signal);
}
```

## 4. Complete AI SDK model wrapper

```sh
npm install "ai@>=7 <8" @ai-sdk/openai-compatible
```

Set AGENT_MODEL_BASE_URL, AGENT_MODEL_ID and optionally AGENT_MODEL_API_KEY. Save as agent.ts and run `npx tsx agent.ts`. The adapter targets LanguageModelV4 prompt structures (AI SDK 7); v4 here is the provider interface version, not AI SDK major 4.

```ts
import { generateText, wrapLanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAiSdkSensitiveDataFilter } from '@webpilot/capability-sensitive-data/ai-sdk';
import { config, redact } from './redaction.js';
const baseURL = process.env.AGENT_MODEL_BASE_URL;
const modelId = process.env.AGENT_MODEL_ID;
if (!baseURL || !modelId) throw new Error('Set model URL and ID');
const provider = createOpenAICompatible({ name: 'agent-provider', baseURL,
  apiKey: process.env.AGENT_MODEL_API_KEY });
const filter = createAiSdkSensitiveDataFilter({ getConfig: () => config, redact });
const model = wrapLanguageModel({ model: provider.chatModel(modelId), middleware: {
  specificationVersion: 'v4',
  transformParams: async ({ params }) => filter(params),
} });
const result = await generateText({ model,
  prompt: 'Summarize this example contact: Ada, ada@example.com.' });
console.log(result.text);
// Reuse this wrapped model in ToolLoopAgent so every model call crosses the filter.
```

## Managed Node runtime and configuration

For injected host configuration, import `createNodeSensitiveDataFilter({ getConfig })` from `/node`. It returns `redactSensitiveTexts` and `filterSensitiveData`, and prepares the optional local service before requests. Its configuration callback still belongs to your host. GLINER_RUNTIME_MODE can be auto/local/external; use external for an already operated service. The package also ships scripts/prepare-runtime.cjs for bundling runtime assets. The host owns any separately started service process.

`AI_SENSITIVE_DATA_FILTER_ENABLED` defaults off. FAILURE_MODE defaults closed: if redaction fails, block the model request. Explicit open mode sends the unfiltered request and should report the failure without logging raw sensitive content. The portable redactor always calls its service; the boundary adapter handles enabled/failureMode. Preserve placeholders consistently; there is no automatic output unredaction. The HTTP client owns no long-lived disposable connection; abort each request via AbortSignal and stop any service process your host started.

| Key | Default | Apply mode |
| --- | --- | --- |
| `AI_SENSITIVE_DATA_FILTER_ENABLED` | `false` | `runtime` |
| `GLINER_RUNTIME_MODE` | `auto` | `startup` |
| `GLINER_SERVICE_URL` | `http://127.0.0.1:18001` | `startup` |
| `GLINER_SERVICE_API_KEY` | `` | `runtime` |
| `AI_SENSITIVE_DATA_FILTER_FAILURE_MODE` | `closed` | `runtime` |
| `AI_SENSITIVE_DATA_FILTER_TIMEOUT_MS` | `60000` | `runtime` |
| `AI_SENSITIVE_DATA_FILTER_THRESHOLD` | `0.5` | `runtime` |
| `AI_SENSITIVE_DATA_FILTER_LABELS` | `` | `runtime` |
| `GLINER_DEVICE` | `cpu` | `startup` |
| `GLINER_BATCH_SIZE` | `8` | `startup` |

## MCP placement and troubleshooting

When your Agent consumes MCP tools, install this filter in the **client Agent's final model boundary**, after tool results have been incorporated into the prompt. Registering it as a server tool would let the model bypass it.

Connection refused: start/check the redaction service URL. Invalid response: check the redact contract and text count. No redaction: verify enabled, labels/threshold and detector runtime availability. Request blocked: inspect service failure while preserving closed-mode semantics. Integration is complete only after an outbound prompt containing system/user/tool text crosses the wrapper before any provider call.

Entrypoints: root = configuration/client/manifest; /ai-sdk = V4 prompt traversal/filter factory; /node = managed service integration; /settings = manifest-owned settings. The package includes business/credential rules, LiquidAI PII detection, GLiNER2.5 open-label detection and Chinese RoBERTa correction; runtime downloads and resources are required when selecting those local detectors.
