# @cjfclonedeep/capability-sdk

[English](TOOLS.md) | [简体中文](TOOLS.zh-CN.md) | [日本語](TOOLS.ja.md)

All tool capabilities and their npm dependencies. Import the subpath for the capability you need.

```sh
npm install @cjfclonedeep/capability-sdk@0.2.1
```

All npm dependencies are included. The root exposes contracts and execution without eagerly importing tool implementations or framework adapters. Normal npm installation also prepares the supported Windows/Linux execution runtimes through postinstall. [Runtime](RUNTIME.md)

| Entry | Guide |
| --- | --- |
| `/browser` | [Browser sessions](docs/browser/README.md) |
| `/chart` | [Charts and renderers](docs/chart/README.md) |
| `/maps` | [Maps](docs/maps/README.md) |
| `/file` | [Files and Office](docs/file/README.md) |
| `/execution` | [Code and terminal](docs/execution/README.md) |
| `/integrations` | [Connectors and communication](docs/integrations/README.md) |
| `/knowledge` | [Knowledge retrieval](docs/knowledge/README.md) |
| `/data` | [Structured data](docs/data/README.md) |
| `/media` | [Media](docs/media/README.md) |
| `/computer` | [Desktop control](docs/computer/README.md) |
| `/sensitive-data` | [Sensitive-data filtering](docs/sensitive-data/README.md) |

[Automatic runtime setup](RUNTIME.md) · [SDK](README.md)

## Local terminal MCP server

Save as server.mjs in a Node.js >=22.16 project. An MCP client starts it using node server.mjs over stdio. This example explicitly enables local terminal execution. Do not log to stdout, which is reserved for the MCP protocol.

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

These entrypoints target version 0.2.1. Earlier separately published packages remain separate releases. To migrate source imports, replace the old package with its new subpath; install package roots, never subpaths.
