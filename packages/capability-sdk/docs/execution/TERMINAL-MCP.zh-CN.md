# 通过 MCP 使用本地终端

按 [README](TERMINAL.zh-CN.md) 安装 @cjfclonedeep/capability-sdk/execution/terminal、对应 SDK/host 和 tsx。在使用方 ESM 项目保存 server.ts。本示例显式允许单用户执行本地终端命令。

本指南描述 `@cjfclonedeep/capability-sdk@0.2.1` 的子入口，不再是独立 npm 包。工具包已包含这些示例所需的工具依赖。

```ts
// server.ts
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';
import { serveTerminalMcpStdio } from '@cjfclonedeep/capability-sdk/execution/terminal/mcp';

serveTerminalMcpStdio({
  provider: createNodeTerminalCapability({ cwd: process.cwd() }),
  configurations: {
    'com.webpilot.terminal': { AGENT_TERMINAL_ENABLED: 'true' },
  },
  skillMode: 'eager',
  policy: {
    authorize(permissions) {
      if (permissions.some(permission => permission !== 'process:terminal')) {
        throw new Error('Permission denied.');
      }
    },
  },
});
```

```sh
npx tsx server.ts
```

```json
{
  "mcpServers": {
    "terminal": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/server.ts"]
    }
  }
}
```

客户端工作目录应设为项目目录，server.ts 使用绝对路径。Windows 客户端需要可执行文件名时使用 npx.cmd。标准输出保留给 MCP，诊断日志写入 stderr。

服务暴露 terminal 的 run/read/write/stop 操作。把服务指令和完整结构化结果传给模型，整个进程交互共用同一服务/运行实例。客户端为 run/write 接入操作审批；权限钩子不检查命令参数。共享服务还需可信用户身份及服务端操作授权。

createTerminalMcpServer 返回未连接的服务器；createTerminalMcpHandler 返回 HTTP Handler，不会监听端口。便捷 HTTP Handler 按请求管理生命周期，不能保留进程会话。有状态 HTTP 需为每个鉴权后的 MCP 会话创建并保留一个服务器，断开时 close 以终止进程。监听服务示例见 [有状态 HTTP 教程](../../../capability-sdk/docs/adapters/MCP-ADAPTER-MCP.zh-CN.md)。适配器不会自动鉴权、隔离系统或托管文件。
