# 一条命令接入 MCP

Codex、Cursor、Claude Code、自有 agent 的完整配置，以及不经过 MCP 的 OpenAI 原生接入，见 [Agent 接入指南](AGENT-INTEGRATIONS.zh-CN.md)。

[English](MCP-CLI.md) | [简体中文](MCP-CLI.zh-CN.md)

统一 CLI 从 0.3.0 起随本包提供，不需要编写 `mcp-server.mjs`，也不需要额外安装 TypeScript、tsx 或 MCP 适配器。

## Cursor

在使用方项目根目录运行：

```sh
npm install @cjfclonedeep/capability-sdk
npx --no-install capability-mcp init cursor
```

已有依赖时只需第二条命令。命令会生成 `.cursor/mcp.json`，保留其他服务与配置；重复执行相同配置不会改写文件。已有不同的 `capability-sdk` 配置时会报错，留给使用方明确修改。`init` 不安装运行环境，也不启动工具。

工具配置统一放在项目根目录的 `capability.config.json`，`init cursor` 会创建缺少的该文件。Codex 等其他客户端可运行 `capability-mcp init config` 单独生成配置。启动自动读取，完整字段、默认值、范围、优先级和示例见 [按工具配置参考](MCP-CONFIG.zh-CN.md)。模型可执行 `capability-mcp --describe-config` 获取带说明的 JSON Schema。

在 Cursor 的 MCP 设置里启用 `capability-sdk`。Cursor 会启动项目中安装的服务；无需另开终端常驻进程，也不会通过 npx 下载另一份依赖。项目配置和 `${workspaceFolder}` 变量见 [Cursor 官方文档](https://cursor.com/docs/mcp)。生成的内容是：

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

如果 GUI 找不到 Node，可将 `command` 改为 Node 可执行文件的绝对路径。使用 Node.js >=22.16。

## 其他 MCP 客户端

客户端配置启动命令 `node`，参数为本项目的 `node_modules/@cjfclonedeep/capability-sdk/scripts/mcp.mjs` **绝对路径**、`--project`、**项目绝对路径**。不同客户端的配置结构不同；`${workspaceFolder}` 是 Cursor 变量，不应原样复制到其他客户端。

手动启动的等价命令：

```sh
npx --no-install capability-mcp --project .
```

这是 stdio 服务，启动后等待 MCP 请求，不是交互式终端。客户端负责模型、工具决策和工具调用；本服务不要求模型 API Key。跨机器连接使用 [自定义 HTTP 服务](MCP.zh-CN.md)；本 CLI 提供本地 stdio。

## 默认工具和路径

| 工具组 | 默认能力 |
| --- | --- |
| `browser` | 一个 `browser` 工具，通过 `action=open/code/snapshot/close` 管理会话，默认无头 Chromium |
| `terminal` | `terminal`，以项目根目录为工作目录 |
| `code` | `codeSandbox`，本地 JavaScript/Python 执行 |
| `file` | `file`，文件下载、写入、Office 生成与转换 |
| `chart` | `chart`，图表创建、读取与更新 |
| `knowledge` | `knowledge`，项目内持久化知识库 |
| `media` | `media`，本地媒体检查、视频抽帧 |
| `computer` | `computer`，Windows 桌面控制；其他平台配置 `AGENT_COMPUTER_ENDPOINT` 后可用 |

默认挂载当前平台可用的上述工具。Windows 为 8 个 MCP 工具入口。`--list` 显示可选组和平台默认组；可用 `--tools browser,terminal,file` 缩小范围，再由 JSON 的 enabled 字段过滤。配置生成也接受相同参数，例如 `capability-mcp init cursor --tools browser,file`。

运行时定位在导入工具之前完成，和启动客户端的工作目录无关：

```text
项目/.capability-sdk/<平台>-<架构>/  Chromium、Python、LibreOffice、FFmpeg、模型
项目/.capability-sdk/mcp/artifacts/  文件、图表、媒体、桌面截图
项目/.capability-sdk/mcp/code/       代码执行工作区
项目/.capability-sdk/mcp/knowledge/  知识库
```

项目目录按 `--project`、`CAPABILITY_PROJECT_DIR`、当前目录的顺序选择。显式 `CAPABILITY_RUNTIME_HOME` 仍可覆盖运行环境目录。请将 `.capability-sdk/` 加入项目 `.gitignore`。CLI 启动不会重复安装大型运行环境；未安装或安装未完成时，在项目中运行 `npx --no-install capability-runtime doctor` / `install`。

没有被 JSON 显式设置覆盖时，工具的环境变量配置仍然有效。优先使用 `tools.browser.headless=false` 显示浏览器、`tools.terminal.enabled=false` 隐藏终端工具。默认启用本地代码、终端和受支持的计算机工具。本地终端/代码以当前用户权限运行；`--project` 用于路径定位，不提供操作系统隔离。

敏感数据三个模型是模型中间件，不会因启动 MCP 自动拦截 Cursor 的模型请求。媒体 OCR、语音转写/生成、图片/视频生成，以及数据库、企业通信和外部系统连接，需要对应的业务实现或凭据；默认本地服务不会虚构这些配置。

## 扩展业务工具

现有 SDK 的所有 Provider 仍可挂载。用显式 `--config ./capability.mcp.mjs` 提供 MCP 选项或异步工厂：

```js
import { createBusinessProvider } from './your-business-provider.mjs';

export default ({ projectRoot, stateDirectory, providers }) => ({
  providers: [...providers, createBusinessProvider({ projectRoot })],
});
```

配置文件路径相对于项目根目录。工厂收到默认 providers 和目录，也可返回 `configurations`、`configStore`、`policy`、`context` 等现有 MCP 选项；`providers` 显式替换默认数组。只使用业务工具时传 `--tools none --config ./capability.mcp.mjs`。不指定 `--config` 就不会扫描或执行项目配置代码。

`--skill-mode lazy` 提供按需读取说明的 `skill` 工具；默认 `eager` 在初始化时提供工具操作说明。自定义代码的日志必须写入 stderr（`console.error`），stdout 专用于 MCP。客户端关闭标准输入或发送退出信号后，CLI 关闭会话和工作进程并退出。
