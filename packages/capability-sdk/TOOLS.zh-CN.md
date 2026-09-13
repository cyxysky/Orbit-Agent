# @cjfclonedeep/capability-sdk

[English](TOOLS.md) | [简体中文](TOOLS.zh-CN.md) | [日本語](TOOLS.ja.md)

全部工具能力及其 npm 依赖，通过各能力子路径导入。

```sh
npm install @cjfclonedeep/capability-sdk@0.2.1
```

npm 依赖全部随包安装。根入口提供契约和执行机制，不会连带加载全部工具与框架适配。正常 npm 安装还会通过 postinstall 自动准备受支持的 Windows/Linux 执行环境。 [Runtime](RUNTIME.zh-CN.md)

| 入口 | 指南 |
| --- | --- |
| `/browser` | [浏览器会话](docs/browser/README.zh-CN.md) |
| `/chart` | [图表与渲染](docs/chart/README.zh-CN.md) |
| `/maps` | [地图](docs/maps/README.md) |
| `/file` | [文件与 Office](docs/file/README.zh-CN.md) |
| `/execution` | [代码执行与终端](docs/execution/README.zh-CN.md) |
| `/integrations` | [连接器与通信](docs/integrations/README.zh-CN.md) |
| `/knowledge` | [知识检索](docs/knowledge/README.zh-CN.md) |
| `/data` | [结构化数据](docs/data/README.zh-CN.md) |
| `/media` | [媒体](docs/media/README.zh-CN.md) |
| `/computer` | [桌面控制](docs/computer/README.zh-CN.md) |
| `/sensitive-data` | [敏感数据过滤](docs/sensitive-data/README.zh-CN.md) |

[Automatic runtime setup](RUNTIME.zh-CN.md) · [SDK](README.zh-CN.md)

## 本地终端 MCP 服务

在 Node.js >=22.16 项目中保存为 server.mjs，由 MCP 客户端通过 node server.mjs 启动 stdio 服务。示例显式开启本地终端执行。标准输出专用于 MCP 协议，不要向 stdout 写日志。

```js
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';
import { serveTerminalMcpStdio } from '@cjfclonedeep/capability-sdk/execution/terminal/mcp';

serveTerminalMcpStdio({
  provider: createNodeTerminalCapability({ cwd: process.cwd() }),
  configurations: {
    'com.webpilot.terminal': { AGENT_TERMINAL_ENABLED: 'true' },
  },
  skillMode: 'eager',
});
```

这些入口对应 0.2.1 版本。此前单独发布的包仍是独立的旧版本。迁移时将原包名替换为新的子入口；安装时使用包名，不要安装子路径。
