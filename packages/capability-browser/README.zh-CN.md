# @webpilot/capability-browser

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

通过持久化 JavaScript 环境和页面观察控制 Playwright 浏览器。

`BrowserSession.executeBrowserCode()` 返回 `{ ok, summary, data, ... }`：`data.result` 是代码输出，`data.executionState` 是执行状态，`data.domChanges` 是页面增量变化。直接读取这些对象；完整内容仅保留在 `data` 中。对于 `createNodeBrowserCapability` 返回的结果，先使用 `@webpilot/capability-browser` 导出的 `browserOperationFromCapabilityResult` 解开 Capability 外层结构。状态文案读取 `summary`。

本 README 是完整接入入口。任意 TypeScript Agent 框架可按步骤 1–4 接入，也可选择下方 AI SDK/MCP 路线。示例中的命名文件全部创建在**你的使用方项目**中，不是在本包目录中。

## 1. 安装与准备

使用 Node.js >=22.16 和 ESM TypeScript。示例对照 0.1.0 工作区契约。请从配置的 npm 仓库安装相互匹配的能力包版本；若版本尚未发布，使用维护者提供的同版本发布 tarball/工作区包，仓库 404 不属于运行错误。不要混装不同版本。新项目可执行：

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-browser @webpilot/capability-sdk @webpilot/capability-host playwright@^1.60.0
npm install -D typescript tsx @types/node
```

在使用方项目执行 `npx playwright install chromium` 安装匹配的 Chromium。每个挂载的运行实例创建自己的 BrowserSession；需要保留标签页和 JavaScript 变量的整段会话应复用该实例。本地可见操作可设置 `headless: false`。

`state` 用于观察，`code` 使用 Skill 中的 `browser`、`page`、`nodeRepl` API 执行代码，`waitForHumanVerification` 等待人工处理。包提供的 facade 与普通 Playwright Page 并非处处可以互换；模型生成代码前应读取运行时 Skill。超时或取消后，先查看实时状态再决定是否重试。截图需要宿主的图片内容适配和产物存储；浏览器下载可接入 File 的 `createNodeFileDownloadReceiver`。

专用 `/mcp` 入口通过 `browser.open`、`browser.code`、`browser.snapshot`、`browser.close` 和显式 `browserSessionId` 管理会话；本教程的通用 Provider 暴露单个 `browser` 工具，两套参数不能混用。跨请求的远程浏览器会话应使用 MCP.md 中的有状态 HTTP 示例或 stdio；便捷的按请求 HTTP Handler 不会跨请求保留这个内存会话管理器。

## 2. 创建 Provider

保存为 `provider.ts`。创建能力 Provider，并导出首个有效调用、显式配置覆盖和宿主清理函数。

```ts
import { BrowserSession, createNodeBrowserCapability } from '@webpilot/capability-browser/node';
 const provider = createNodeBrowserCapability({
   createOptions: (context) => {
     const session = new BrowserSession({ headless: true, isolated: true });
     return { session, runId: context.runId,
       ensureStarted: () => session.start(), disposeSession: true,
       imageInputAvailable: false };
   },
 });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "browser",
  "input": {
    "action": "state",
    "reason": "Inspect the initial browser state"
  }
};
export async function cleanup() {  }
```

## 3. 挂载、校验与执行

保存为 `integration.ts`。每轮运行共用一个执行器，保持串行分组有效。参数解析、取消、策略和清理都是接入代码的职责，不能依赖模型自行遵守。

```ts
import { randomUUID } from 'node:crypto';
import { mountCapabilities, EnvironmentCapabilityConfigStore } from '@webpilot/capability-host';
import { createCapabilityExecutor, disposeOnce,
  type CapabilityExecutionPolicyOptions } from '@webpilot/capability-sdk';
import { providers, configurations, cleanup } from './provider.js';

export async function openCapabilities(options: {
  policy: CapabilityExecutionPolicyOptions;
  signal?: AbortSignal;
  beforeInvoke?: (name: string, input: unknown) => void | Promise<void>;
}) {
  const mounted = await mountCapabilities({
    providers, configurations,
    context: { runId: randomUUID(), abortSignal: options.signal },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
  }).catch(async error => { await cleanup(); throw error; });
  const execute = createCapabilityExecutor(options.policy);
  const tools = Object.values(mounted.tools).map(resolved => ({
    name: resolved.publicName,
    description: resolved.tool.description,
    inputSchema: resolved.tool.input.jsonSchema,
    inputExamples: resolved.tool.inputExamples,
    async execute(rawInput: unknown, call: { id?: string; signal?: AbortSignal } = {}) {
      const signals = [mounted.abortSignal, call.signal].filter(
        (value): value is AbortSignal => Boolean(value));
      const context = { invocationId: call.id || randomUUID(),
        abortSignal: signals.length ? AbortSignal.any(signals) : undefined };
      try {
        const input = resolved.tool.input.parse(rawInput);
        await options.beforeInvoke?.(resolved.publicName, input);
        return await execute(resolved, context,
          execution => resolved.tool.execute(input, execution));
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        return { ok: false as const, error: {
          code: 'host-tool-invocation-failed',
          message: error instanceof Error ? error.message : String(error),
        } };
      }
    },
  }));
  return {
    tools,
    instructions: mounted.skillCatalog.instructions('eager'),
    snapshot: mounted,
    dispose: disposeOnce(async () => {
      try { await mounted.dispose(); } finally { await cleanup(); }
    }),
  };
}
```

保存为 `policy.ts`。该单用户示例授权显式选定的 Provider。共享 Agent 应将这些钩子连接到已有的用户权限和操作审批逻辑。若工具声明 prerequisite，还需提供 policy.prerequisite，验证指定前置条件，不满足时抛错。

```ts
import type { CapabilityExecutionPolicyOptions } from '@webpilot/capability-sdk';
import { providers } from './provider.js';

// This sample host grants the permissions of its explicitly configured providers.
// Replace this set with your authenticated user's grants in a shared service.
const grants = new Set(providers.flatMap(provider => [...(provider.manifest.permissions || [])]));
export const policy: CapabilityExecutionPolicyOptions = {
  authorize(permissions) {
    for (const permission of permissions) {
      if (!grants.has(permission)) throw new Error(`Permission denied: ${permission}`);
    }
  },
  reportProgress(event) { console.error(event.phase, event.message); },
};

// Put your existing action/draft approval check here, before calling the tool.
// No additional action-level approval is configured by this single-user example.
export async function beforeInvoke(_name: string, _input: unknown): Promise<void> {}
```

保存为 `first-call.ts`，执行 `npx tsx first-call.ts`。首次调用不需要模型/API Key，但仍需满足上面对应能力的运行条件。

```ts
import { openCapabilities } from './integration.js';
import { exampleCall } from './provider.js';
import { policy, beforeInvoke } from './policy.js';
const runtime = await openCapabilities({ policy, beforeInvoke });
try {
  const tool = runtime.tools.find(tool => tool.name === exampleCall.name);
  if (!tool) throw new Error(`Tool not mounted: ${exampleCall.name}`);
  const result = await tool.execute(exampleCall.input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally { await runtime.dispose(); }
```

## 4. 接入你自己的 Agent

将返回的对象映射到你的框架原生工具注册接口。以下字段来自上面的实际接入代码，不依赖虚构的 createAgent API：

| 本接入代码 | 你的 Agent |
| --- | --- |
| `runtime.tools[].name` | 工具名 |
| `.description` | 模型可见描述 |
| `.inputSchema` | JSON Schema 或框架原生 Schema 转换 |
| `.execute(input, { id, signal })` | 工具回调，传入模型调用 ID 和取消信号 |
| `runtime.instructions` | 首次模型调用前追加到系统/Agent 指令 |
| `runtime.dispose()` | 整轮运行/会话结束后等待释放 |

每次模型步骤：发送工具与指令 → 接收工具调用 → 若框架返回字符串参数则解析一次 JSON → 按准确名称找工具 → await execute → 将**完整结果**作为相同调用 ID 对应的 tool-result 消息追加 → 再调用模型。模型给出最终回答或达到步骤/取消限制时停止，整个循环保持运行实例存活。

保留 ok、data、content、error（含 code/retryable/details），不要只保留 summary。纯文本工具结果可用 JSON.stringify(result)。视觉模型需要原生图片内容及实际图片数据，路径或 JSON 序列化不会自动成为图片输入。复用返回的产物 URL，不要编造 ID 或链接。lazy Skill 需要显式读取工具和宿主维护的已读状态/可用性规则，本示例使用 eager。

下一节给出 AI SDK 的具体完整 Agent。其他框架只需改变原生工具、模型和消息映射，上述能力执行边界保持不变。

## AI SDK：完整模型驱动 Agent

```sh
npm install @webpilot/capability-adapter-ai-sdk "ai@>=7 <8" @ai-sdk/openai-compatible
```

选择支持工具调用的 Chat Completions 兼容服务。在进程环境中设置 AGENT_MODEL_BASE_URL（包含 API 路径前缀）、AGENT_MODEL_ID，可选 AGENT_MODEL_API_KEY。保存为 agent.ts，与 provider.ts、policy.ts 放在一起，执行 `npx tsx agent.ts "你的任务"`。这是 first-call.ts 的替代入口，不要在其内部重复挂载。默认提示词只要求说明工具，实际执行时传入你的任务。

```ts
import { randomUUID } from 'node:crypto';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { mountAISDKCapabilities, EnvironmentCapabilityConfigStore } from '@webpilot/capability-adapter-ai-sdk';
import { providers, configurations, cleanup } from './provider.js';
import { policy, beforeInvoke } from './policy.js';

const baseURL = process.env.AGENT_MODEL_BASE_URL;
const modelId = process.env.AGENT_MODEL_ID;
if (!baseURL || !modelId) throw new Error('Set AGENT_MODEL_BASE_URL and AGENT_MODEL_ID');
const modelProvider = createOpenAICompatible({ name: 'agent-provider', baseURL,
  apiKey: process.env.AGENT_MODEL_API_KEY });
const abort = new AbortController();
const cancel = () => abort.abort(new Error('Agent interrupted'));
process.once('SIGINT', cancel);
let runtime: Awaited<ReturnType<typeof mountAISDKCapabilities>> | undefined;
try {
  runtime = await mountAISDKCapabilities({
    providers, configurations,
    context: { runId: randomUUID(), abortSignal: abort.signal },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
    skills: { mode: 'eager' },
    adapter: { policy, async execute(call) {
      await beforeInvoke(call.resolvedTool.publicName, call.input);
      return call.invoke();
    } },
  });
  const agent = new ToolLoopAgent({ model: modelProvider.chatModel(modelId),
    ...runtime.agentOptions, stopWhen: stepCountIs(10) });
  const result = await agent.generate({
    prompt: process.argv[2] || 'Describe the available tools and their intended usage.',
    abortSignal: abort.signal,
  });
  console.log(result.text);
} finally {
  process.removeListener('SIGINT', cancel);
  try { await runtime?.dispose(); } finally { await cleanup(); }
}
```

## MCP：stdio、HTTP 服务与客户端

阅读本包随附、可独立使用的 [MCP 完整教程](MCP.zh-CN.md)。包含依赖安装、stdio 进程、有状态 HTTP 监听服务、客户端发现与调用、模型驱动的客户端 Agent、取消、鉴权边界和关闭流程。复用上面的 provider.ts 与 policy.ts。远程客户端只需 MCP URL 及客户端依赖，不导入本能力包。

服务端 file URL 不能作为远程下载地址。请按前面的产物/存储要求配置。MCP 服务端拥有执行环境，调用方本机文件、浏览器和桌面不会自动出现在服务端。

## 配置与生命周期

设置定义在 provider.manifest.configuration.settings。每项包含 key、defaultValue、control、secret、范围/选项、applyMode，可据此生成设置 UI。配置值为字符串。只有提供 EnvironmentCapabilityConfigStore 才读取环境配置，显式 configurations[capabilityId] 覆盖存储/环境值。配置在挂载时注入。持久状态使用稳定的用户/工作区范围，适用配置变化后重新挂载。模型失败或取消后同样需要等待 dispose。

下表列出包设置中的字面默认值，动态定义仍以 manifest 为准。runtime 表示新运行需重新挂载，startup 还需重新启动所属驱动/服务。

| 键 | 默认值 | 生效方式 |
| --- | --- | --- |
| `BROWSER_PREVIEW_FPS` | `20` | `runtime` |
| `BROWSER_OUTPUT_PIXEL_RATIO` | `1.5` | `runtime` |
| `BROWSER_SCREENCAST_FORMAT` | `jpeg` | `runtime` |
| `BROWSER_SCREENCAST_QUALITY` | `90` | `runtime` |
| `BROWSER_PREVIEW_TRANSPORT` | `video` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_BITRATE_KBPS` | `` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_SOURCE_FORMAT` | `jpeg` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_MAX_WIDTH` | `1920` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_MAX_HEIGHT` | `1080` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_KEYFRAME_INTERVAL` | `15` | `runtime` |
| `BROWSER_PROFILE_CLEAR_CACHE_ON_CLOSE` | `true` | `startup` |
| `BROWSER_USER_BROWSER_IDLE_TIMEOUT_MS` | `180000` | `runtime` |
| `ELECTRON_EMBEDDED_BROWSER` | `false` | `startup` |
| `HEADLESS_BROWSER` | `false` | `startup` |
| `BROWSER_VIEWPORT_MODE` | `auto` | `startup` |
| `BROWSER_VIEWPORT_WIDTH` | `` | `startup` |
| `BROWSER_VIEWPORT_HEIGHT` | `` | `startup` |
| `BROWSER_NAVIGATION_DOM_QUIET_MS` | `250` | `runtime` |
| `BROWSER_NAVIGATION_DOM_STABILITY_TIMEOUT_MS` | `1000` | `runtime` |
| `BROWSER_IGNORE_HTTPS_ERRORS` | `false` | `startup` |
| `BROWSER_HTTP_REQUEST_HISTORY_LIMIT` | `400` | `runtime` |
| `AI_HTTP_REQUEST_TOOL_LIMIT` | `80` | `runtime` |
| `SCREENSHOT_TIMEOUT_MS` | `15000` | `runtime` |
| `MANUAL_VERIFICATION_TIMEOUT_MS` | `180000` | `runtime` |
| `BROWSER_CHAT_KEEP_BROWSER_OPEN_AFTER_TURN` | `true` | `runtime` |
| `BROWSER_CHAT_ACTION_FRAME_LIMIT` | `24` | `runtime` |
| `BROWSER_CHAT_SHOW_REASONING` | `false` | `runtime` |
| `BROWSER_CHAT_LOG_LIMIT` | `2000` | `runtime` |
| `AI_VISUAL_HISTORY_LIMIT` | `6` | `runtime` |
| `AI_COMPLETION_VERIFY` | `true` | `runtime` |
| `PLAYWRIGHT_TRACE` | `true` | `startup` |

## 排查与接入完成标准

- 找不到模块：检查发布 exports、版本一致性、Node/ESM 配置，安装对应入口的可选 peer。
- 找不到工具：检查 runtime.tools、启用的能力 ID 与允许的工具名，不要根据目录名猜测。
- 参数校验失败：使用实际 inputSchema 与 parse 错误，不复制其他入口的 Schema。
- 操作被禁用/不可用：检查归一化配置、所选后端、系统程序和宿主回调。
- 未遵循 Skill：模型调用前追加 eager 指令，或实现 lazy 读取与可用性策略。
- 超时不代表副作用没有发生；重试前检查持久化或实时状态。
- 完成标准：首次调用返回 ok: true，Agent 得到相同参数结构和完整结果，所需文件/图片能被使用方访问，结束后资源正常释放。

## 发布入口

- `@webpilot/capability-browser`
- `@webpilot/capability-browser/node`
- `@webpilot/capability-browser/runtime-skill`
- `@webpilot/capability-browser/settings`
- `@webpilot/capability-browser/session-group`
- `@webpilot/capability-browser/mcp`

## 补充行为参考

在使用方项目执行 `npx playwright install chromium` 安装匹配的 Chromium。每个挂载的运行实例创建自己的 BrowserSession；需要保留标签页和 JavaScript 变量的整段会话应复用该实例。本地可见操作可设置 `headless: false`。

`state` 用于观察，`code` 使用 Skill 中的 `browser`、`page`、`nodeRepl` API 执行代码，`waitForHumanVerification` 等待人工处理。包提供的 facade 与普通 Playwright Page 并非处处可以互换；模型生成代码前应读取运行时 Skill。超时或取消后，先查看实时状态再决定是否重试。截图需要宿主的图片内容适配和产物存储；浏览器下载可接入 File 的 `createNodeFileDownloadReceiver`。

专用 `/mcp` 入口通过 `browser.open`、`browser.code`、`browser.snapshot`、`browser.close` 和显式 `browserSessionId` 管理会话；本教程的通用 Provider 暴露单个 `browser` 工具，两套参数不能混用。跨请求的远程浏览器会话应使用 MCP.md 中的有状态 HTTP 示例或 stdio；便捷的按请求 HTTP Handler 不会跨请求保留这个内存会话管理器。

可选 system-browser-interactive-qa Skill 随 manifest 发布，主 Skill 会把 UI 调试和验收任务路由到该参考，覆盖持久会话迭代、功能后置条件、视觉检查和视口证据。state/browser.snapshot 支持 scope=active/all、准确 frame、唯一 selector、query、maxOutputChars。nextCursor 继续同一份不可变观察，保持选择条件不变；两分钟、导航、新观察或 code 操作后过期。capturedAt 是历史时间，操作前重新核实实时定位器。执行结果包含 executionState 和 requiresStateRefresh；超时/取消/崩溃可能已执行部分动作，kernelReset 会清空 JavaScript 变量。
