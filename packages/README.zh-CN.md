# Capability SDK

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

一个包提供能力契约、执行、配置、响应、AI SDK/MCP 适配，以及全部工具。

```sh
npm install @cjfclonedeep/capability-sdk
```

npm 依赖全部随包安装。根入口提供契约和执行机制，不会连带加载全部工具与框架适配。正常 npm 安装还会通过 postinstall 自动准备受支持的 Windows/Linux 执行环境。

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

[SDK](capability-sdk/README.zh-CN.md) · [Tools](capability-sdk/TOOLS.zh-CN.md) · [Runtime](capability-sdk/RUNTIME.zh-CN.md)

```ts
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';
import { serveTerminalMcpStdio } from '@cjfclonedeep/capability-sdk/execution/terminal/mcp';
```

These entries target 0.2.1. Earlier individual packages remain separate published releases. There is one workspace/package: `packages/capability-sdk`. Tool groups and adapters are subpath exports, not separate npm dependencies.
