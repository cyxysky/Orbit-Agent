# Capability SDK

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

One package for capability contracts, execution, configuration, responses, AI SDK/MCP adapters and all tools.

```sh
npm install @cjfclonedeep/capability-sdk
```

All npm dependencies are included. The root exposes contracts and execution without eagerly importing tool implementations or framework adapters. Normal npm installation also prepares the supported Windows/Linux execution runtimes through postinstall.

| Entry | Purpose |
| --- | --- |
| `@cjfclonedeep/capability-sdk` | Contracts, Registry, Executor |
| `/host`, `/node`, `/typeorm` | Mounting and storage |
| `/responses`, `/responses/react` | Structured responses |
| `/ai-sdk`, `/mcp` | Framework adapters |
| `/browser`, `/file`, `/chart`, `/maps` | Browser and document tools |
| `/execution`, `/integrations`, `/knowledge`, `/data` | Execution and integration tools |
| `/media`, `/computer`, `/sensitive-data` | Media, desktop and sensitive data |
| `/runtime` | Prepared runtime paths |

[SDK](capability-sdk/README.md) · [Tools](capability-sdk/TOOLS.md) · [Runtime](capability-sdk/RUNTIME.md)

```ts
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';
import { serveTerminalMcpStdio } from '@cjfclonedeep/capability-sdk/execution/terminal/mcp';
```

These entries target 0.2.1. Earlier individual packages remain separate published releases. There is one workspace/package: `packages/capability-sdk`. Tool groups and adapters are subpath exports, not separate npm dependencies.
