# Capability SDK

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

能力の契約、実行、設定、応答、AI SDK/MCP アダプターと全ツールを一つのパッケージで提供します。

```sh
npm install @cjfclonedeep/capability-sdk
```

npm 依存はすべて含まれます。ルートは契約と実行機能を公開し、すべてのツールやアダプターを一括ロードしません。通常の npm インストールでは postinstall が対応する Windows/Linux の実行環境も準備します。

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

[SDK](capability-sdk/README.ja.md) · [Tools](capability-sdk/TOOLS.ja.md) · [Runtime](capability-sdk/RUNTIME.md)

```ts
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';
import { serveTerminalMcpStdio } from '@cjfclonedeep/capability-sdk/execution/terminal/mcp';
```

These entries target 0.2.1. Earlier individual packages remain separate published releases. There is one workspace/package: `packages/capability-sdk`. Tool groups and adapters are subpath exports, not separate npm dependencies.
