# @webpilot/capability-communication

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

创建消息草稿，通过已配置渠道发送并记录送达回执。

本 README 是完整接入入口。任意 TypeScript Agent 框架可按步骤 1–4 接入，也可选择下方 AI SDK/MCP 路线。示例中的命名文件全部创建在**你的使用方项目**中，不是在本包目录中。

## 1. 安装与准备

使用 Node.js >=22.16 和 ESM TypeScript。示例对照 0.1.0 工作区契约。请从配置的 npm 仓库安装相互匹配的能力包版本；若版本尚未发布，使用维护者提供的同版本发布 tarball/工作区包，仓库 404 不属于运行错误。不要混装不同版本。新项目可执行：

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-communication @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

示例只列出渠道。Webhook 需要接受 `{ targets, content, metadata }`；其他厂商的 webhook 可能需要 `mapBody`、`verifyResponse` 或自定义 `CommunicationChannel`。`draft` 接收 `channelId`、`targets`、`content`，`readDraft` 和 `send` 使用返回的 `draftId`；创建草稿不会发送。

只有宿主能在 send 前核准准确的已保存草稿时，才设置 `AGENT_COMMUNICATION_ALLOW_SEND=true`；可使用 `beforeInvoke` 或 AI SDK execute 包装函数。权限回调本身拿不到工具输入。SQLite 草稿存储原子认领发送任务；确认未送达后可重试原草稿，对 `sending`/`unknown` 应先查证，`sent` 返回已保存回执。

文本格式为 `{ format: "text", body: "..." }`。媒体使用 `artifactId` 或服务端返回的 `mediaId` 二选一，由宿主验证归属并上传。WebSocket 和 MCP 的 ID 属于不同协议。Node 还提供基于 connector 的渠道与企微机器人连接；自定义驱动实现导出的渠道接口。凭证不应放入模型生成的参数中。

## 2. 创建 Provider

保存为 `provider.ts`。创建能力 Provider，并导出首个有效调用、显式配置覆盖和宿主清理函数。

```ts
import { createJsonWebhookChannel, createNodeCommunicationCapability } from '@webpilot/capability-communication/node';
 const url = process.env.NOTIFICATION_WEBHOOK_URL;
 if (!url) throw new Error('Set NOTIFICATION_WEBHOOK_URL to your canonical webhook');
 const provider = createNodeCommunicationCapability({
   draftDirectory: './agent-data/communication',
   channels: () => [createJsonWebhookChannel({ id: 'notifications', url })],
 });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "communication",
  "input": {
    "action": "channels",
    "reason": "Inspect configured delivery channels"
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
| `AGENT_COMMUNICATION_ALLOW_SEND` | `false` | `runtime` |
| `AGENT_COMMUNICATION_TIMEOUT_MS` | `30000` | `runtime` |

## 排查与接入完成标准

- 找不到模块：检查发布 exports、版本一致性、Node/ESM 配置，安装对应入口的可选 peer。
- 找不到工具：检查 runtime.tools、启用的能力 ID 与允许的工具名，不要根据目录名猜测。
- 参数校验失败：使用实际 inputSchema 与 parse 错误，不复制其他入口的 Schema。
- 操作被禁用/不可用：检查归一化配置、所选后端、系统程序和宿主回调。
- 未遵循 Skill：模型调用前追加 eager 指令，或实现 lazy 读取与可用性策略。
- 超时不代表副作用没有发生；重试前检查持久化或实时状态。
- 完成标准：首次调用返回 ok: true，Agent 得到相同参数结构和完整结果，所需文件/图片能被使用方访问，结束后资源正常释放。

## 发布入口

- `@webpilot/capability-communication`
- `@webpilot/capability-communication/node`
- `@webpilot/capability-communication/mcp`
- `@webpilot/capability-communication/runtime-skill`
- `@webpilot/capability-communication/settings`

## 补充行为参考

渠道驱动负责协议、鉴权、消息映射、响应验证和生命周期。Node 提供标准 JSON webhook、基于 connector 的操作渠道，以及官方 @wecom/aibot-node-sdk 的持久机器人连接（接收、上传、回复）。Email、钉钉、飞书、Slack 等可实现相同 CommunicationChannel。确实未送达时抛 CommunicationDeliveryError(message, 'not-sent')，可保存 failed 并允许修正后重试原草稿；超时、回执缺失、部分送达属于 unknown，先核实。核心层不根据厂商错误文案猜结果。

媒体草稿使用 format=image/file/voice/video，artifactId 与 mediaId 只能选一个；视频可带 title/description，文字说明另建草稿。WeCom 发送采用匹配 msg_type 和嵌套 media_id，不接受 Markdown 图片语法。createWeComMessageArguments 可注入 media:{readArtifact,upload} 并声明 mediaSources:['artifactId','mediaId']；读取、上传发生在已授权 send 内，宿主验证产物归属。语音需要 AMR，其他音频可按文件发送。

createWeComBotConnection({botId,secret}) 使用同一个官方 WebSocket 连接接收与上传，SDK 以 init/chunk/finish 上传，限制 50 MB，无需额外 HTTP 上传接口；渠道禁用时断开。onMessage 提供文本/语音转录、混合图文、媒体描述和单聊/群聊目标，download 按消息 AES key 下载解密；回调回复使用本连接 sendText/sendMedia，不把 WebSocket ID 填入 MCP 加密 ID 接口。MCP 媒体与目标 ID 必须从同一 MCP 获取，使用 message_aibot_sessions_list 刷新会话并验证收件人；ID 是不透明值，不按 hex/base64 形状判断。

transport=wecom-mcp 与 wecom-websocket 是不同目标空间，草稿复制目标 ID 和 transport。设置默认 MCP，附件上传需要明确 WebSocket 目标，回调回复保持来源连接。SQLite 原子 claimDelivery/finishDelivery 跨本机进程防止重复发送，草稿 ID 作为幂等 key；自定义持久存储也需原子实现，直接创建 store 时需 dispose。

以下属于 Orbit 宿主集成，不会因安装本包自动获得：机器人会话绑定 web 账户，/start、/delete、/list、/select 管理 Browser Chat；群成员共享会话，其他账户会话不可访问。入站 ID 持久去重，出站逐部分记录回执；队列进入后重读持久记录，重启可补交已完成结果，不自动重放中断工具。混合图文进入同一轮；仅附件先下载并等待同一发件人、同一 web 会话后续文字，切换会话不移动附件，删除会话取消等待，遵循上传大小/配额/保留期。机器人创建轮次使用宿主 full 模式并自动回复来源会话。
