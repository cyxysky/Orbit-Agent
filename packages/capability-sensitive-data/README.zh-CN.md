# @webpilot/capability-sensitive-data

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

在最终模型服务调用边界过滤敏感数据。本包是中间件，**不是 CapabilityProvider 或 MCP 工具**，不通过 host 挂载。SDK 是内部依赖；使用可移植客户端不需要 host 或能力适配器。
## 1. 安装并启动脱敏服务

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-sensitive-data
npm install -D tsx typescript @types/node
```

使用 Node >=22.16。可以用 GLINER_SERVICE_URL 指定已有可信 HTTP 脱敏服务，也可以安装随包提供的 Python >=3.10 本地运行环境。在使用方项目目录执行：

```sh
node node_modules/@webpilot/capability-sensitive-data/scripts/install-runtime.cjs
node node_modules/@webpilot/capability-sensitive-data/scripts/start-runtime.cjs
```

保持启动进程运行，默认地址为 http://127.0.0.1:18001。安装会在使用方工作目录创建 .venv-gliner 并下载 Python/模型依赖。GLINER_BOOTSTRAP_PYTHON 选择安装用解释器，GLINER_PYTHON_PATH 选择运行解释器，模型缓存默认为 .data/gliner-models。启动脚本只绑定回环地址；外部部署由宿主自行管理。GLINER_SERVICE_API_KEY 对应 x-api-key。

HTTP 契约为 POST `<serviceUrl>/redact`，请求 { texts: string[], labels?: string[], threshold?: number }，返回 { texts: string[], replacements?: [...] }，文本数量与顺序必须相同。不要把该客户端指向普通模型对话接口。

## 2. 创建客户端并首次调用

保存为 redaction.ts：

```ts
import { createSensitiveDataRedactor, sensitiveDataFilterConfigFromEnvironment } from '@webpilot/capability-sensitive-data';
export const config = sensitiveDataFilterConfigFromEnvironment({
  ...process.env,
  AI_SENSITIVE_DATA_FILTER_ENABLED: 'true',
  GLINER_SERVICE_URL: process.env.GLINER_SERVICE_URL || 'http://127.0.0.1:18001',
});
export const redact = createSensitiveDataRedactor({ getConfig: () => config });
```

保存为 first-call.ts，执行 npx tsx first-call.ts。实际替换取决于配置的检测器，接入真实模型前检查返回文本。

```ts
import { redact } from './redaction.js';
const result = await redact(['Example contact: ada@example.com'], AbortSignal.timeout(60_000));
console.log(result.texts);
console.log(result.replacements);
```

## 3. 接入任意 Agent 框架

保存为 boundary.ts。该完整适配器定义明确的文本/工具提示结构；把框架实际发出的提示映射到这些语义字段，再在 send 回调中映射回原生请求。每一步过滤最终组装的提示，包括系统信息、助手历史、工具参数与结果。不要递归改写完整 HTTP 请求：鉴权头、模型 ID、工具名、调用 ID、传输 URL 是协议字段。二进制图片/音频不属于该文本过滤器的处理范围。

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

## 4. 完整 AI SDK 模型包装

```sh
npm install "ai@>=7 <8" @ai-sdk/openai-compatible
```

设置 AGENT_MODEL_BASE_URL、AGENT_MODEL_ID，可选 AGENT_MODEL_API_KEY。保存为 agent.ts，执行 npx tsx agent.ts。适配器针对 LanguageModelV4 提示结构（AI SDK 7），这里的 v4 是 provider 接口版本，不是 AI SDK 主版本 4。

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

## Node 托管运行环境与配置

宿主注入配置时，从 /node 使用 createNodeSensitiveDataFilter({ getConfig })，返回 redactSensitiveTexts 与 filterSensitiveData，并在请求前准备可选本地服务。配置回调仍由宿主管理。GLINER_RUNTIME_MODE 为 auto/local/external，已有服务选择 external；scripts/prepare-runtime.cjs 用于打包运行资源。独立启动的服务进程由宿主持有。

AI_SENSITIVE_DATA_FILTER_ENABLED 默认关闭。FAILURE_MODE 默认 closed：脱敏失败时阻止模型请求。显式 open 模式会发送未过滤请求，应报告失败但不要记录原始敏感内容。可移植 redactor 本身始终调用服务，enabled/failureMode 由边界适配器处理。保持占位符一致，没有自动反向恢复模型输出的机制。HTTP 客户端没有需长期 dispose 的连接；通过 AbortSignal 取消请求，并关闭宿主启动的服务进程。

| 键 | 默认值 | 生效方式 |
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

## MCP 中的位置与排查

Agent 使用 MCP 工具时，将过滤器安装在**客户端 Agent 最终模型边界**，在工具结果已加入提示后执行。把它注册成服务端工具会让模型能够绕过过滤。

连接拒绝：检查服务进程和 URL。响应格式无效：检查 redact 契约及文本数量。没有脱敏：检查 enabled、labels/threshold、检测运行环境。请求被阻止：检查服务失败原因并保持 closed 的语义。只有系统/用户/工具文本组成的最终提示在每次 provider 调用前经过包装器，才算完成接入。

入口：根入口提供配置/客户端/manifest，/ai-sdk 提供 V4 提示遍历与过滤工厂，/node 提供托管服务接入，/settings 提供包设置。包内含业务/凭证规则、LiquidAI PII、GLiNER2.5 开放标签检测及中文 RoBERTa 修正，选择本地检测器时需要下载并准备其模型资源。
