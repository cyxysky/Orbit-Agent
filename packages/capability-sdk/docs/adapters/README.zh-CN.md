# @cjfclonedeep/capability-sdk

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

AI SDK 与 MCP 适配器合为一个包，通过明确的子入口选择接入方式。

```sh
npm install @cjfclonedeep/capability-sdk 
```

| 入口 | 用途 |
| --- | --- |
| `@cjfclonedeep/capability-sdk/ai-sdk` | [AI SDK 工具、指令与挂载](AI-SDK.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/ai-sdk/node` | [AI SDK 挂载与 JSON 配置存储](AI-SDK.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/ai-sdk/typeorm` | [AI SDK 挂载与可选 TypeORM 存储](AI-SDK.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/mcp` | [MCP 服务端、HTTP Handler 与 stdio](MCP-ADAPTER.zh-CN.md) |

npm 依赖全部随包安装。根入口提供契约和执行机制，不会连带加载全部工具与框架适配。正常 npm 安装还会通过 postinstall 自动准备受支持的 Windows/Linux 执行环境。
