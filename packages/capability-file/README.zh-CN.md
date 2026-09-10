# @webpilot/capability-file

## JavaScript 模式：Excel 与 HTML 文档

选择 JavaScript 模式后，XLSX 继续使用原有 ExcelJS 程序；DOCX、PPTX、PDF 使用完整 HTML 源码生成。设置值仍为 `javascript`，文档计划会返回实际引擎 `html` 和 `.html` 源码文件名。

通过 `jsApi(documentId)` 读取 HTML 规则，将完整 HTML 放入 `generate.program`，之后沿用 `readSource → edit → render` 和视觉检查流程。PPTX 每页使用等尺寸的 `section[data-slide]`；正文、表格和简单色块保留为可编辑对象。DOCX 使用语义化段落和表格，PDF 使用 Chromium 排版。复杂图形可使用 SVG/图片；不承诺将任意 CSS 无损转换成 Office 对象。

Markdown、TXT、HTML、JS、CSS、JSON、YAML、CSV 等文本文件在所有模式下都使用 `file.write({fileName,content})` 直接生成，保留原始 UTF-8 内容，无需 Office 引擎。HTML 排版需要 Chromium；DOCX、PPTX、XLSX 的重新打开和预览仍需要 LibreOffice。显式 UNO 模式及已有 Office 文件的保留式修改继续使用 UNO。

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

读取和发布文件、生成与编辑 Office 文档，并管理文件产物工作区。

本 README 是完整接入入口。任意 TypeScript Agent 框架可按步骤 1–4 接入，也可选择下方 AI SDK/MCP 路线。示例中的命名文件全部创建在**你的使用方项目**中，不是在本包目录中。

## 1. 安装与准备

使用 Node.js >=22.16 和 ESM TypeScript。示例对照 0.1.0 工作区契约。请从配置的 npm 仓库安装相互匹配的能力包版本；若版本尚未发布，使用维护者提供的同版本发布 tarball/工作区包，仓库 404 不属于运行错误。不要混装不同版本。新项目可执行：

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-file @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

首次调用只写入 UTF-8 文本，不需要安装 Office。Office 生成流程为 `plan → generate → render`；编写前应读取包的 Skill 及 plan 返回的引擎/API 指引。本地 Office 转换需要 LibreOffice，UNO 编写还需要能够 `import uno` 的 Python。JavaScript 编写与文件转换是不同的运行需求；请明确设置 `OFFICE_GENERATION_MODE`。

`readSource(documentId)` 读取生成代码，`readContent(artifactId)` 读取发布后的内容。`edit` 必须使用 `readSource` 返回的准确 `patchBaseDigest`，修改后重新 render。只有宿主提供 `readFileVisuals` 且确实向模型传递图片时才启用视觉输入。附件需要 `attachmentBindings` 或宿主实现的 `readFile`。

默认产物 URL 是服务端本地 `file:` 地址，远程客户端无法下载。应提供 `workspace.artifactUrl({ absolutePath, relativePath })`，并实现对应的鉴权下载路由或对象存储；仅生成 URL 并不会自动提供文件服务。访问同一轮运行的草稿和产物时保持 run ID 一致。

## 2. 创建 Provider

保存为 `provider.ts`。创建能力 Provider，并导出首个有效调用、显式配置覆盖和宿主清理函数。

```ts
import { createNodeFileCapability, disposeUnoRuntime } from '@webpilot/capability-file/node';
 const provider = createNodeFileCapability({
   workspace: { artifactsRoot: './agent-data/files' },
   visualInputAvailable: false,
 });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "file",
  "input": {
    "action": "write",
    "fileName": "hello.md",
    "content": "# Hello\n\nCreated by the file capability.\n"
  }
};
export async function cleanup() { await disposeUnoRuntime(); }
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
| `OFFICE_GENERATION_MODE` | `uno` | `runtime` |

## 排查与接入完成标准

- 找不到模块：检查发布 exports、版本一致性、Node/ESM 配置，安装对应入口的可选 peer。
- 找不到工具：检查 runtime.tools、启用的能力 ID 与允许的工具名，不要根据目录名猜测。
- 参数校验失败：使用实际 inputSchema 与 parse 错误，不复制其他入口的 Schema。
- 操作被禁用/不可用：检查归一化配置、所选后端、系统程序和宿主回调。
- 未遵循 Skill：模型调用前追加 eager 指令，或实现 lazy 读取与可用性策略。
- 超时不代表副作用没有发生；重试前检查持久化或实时状态。
- 完成标准：首次调用返回 ok: true，Agent 得到相同参数结构和完整结果，所需文件/图片能被使用方访问，结束后资源正常释放。

## 发布入口

- `@webpilot/capability-file`
- `@webpilot/capability-file/node`
- `@webpilot/capability-file/formats`
- `@webpilot/capability-file/office`
- `@webpilot/capability-file/runtime-skill`
- `@webpilot/capability-file/settings`
- `@webpilot/capability-file/mcp`
- `@webpilot/capability-file/node/artifacts`
- `@webpilot/capability-file/node/convert`
- `@webpilot/capability-file/node/download`
- `@webpilot/capability-file/node/generate`
- `@webpilot/capability-file/node/office`
- `@webpilot/capability-file/node/read`
- `@webpilot/capability-file/node/text-extraction`
- `@webpilot/capability-file/node/workspace`

## 向远程客户端提供生成文件

以下是单个使用方的完整下载路径。保存为 artifact-server.ts，在独立终端运行 npx tsx artifact-server.ts。它提供同一个 File 工作区目录，校验解析后的真实路径（包含符号链接），流式发送字节。两个进程工作目录不同时，用相同的绝对 FILE_ARTIFACTS_DIR。远程使用设置 FILE_BIND_ADDRESS/FILE_PORT 并在前面提供 HTTPS。FILE_DOWNLOAD_TOKEN 在本地可选、远程必填。此示例把一个根目录视为一个使用方，多用户应用应先核实产物归属再解析路径。

用第二个代码块替换 Provider 创建部分，保留原有导出与 cleanup。FILE_PUBLIC_URL 是客户端可访问的 origin 或挂载基础路径。启用鉴权后客户端下载需发送 Bearer 头；网页链接应接入应用会话或短期签名 URL，工具不会把凭证放入 URL。

```ts
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { artifactContentType } from '@webpilot/capability-file/formats';
const directory = path.resolve(process.env.FILE_ARTIFACTS_DIR || './agent-data/files');
await mkdir(directory, { recursive: true });
const root = await realpath(directory);
const port = Number(process.env.FILE_PORT || 3101);
const hostname = process.env.FILE_BIND_ADDRESS || '127.0.0.1';
const token = process.env.FILE_DOWNLOAD_TOKEN;
if (!['127.0.0.1', '::1'].includes(hostname) && !token) throw new Error('Set FILE_DOWNLOAD_TOKEN');
const server = createServer((req, res) => { void (async () => {
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end(); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/artifacts/')) { res.writeHead(404).end(); return; }
  const relativePath = decodeURIComponent(url.pathname.slice('/artifacts/'.length));
  const candidate = await realpath(path.resolve(root, relativePath));
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    res.writeHead(403).end(); return;
  }
  const info = await stat(candidate);
  if (!info.isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {
    'content-type': artifactContentType(candidate),
    'content-length': String(info.size), 'x-content-type-options': 'nosniff',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(candidate))}`,
    'cache-control': 'private, no-store',
  });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(candidate), res);
})().catch(error => {
  console.error(error);
  if (!res.headersSent) res.writeHead(404).end(); else res.destroy();
}); });
server.listen(port, hostname, () => console.error(`Artifact server listening on ${hostname}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.close(); server.closeAllConnections(); });
}
```

```ts
import { createNodeFileCapability, disposeUnoRuntime } from '@webpilot/capability-file/node';
const publicBase = process.env.FILE_PUBLIC_URL || 'http://127.0.0.1:3101';
const provider = createNodeFileCapability({
  workspace: {
    artifactsRoot: process.env.FILE_ARTIFACTS_DIR || './agent-data/files',
    artifactUrl: ({ relativePath }) => publicBase.replace(/\/$/, '') + '/artifacts/'
      + relativePath.split(/[\\/]/).map(encodeURIComponent).join('/'),
  },
  visualInputAvailable: false,
});
// Retain provider.ts's providers, configurations, exampleCall and cleanup exports.
```

## 补充行为参考

本包根入口提供 file 参数契约、动态 JSON Schema、传输归一化、校验、manifest、操作路由、运行时 Skill、Office 文档模型和 MIME 注册表。/node 包含产物路径校验、元数据、URL 映射、唯一命名与哈希；限流下载、同源并发、缓存、重试、取消；LibreOffice/UNO Python 发现；可注入转换和预览；JavaScript/Python Office worker；主题化 Word/PPT/Excel 语义模板；DOCX 结构检查、DOCX/XLSX/PPTX 生成、源代码和产物校验、预览及附件文本提取。默认使用本地 LibreOffice 转换，也能注入远程转换器。

图示设计参考通过 manifest 发布五个可选 Skill：`system-file-diagram-design`、`system-file-diagram-structure`、`system-file-diagram-process`、`system-file-diagram-time`、`system-file-diagram-data`。主 Skill 按需求路由，宿主以准确 ID 读取；全文不塞进主 Skill，不给普通文件操作增加读取门禁。此功能复用 JavaScript/UNO 和文件校验，不增加 HTML 转 Office、绘图 API、字体依赖或固定主题。当前随包许可文件见 [licenses/](licenses/)。

`write(fileName, content)` 原样发布 UTF-8，包括缩进、换行、尾部空白、空文件，内容最多 1,000,000 字符。适用 Markdown/TXT/HTML/JS/CSS/JSON/YAML/CSV/SVG 和其他文本后缀，不执行代码；二进制格式应使用生成器。每次写入创建不可变产物，返回 artifactId 和下载 URL。

读取区分 `list`（草稿）、`readSource(documentId)`（生成代码）、`readContent(artifactId 或 attachmentId)`（发布/上传文件内容）。内容默认 8,000 字符，offset/limit 以字符计数，较小 limit 会生效；预览须显式 includeVisuals。Excel 可用 sheet 与 A1 range，多工作表时 range 必须带 sheet，最多 100,000 单元格。PDF 用从 1 开始的 contentPages，DOCX 用唯一且准确的 section 标题；歧义标题报错。pages 仍表示视觉预览范围。offset 在选取后的内容内计数。

文本提取缓存以 SHA-256、解析器版本和内容选择为键，仅改变 offset/limit 可复用。worker 默认保温 30 秒；CPU_WORKER_COUNT、MAX_QUEUED、QUEUE_TIMEOUT_MS、TASK_TIMEOUT_MS、MAX_FILE_BYTES、MAX_HEAP_MB、TEXT_CACHE_BYTES、IDLE_TIMEOUT_MS 均使用完整 CPU_WORKER_ 前缀配置。排队支持取消，运行槽位在 worker 清理完成后释放；worker 随 runtime/ 发布。UNO/JavaScript 编写、草稿锁、同源下载也使用有界可取消队列。

`createNodeFileDownloadReceiver` 接收真实浏览器下载流，保存到该 run 的 downloads/，不重新请求 URL。默认 readContent 只读取当前 run 的产物和注册附件，可由宿主 readFile 覆盖。readSource 只返回一份源码、位置、摘要、校验状态和诊断计数；includeDiagnostics 读取已保存诊断，不重跑校验。summary 是简短标签，不重复序列化 data。Calc 对同一单元格/范围、格式、行高、列宽的更新可复用元素 ID，新对象或不同目标仍检查冲突。

源码与内容 ID 混用会报错，reason 不改变路由。当前传输边界仍可将旧 read 归一化到 readSource/readContent，旧宿主 read handler 仍存在；新接入应使用明确操作名。草稿/渲染结果含 sourceRead，发布产物含 contentRead，宿主注册表和压缩摘要中应保留区别。修复流程是 readSource → edit → render，不应为重复读取而重新生成。

edit 使用当前 patchBaseDigest，支持精确 replacements 或 Codex patch。所有目标基于同一原始快照，必须唯一且不重叠，可用源码单元路径限定；不模糊匹配空格标点。整批修改原子提交，冲突给出 failed/blocked 且 changed=false、saved=false。旧版本直接拒绝；仅“最新请求与结果版本完全一致”的持久回执可去重，发现新文本不能证明修改已发生。校验失败的源码仍可编辑，saved=true 不等于 validation=passed，结果保留新 digest 与历史部分修改冲突信息。

UNO API 优先匹配准确的带版本/无版本模块 ID；未知版本返回模块索引。关键词检索忽略数字版本并要求所有关键词匹配。目录缓存含 worker digest，元数据写入使用文档锁。

新 Office 可使用语义 spec；默认布局控制字体、边距、图片包含、长文本/表格分页、重复表头、表格列宽/冻结标题/打印布局。plan 返回 semanticGeneration.available 才表示可用，是否选择还应遵循 recommended。原创设计可在 plan.design 中给出 mode=bespoke、受众、目标、2–3 个方向（id/concept/composition/typography/imagery）、selectedDirection、selectionReason、rhythm；绑定用户 reference 时可只有一个方向，preserve/avoid 记录约束。template 模式适合常规快速文档，其预设视觉参数可修改。

设计简报会校验并随草稿保存，plan 和紧凑模型结果保留 designGuidance。bespoke 推荐从空白版面用自定义 program、grid/stack、内容驱动几何编写，仍进行边界、原生对象、字体与渲染校验，不强制换引擎或固定主题。先确定代表性构图，在首次有效渲染中核对，再扩展并复用同一草稿；若功能校验要求完整文档，不强行提交局部原型。最终检查所有页，bespoke 增加 deckReview.checks.designIntent 与 compositionRhythm。这是有证据的模型评审，不是自动审美打分。一致性不要求每页布局相同或变化数量达标。

对已编写工作区重新 plan 是幂等的，不覆盖简报或源码。有界源码读取不重复简报，完整 readSource 可在压缩后恢复。修改现有文件默认保留原设计，除非用户要求重设计。视觉不可用时 Schema 去掉 visualIndex/visualRead/visualReport 及视觉参数。宿主可注入附件、视觉读取、URL、下载、转换、预览和存储。

`webpilot-file-mcp` 为 stdio 入口，目录配置 CAPABILITY_FILE_ARTIFACTS_DIR 或 ARTIFACTS_DIR。Office worker 默认来自发布包 runtime/；可用 CAPABILITY_FILE_RUNTIME_DIR 覆盖运行目录，LIBREOFFICE_UNO_PROGRAM_WORKER_PATH 覆盖 Python worker。
