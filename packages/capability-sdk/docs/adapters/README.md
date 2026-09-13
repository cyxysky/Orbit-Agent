# @cjfclonedeep/capability-sdk

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

AI SDK and MCP adapters in one package, selected through explicit entrypoints.

```sh
npm install @cjfclonedeep/capability-sdk 
```

| Entry | Purpose |
| --- | --- |
| `@cjfclonedeep/capability-sdk/ai-sdk` | [AI SDK tools, instructions and mounting](AI-SDK.md) |
| `@cjfclonedeep/capability-sdk/ai-sdk/node` | [AI SDK mounting with JSON configuration storage](AI-SDK.md) |
| `@cjfclonedeep/capability-sdk/ai-sdk/typeorm` | [AI SDK mounting with optional TypeORM storage](AI-SDK.md) |
| `@cjfclonedeep/capability-sdk/mcp` | [MCP server, HTTP handler and stdio transport](MCP-ADAPTER.md) |

All npm dependencies are included. The root exposes contracts and execution without eagerly importing tool implementations or framework adapters. Normal npm installation also prepares the supported Windows/Linux execution runtimes through postinstall.
