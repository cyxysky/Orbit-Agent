# Capability SDK

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

一个包提供能力契约、执行、配置、响应、AI SDK/MCP 适配，以及全部工具。

Orbit 宿主通过数据库配置存储向每个能力传入其 Manifest 声明的配置，不以进程环境变量传递业务设置。SDK 声明中的 `startup` 表示能力实例创建时需要这些值；Orbit 会在安全时机自动更新该实例，界面标记为“自动更新实例”，不要求重启项目。独立 MCP/CLI 宿主仍可自行选择配置存储和启动方式。

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
