# @cjfclonedeep/capability-sdk/execution/terminal

[English](TERMINAL.md) | [简体中文](TERMINAL.zh-CN.md) | [日本語](TERMINAL.ja.md)

本指南描述 `@cjfclonedeep/capability-sdk@0.2.1` 的子入口，不再是独立 npm 包。工具包已包含这些示例所需的工具依赖。

框架无关的本地终端能力包，无需模型、云端沙箱或 Agent Loop。Node 驱动使用运行 Agent 服务的机器及其操作系统账户权限；通过网页连接服务器时，命令运行在服务器，不在访问网页的用户电脑上。

## 安装与首次调用

使用相互匹配的 0.1.0 工作区包或发布版本。以下文件创建在使用方项目中，package.json 设置 type=module；示例无需模型/API Key。

```sh
npm install @cjfclonedeep/capability-sdk
npm install -D typescript tsx @types/node
```

```ts
// terminal.ts — Node >=22.16, ESM TypeScript
import { randomUUID } from 'node:crypto';
import { mountCapabilities } from '@cjfclonedeep/capability-sdk/host';
import { createCapabilityExecutor } from '@cjfclonedeep/capability-sdk';
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';

const mounted = await mountCapabilities({
  providers: [createNodeTerminalCapability({ cwd: process.cwd() })],
  context: { runId: randomUUID() },
  configurations: {
    'com.webpilot.terminal': { AGENT_TERMINAL_ENABLED: 'true' },
  },
});
// This single-user example grants terminal execution explicitly.
// A shared host supplies its authenticated user's permission policy.
const execute = createCapabilityExecutor({
  authorize(permissions) {
    if (permissions.some(permission => permission !== 'process:terminal')) {
      throw new Error('Permission denied.');
    }
  },
});
const resolved = mounted.tools.terminal;
async function call(raw: unknown) {
  const input = resolved.tool.input.parse(raw);
  return execute(resolved, { invocationId: randomUUID() },
    context => resolved.tool.execute(input, context));
}
try {
  console.log(mounted.skillCatalog.instructions('eager'));
  let result = await call({
    action: 'run', reason: 'Inspect the local working directory',
    command: process.platform === 'win32' ? 'Get-Location' : 'pwd',
    yieldMs: 1000,
  });
  console.log(result);
  while (result.ok && (result.data as { status: string }).status === 'running') {
    result = await call({
      action: 'read', reason: 'Collect remaining command output',
      sessionId: (result.data as { sessionId: string }).sessionId, yieldMs: 1000,
    });
    console.log(result);
  }
  if (!result.ok) throw new Error(result.error.message);
} finally {
  await mounted.dispose();
}
```

```sh
npx tsx terminal.ts
```

## 工具操作

- `run`：command，及可选 cwd、stdin、keepStdinOpen、timeoutMs、yieldMs。每次启动新 Shell，相对 cwd 基于配置目录解析。工作目录不是文件系统隔离边界。
- `read`：sessionId 和可选 yieldMs，返回上次读取之后新增的 stdout/stderr、状态、退出码、退出信号和截断标记。
- `write`：sessionId、stdin 和可选 closeStdin、yieldMs。需要后续输入时，run 设置 keepStdinOpen=true；默认 run 写入初始输入后关闭 stdin。
- `stop`：sessionId，终止进程树并等待退出。

所有操作必须提供 reason。yieldMs 范围 0–10000，默认 1000；run 返回 running 时用 read 收集后续输出，不要重复执行原命令。非零退出、超时和取消返回 ok=false，完整 TerminalResult 位于 error.details；运行中和成功结果位于 data。

## 生命周期与执行边界

auto 在 Windows 使用 Windows PowerShell，在其他系统使用 Bash。宿主也可选择 powershell、pwsh、bash、sh，需预先安装。Windows 进程隐藏窗口，不加载 Shell profile。使用标准输入输出管道，不提供 PTY，不支持要求 TTY 的交互程序或全屏终端应用；不同 run 之间不保留 cd、变量等状态。

run/read/write/stop 必须复用同一能力运行实例。dispose、取消和超时会终止对应进程树。Orbit 在一轮 Agent 执行结束时释放实例，因此不能依赖进程跨轮次或重启继续运行。stdout/stderr 各使用输出预算的一半；超出上限保留尾部并标记 truncated，不因此终止命令。最多保留 64 个会话记录，优先淘汰最早结束的记录。

## 配置

Windows 仅支持 powershell/pwsh。Shell 执行用户命令前加入 Windows Job，确保退出时终止子进程；若无法加入 Job，命令不会执行。PowerShell 原生命令仍遵循其参数引用规则，复杂嵌套引号建议改用脚本文件。

| Key | Default |
| --- | --- |
| `AGENT_TERMINAL_ENABLED` | `false` |
| `AGENT_TERMINAL_CWD` | application cwd |
| `AGENT_TERMINAL_SHELL` | `auto` |
| `AGENT_TERMINAL_TIMEOUT_MS` | `120000` |
| `AGENT_TERMINAL_MAX_OUTPUT_CHARS` | `50000` |
| `AGENT_TERMINAL_MAX_PROCESSES` | `4` |

设置在重新挂载后生效。工厂显式 cwd 优先于 AGENT_TERMINAL_CWD。直接使用 createNodeTerminalOperations 的宿主自行管理授权和清理。env 只能由宿主注入；省略时继承服务进程环境。

## 接入 Agent

将 tool.input.jsonSchema 转成模型的参数 Schema，调用前执行 input.parse，并共用 createCapabilityExecutor 处理权限和串行分组。将 Skill 指令交给模型；宿主处理用户身份、操作审批与取消。Orbit 在“工具能力 → 本地终端”中配置，run/write 接入现有执行审批流程。

AI SDK 使用方把 Provider 和配置传给 @cjfclonedeep/capability-sdk/ai-sdk 的 mountAISDKCapabilities，再将 agentOptions 交给自己的 Agent。全部工具执行结束后再释放。核心和 Node 入口不依赖 AI SDK。

公开入口包括根入口的 Provider/契约、/node 工厂、/settings 设置、/runtime-skill 指令、/mcp 适配。完整进程服务示例见 [MCP 接入](TERMINAL-MCP.zh-CN.md)。
