# @cjfclonedeep/capability-sdk/execution/terminal

[English](TERMINAL.md) | [简体中文](TERMINAL.zh-CN.md) | [日本語](TERMINAL.ja.md)

本指南描述 `@cjfclonedeep/capability-sdk@0.3.0` 的子入口，不再是独立 npm 包。工具包已包含这些示例所需的工具依赖。

框架无关的本地终端能力包，无需模型、云端沙箱或 Agent Loop。Node 驱动使用运行 Agent 服务的机器及其操作系统账户权限；通过网页连接服务器时，命令运行在服务器，不在访问网页的用户电脑上。

## 安装与首次调用

使用相互匹配的 0.3.0 工作区包或发布版本。以下文件创建在使用方项目中，package.json 设置 type=module；示例无需模型/API Key。

```sh
npm install @cjfclonedeep/capability-sdk
npm install -D typescript tsx @types/node
```

```ts
// terminal.ts — Node >=22.16, ESM TypeScript
import { randomUUID } from 'node:crypto';
import type { TerminalResult } from '@cjfclonedeep/capability-sdk/execution/terminal';
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
  const created = await call({ action: 'create', reason: 'Open a reusable terminal', name: 'Workspace' });
  if (!created.ok) throw new Error(created.error.message);
  const terminalId = (created.data as TerminalResult).terminal!.terminalId;
  let result = await call({
    action: 'run', reason: 'Inspect the local working directory', terminalId,
    command: process.platform === 'win32' ? 'Get-Location' : 'pwd', yieldMs: 1000,
  });
  console.log(result);
  while (result.ok && (result.data as TerminalResult).terminal?.status === 'running') {
    result = await call({
      action: 'wait', reason: 'Wait for command completion', terminalId,
      cursor: (result.data as TerminalResult).cursor, yieldMs: 30000,
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

- `create`：可选 name、cwd、cols、rows，创建可复用的 terminalId。`list` 列出现有终端。
- `run`：terminalId、command，以及可选 timeoutMs、yieldMs。同一终端保留目录、Shell 变量和环境变量；忙碌终端拒绝第二条 run。
- `read`：terminalId、可选 cursor，立即读取保留输出，不消耗其他读取者的缓冲。
- `wait`：terminalId、可选 cursor、yieldMs，等待命令结束并返回后续输出。
- `write`：terminalId、input，发送原始交互输入，用 `\r` 表示回车。
- `interrupt`：发送 Ctrl+C；前台命令持续无响应时关闭终端。
- `resize`：cols/rows；`rename`：name。`close` 结束终端及子进程并保留输出；`delete` 同时删除记录。

所有操作需要 reason。yieldMs 范围 0–30000，只限制本次调用的等待时间，不限制命令寿命。running 不代表成功；只有 command.status=succeeded 且 command.exitCode=0 才表示成功。run/wait 失败、中断或超时的完整 TerminalResult 位于 error.details。

## 生命周期与执行边界

真正的 PTY 由独立原生宿主进程持有，支持交互输入、ANSI 输出和窗口缩放。auto 在 Windows 使用 Windows PowerShell，在其他系统使用 Bash；可选 powershell、pwsh、bash，Windows 仅支持前两者，不加载 Shell profile。直接调用包管理器，包括 .ps1/.cmd 包装脚本，无需后台脱离或日志文件轮询。

独立 createNodeTerminalCapability 运行实例拥有自己的管理器，dispose 时关闭终端。需要跨模型请求保留终端时，使用包内 createTerminalWorkspaceRegistry：按 userId 和 sessionId 隔离工作空间，capability() 提供不拥有清理权的工具句柄。模型调用、上下文压缩和正常轮次完成不回收终端；用户停止、关闭或删除对话时调用 stop({ ownerId, workspaceId })，关闭终端及其子进程并删除记录，服务关闭时调用 dispose()。重启后不存在的 terminalId 不能恢复，也不会自动重放命令。

Node 管理器提供 subscribe 实时输出和状态事件。Orbit 通过有权限校验的 SSE 接口推送，重新连接补发保留输出。原始输出采用绝对游标，模型读取去除终端控制码；PTY 合并 stdout/stderr，stderr 中的进度信息不代表失败。缓冲超限保留末尾并标记 truncated=true；最多保留 64 个记录，用户可显式删除。timeoutMs=0 不设命令期限，正数期限到达后中断前台命令。

## 配置

Windows 仅支持 powershell/pwsh。Shell 执行用户命令前加入 Windows Job，确保退出时终止子进程；若无法加入 Job，命令不会执行。PowerShell 原生命令仍遵循其参数引用规则，复杂嵌套引号建议改用脚本文件。

| Key | Default |
| --- | --- |
| `AGENT_TERMINAL_ENABLED` | `false` |
| `AGENT_TERMINAL_CWD` | application cwd |
| `AGENT_TERMINAL_SHELL` | `auto` |
| `AGENT_TERMINAL_TIMEOUT_MS` | `0` |
| `AGENT_TERMINAL_MAX_OUTPUT_CHARS` | `50000` |
| `AGENT_TERMINAL_MAX_PROCESSES` | `4` |

Shell 和初始目录对新终端生效，管理器配置更新作用于后续操作。工厂显式 cwd 优先于 AGENT_TERMINAL_CWD。直接使用 createNodeTerminalOperations 的宿主自行管理授权和清理。env 只能由宿主注入；省略时继承服务进程环境。

## 接入 Agent

将 tool.input.jsonSchema 转成模型的参数 Schema，调用前执行 input.parse，并共用 createCapabilityExecutor 处理权限和串行分组。将 Skill 指令交给模型；宿主处理用户身份、操作审批与取消。Orbit 在“工具能力 → 本地终端”中配置，run/write 接入现有执行审批流程。

AI SDK 使用方把 Provider 和配置传给 @cjfclonedeep/capability-sdk/ai-sdk 的 mountAISDKCapabilities，再将 agentOptions 交给自己的 Agent。全部工具执行结束后再释放。核心和 Node 入口不依赖 AI SDK。

公开入口包括根入口的 Provider/契约、/node 工厂、/settings 设置、/runtime-skill 指令、/mcp 适配。完整进程服务示例见 [MCP 接入](TERMINAL-MCP.zh-CN.md)。

## 对话管理器与终端界面

包内 /workspaces 提供管理器，/http 的 terminalHttpResponse 提供操作及 SSE 协议，/client 的 createHttpTerminalClient 连接宿主路由，/react 的 TerminalWorkspace 提供完整界面（新建、切换、重命名、中断、关闭、删除、实时输出和原位输入）。提示符紧跟最后一行输出；收起界面不会关闭终端。宿主只负责认证、工作空间授权、配置及生命周期事件绑定。不要让模型请求级 dispose 清理共享工作空间。
