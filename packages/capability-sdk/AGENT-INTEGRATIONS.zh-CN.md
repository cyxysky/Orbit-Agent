# Agent 接入指南

本指南覆盖自有 agent、Codex、Cursor、Claude Code、OpenAI Agents SDK、Responses API 和 Vercel AI SDK。工具安装一次；不同 agent 选择 MCP 或进程内调用入口。

**版本说明：本文适用于 0.3.0 及后续兼容版本。统一 CLI、分组配置、单一 browser 工具、`/local`、`/openai` 和 MCP 可视化均从 0.3.0 提供，0.2.1 不包含这些功能。**

## 选择接入方式

| 使用方 | 接入方式 | 谁执行工具 |
| --- | --- | --- |
| Codex、Cursor、Claude Code | 本地 stdio MCP | 客户端启动的本地 Node 进程 |
| 自有 agent / 任意支持 MCP 的框架 | MCP client 连接同一个 stdio 入口 | 本地 Node 进程 |
| OpenAI Agents SDK（JavaScript/TypeScript） | `/local` + `/openai`，注册 function tools | 你的 agent 进程 |
| OpenAI Responses API | `/openai` 返回 function 定义及调用分发器 | 你的 agent 进程 |
| Vercel AI SDK | `/local` + 已有 `/ai-sdk` | 你的 agent 进程 |

使用本地 function tools 不会创建 OpenAI 沙盒。模型请求仍发往你配置的模型服务，工具参数和回填结果进入该模型请求；Chromium、Office、终端等在你的机器执行。MCP 本身也不需要模型密钥。

## 共用项目配置

在已安装依赖的项目根目录运行：

```sh
npx --no-install capability-mcp init config
npx --no-install capability-mcp --describe-config
npx --no-install capability-mcp --list
```

`capability.config.json` 按 `tools.browser`、`tools.terminal` 等分组。MCP 和原生 `/local` 使用相同文件，完整字段、默认值、单位、限制和环境变量优先级见 [配置参考](MCP-CONFIG.zh-CN.md)，机器可读版本为 [JSON Schema](mcp-config.schema.json)。修改后重启 MCP，原生模式则 dispose 后重新创建本地 host。

运行环境保存在 `<项目>/.capability-sdk/<平台>-<架构>`；产物和知识库默认在 `<项目>/.capability-sdk/mcp`。客户端配置的工作目录和 `--project` 必须指向安装依赖的项目。不要对其他客户端照搬 Cursor 的 `${workspaceFolder}`。

Windows 默认有 8 个工具：`browser`、`terminal`、`codeSandbox`、`file`、`chart`、`knowledge`、`media`、`computer`。Linux 没有内置桌面驱动时默认 7 个。工具中的 `action` 表示不同操作，浏览器 `open/code/snapshot/close` 均属于一个 `browser`。`--tools` 或 `enabled:false` 会减少实际工具数量；`--list` 显示候选组而非当前运行服务的最终工具列表。

地图可通过 `tools.maps.enabled` 启用，地点示意无需密钥，在线底图、搜索和路线需要对应密钥；数据库、企业连接和通信需要主机提供服务配置。敏感数据检测是独立中间件，不会因启动 MCP 而自动拦截所有输入。媒体默认支持检查和抽帧，OCR、转录和生成必须提供对应 operations。

## Cursor

```sh
npx --no-install capability-mcp init cursor
```

生成并合并项目 `.cursor/mcp.json`，保留其他服务；然后在 Cursor 的 MCP 设置启用 `capability-sdk`。无需另开终端启动服务器。等价配置：

```json
{
  "mcpServers": {
    "capability-sdk": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/node_modules/@cjfclonedeep/capability-sdk/scripts/mcp.mjs",
        "--project",
        "${workspaceFolder}"
      ]
    }
  }
}
```

项目路径变量、配置位置和 stdio 类型依据 [Cursor 官方 MCP 文档](https://cursor.com/docs/mcp)。

## Codex

在项目根目录用 PowerShell 注册：

```powershell
$projectDir = (Get-Location).Path
$entry = Join-Path $projectDir 'node_modules/@cjfclonedeep/capability-sdk/scripts/mcp.mjs'
codex mcp add capability-sdk -- node "$entry" --project "$projectDir"
codex mcp list
```

Linux/macOS 的同类命令：

```sh
codex mcp add capability-sdk -- node "$PWD/node_modules/@cjfclonedeep/capability-sdk/scripts/mcp.mjs" --project "$PWD"
```

也可直接编辑 `~/.codex/config.toml`，或受信任项目的 `.codex/config.toml`。下面以当前 Windows 测试项目为例，换项目时替换路径：

```toml
[mcp_servers.capability-sdk]
command = "node"
args = ['C:\Users\18367\Desktop\test\capability-sdk-consumer-test\node_modules\@cjfclonedeep\capability-sdk\scripts\mcp.mjs', '--project', 'C:\Users\18367\Desktop\test\capability-sdk-consumer-test']
cwd = 'C:\Users\18367\Desktop\test\capability-sdk-consumer-test'
startup_timeout_sec = 30
tool_timeout_sec = 300
```

TOML 单引号字符串中的反斜杠无需转义。Office 操作可能超过客户端默认的 60 秒工具超时，这里设置为 300 秒；工具自己的超时仍由分组配置决定。

Codex 图形设置的「启动命令」填写 `node`；「参数」分三行填写入口绝对路径、`--project`、项目绝对路径；「工作目录」填写项目绝对路径。不需要密钥时环境变量留空。若 `node` 不在客户端 PATH 中，启动命令改为 `node.exe` 的绝对路径。重新加载服务或开启新会话，通过 `/mcp` 查看状态。

配置字段、作用域和命令依据 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)。同一个项目不要同时注册重复的全局和项目服务。

## Claude Code

PowerShell，在项目根目录运行：

```powershell
$projectDir = (Get-Location).Path
$entry = Join-Path $projectDir 'node_modules/@cjfclonedeep/capability-sdk/scripts/mcp.mjs'
claude mcp add --transport stdio --scope project capability-sdk -- node "$entry" --project "$projectDir"
claude mcp list
```

Linux/macOS：

```sh
claude mcp add --transport stdio --scope project capability-sdk -- node "$PWD/node_modules/@cjfclonedeep/capability-sdk/scripts/mcp.mjs" --project "$PWD"
```

CLI 自身的选项位于 `--` 之前，Node 和服务参数在其后。`--scope project` 保存到项目 `.mcp.json`；启动 Claude Code 后按客户端提示启用项目 MCP，用 `/mcp` 检查连接。也可手工创建：

```json
{
  "mcpServers": {
    "capability-sdk": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:/Users/18367/Desktop/test/capability-sdk-consumer-test/node_modules/@cjfclonedeep/capability-sdk/scripts/mcp.mjs",
        "--project",
        "C:/Users/18367/Desktop/test/capability-sdk-consumer-test"
      ]
    }
  }
}
```

绝对路径属于当前机器，提交共享配置前应按团队环境调整。作用域和命令依据 [Claude Code 官方 MCP 文档](https://code.claude.com/docs/en/mcp)。

## 自有 agent：通用 MCP client

若框架已经有 MCP client，传入上述 `command/args/cwd` 即可。否则需要在业务项目安装 MCP **客户端**库；这与 capability-sdk 已包含全部工具执行依赖是两回事：

```sh
npm install @modelcontextprotocol/client
```

```js
// own-agent-mcp.mjs，在安装依赖的项目根目录运行
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = process.cwd();
const client = new Client({ name: 'my-agent', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'node_modules/@cjfclonedeep/capability-sdk/scripts/mcp.mjs'), '--project', root],
  cwd: root,
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const instructions = client.getInstructions() || '';
  // 将 instructions 交给模型，保留服务的运行技能说明。
  // 将 name/description/inputSchema 注册给你使用的模型或框架。
  console.log(tools.map(tool => tool.name));
  const result = await client.callTool({
    name: 'terminal',
    arguments: { action: 'run', reason: '检查接入', command: 'echo MCP_OK', yieldMs: 1000 },
  });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  console.log(result.structuredContent ?? result.content);
} finally {
  await client.close();
}
```

模型调用时，按返回的工具名路由 `callTool`，将结果回填到**对应的模型 tool call ID**。保留 `content` 中的图片，不要只取第一段文本。保留服务器的 instructions/运行技能；这些内容说明浏览器会话、Office 草稿和产物的正确调用顺序。长操作需要同时设置框架的 MCP 请求超时。

不要让 stdout 输出业务日志，它承载 MCP JSON-RPC；日志输出到 stderr。HTTP 部署、鉴权、自定义业务 providers 见 [高级 MCP 装配](MCP.zh-CN.md)；本地 CLI 是 stdio 服务，不是可直接交给云端 Responses `type:mcp` 的 URL。

## OpenAI Agents SDK 原生接入

业务 agent 使用官方框架时安装其自身依赖：

```sh
npm install @openai/agents
```

```js
// native-agent.mjs
import { Agent, run, tool } from '@openai/agents';
import { createLocalCapabilities } from '@cjfclonedeep/capability-sdk/local';
import { toOpenAIAgentsTools } from '@cjfclonedeep/capability-sdk/openai';

if (!process.env.OPENAI_MODEL) throw new Error('请通过环境变量设置 OPENAI_MODEL');
const local = await createLocalCapabilities();
try {
  const agent = new Agent({
    name: 'My local agent',
    model: process.env.OPENAI_MODEL,
    instructions: local.instructions,
    tools: toOpenAIAgentsTools(local.snapshot, tool, { resolveImage: local.resolveImage }),
  });
  const result = await run(agent, '运行终端输出 hello，并告诉我结果', { maxTurns: 10 });
  console.log(result.finalOutput);
} finally {
  await local.dispose();
}
```

从项目根目录启动，`OPENAI_API_KEY` 由官方框架读取。API 密钥放环境变量或业务密钥管理系统；`OPENAI_MODEL` 选择账号可用的模型。adapter 接收官方 `tool` 工厂，不捆绑另一份 Agents SDK，也不打开 MCP 端口。

`createLocalCapabilities({tools:['browser','terminal']})` 可限制工具组；默认读取所有已启用的本地工具。可传 `configFile`、`context.runId/sessionId/userId/abortSignal`。`projectRoot` 必须与进程 cwd 一致；多项目宿主使用独立进程，避免进程级运行时路径冲突。结束时使用返回的 `local.dispose()` 释放工具和本地运行资源，重复调用安全。

Adapter options 支持 `policy`（SDK 权限与前置条件处理器）、`abortSignal`、`metadata`、`execute`（业务执行钩子）、`responseSession`、`resolveImage`；Agents 模式还支持 `formatResult` 自定义回填。`execute` 获得已验证 input、context 和 `invoke()`；调用 `invoke()` 执行真实工具。它适合业务审计或基于参数的授权，不会自动替你设计企业业务权限。

工具以 `strict:false` 注册，保留原有可选参数；动作联合 schema 转为顶层 object，实际执行前仍经过原始 parser 校验。Agents SDK 非 strict 的顶层参数类型要求 `additionalProperties:true`，原始工具 parser 仍会按工具规则拒绝未知字段。技能默认以 eager instructions 提供，不额外注册 skill 工具。图片自动作为官方框架的 image 内容返回，产物元数据保留在文本结果中。

此处是官方框架的 **function tools** 接口，见 [Agents SDK 工具文档](https://openai.github.io/openai-agents-js/guides/tools/)。不替换框架的模型循环、记忆或会话管理。

## OpenAI Responses API 原生接入

```sh
npm install openai
```

```js
import OpenAI from 'openai';
import { createLocalCapabilities } from '@cjfclonedeep/capability-sdk/local';
import { toOpenAIResponsesTools } from '@cjfclonedeep/capability-sdk/openai';

if (!process.env.OPENAI_MODEL) throw new Error('请设置 OPENAI_MODEL');
const client = new OpenAI();
const local = await createLocalCapabilities();
const adapter = toOpenAIResponsesTools(local.snapshot, { resolveImage: local.resolveImage });
const input = [{ role: 'user', content: '用终端输出 hello' }];
try {
  for (let step = 0; step < 10; step++) {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL,
      instructions: local.instructions,
      tools: adapter.tools,
      input,
      store: false,
      include: ['reasoning.encrypted_content'],
    });
    // 保留全部输出，包括 reasoning 等非 function 项。
    input.push(...response.output);
    const calls = response.output.filter(item => item.type === 'function_call');
    if (!calls.length) {
      console.log(response.output_text);
      break;
    }
    for (const call of calls) input.push(await adapter.executeCall(call));
    if (step === 9) throw new Error('达到本次业务 agent 的调用轮数上限');
  }
} finally {
  await local.dispose();
}
```

`adapter.tools` 是可以直接交给 Responses 的 function 定义；`executeCall` 解析 arguments、执行权限处理及原始输入校验、调用本地工具，并用原 `call_id` 生成 `function_call_output`。有截图时返回 input_text + input_image 内容。`adapter.invoke(name,input,execution?)` 可交给其他自有循环使用，返回原始 CapabilityResult。输入错误、未知工具和权限处理器异常由宿主捕获；工具返回的 `ok:false` 保留为业务结果。生产循环应自行决定重试、错误展示和恢复策略，避免重复执行有副作用的工具。

手动维护 reasoning 模型的历史时还需遵循所选模型的加密 reasoning 回放要求，或使用官方 SDK 的会话管理；上面是基础调用循环。Responses 的 `strict:false`、函数定义与回填形式依据 [官方 function calling 文档](https://developers.openai.com/api/docs/guides/function-calling)。本包已有 `/responses` 是结构化内容协议，**OpenAI 接入入口是 `/openai`**。

## Vercel AI SDK

已有 `ai` 业务项目可以直接复用本地 host：

```js
import { createLocalCapabilities } from '@cjfclonedeep/capability-sdk/local';
import { toAISDKToolSet } from '@cjfclonedeep/capability-sdk/ai-sdk';
const local = await createLocalCapabilities({ tools: ['terminal', 'code'] });
try {
  const tools = toAISDKToolSet(local.snapshot);
  // 交给你的 streamText/generateText/ToolLoopAgent，同时提供 local.instructions。
  // await runYourAgent({ tools, instructions: local.instructions });
} finally {
  await local.dispose();
}
```

需要自定义数据库、地图和企业 providers 时，使用 `/host` 的 `mountCapabilities()`，再把 snapshot 交给 `/ai-sdk` 或 `/openai`，参见 [宿主接口](HOST.zh-CN.md)。

## 排错与验证范围

- 工具名仍有 `browser.open`：客户端加载了旧脚本或旧包。检查实际启动入口，更新到包含合并实现的版本并重启服务。
- 只有少数工具：检查 `--tools`、JSON 的 `enabled`、平台支持和客户端缓存；检查连接后 `tools/list` 的实际输出。
- Office 超时：检查运行环境是否 ready、工具配置和客户端请求超时；不要每次连接都重新安装运行环境。
- `file download` 不能读操作系统路径：下载操作接受 HTTP(S)/页面相对 URL；本地文件由宿主绑定附件，或通过终端/代码工具读取。`file write` 用于发布精确文本，`readContent` 使用返回的 artifactId。
- `terminal read/write` 输出是增量；`stop` 返回 `terminal-cancelled` 表示主机取消成功。JavaScript 代码运行环境是 ESM。图表 update 需要 option 和 expectedRevision。
- chart/maps 已提供 MCP Apps 页面和本机浏览器预览链接，二维 ECharts 还返回 PNG；是否内嵌显示由客户端决定。配置、生命周期和地图密钥见 [MCP 可视化说明](MCP-UI.zh-CN.md)。原生 function adapter 的展示仍需业务 UI 接入 renderer。

本地 Windows 验证覆盖默认 8 工具、Office/UNO/Python/FFmpeg/三模型运行、真实 SQLite、MCP 通信以及官方 Agents SDK 0.18.0 的本地工具循环。Google、企业 webhook、外部 MCP 和模型响应使用模拟接口验证；未完成真实外部服务、Linux 实机以及各客户端 UI 的端到端验证。详细证据见 consumer 项目的 `artifacts/tools-audit/`，不能把协议测试理解为所有业务集成已在生产服务通过。
