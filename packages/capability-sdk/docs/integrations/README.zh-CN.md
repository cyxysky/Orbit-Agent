# @cjfclonedeep/capability-sdk/integrations

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

本指南描述 `@cjfclonedeep/capability-sdk@0.2.1` 的子入口，不再是独立 npm 包。工具包已包含这些示例所需的工具依赖。

外部服务连接器与通信能力合为一个包。通信可以直接复用连接器操作，无需再依赖另一个独立包。

```sh
npm install @cjfclonedeep/capability-sdk
```

| 入口 | 用途 |
| --- | --- |
| `@cjfclonedeep/capability-sdk/integrations/connectors` | [连接器发现与调用](CONNECTORS.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/integrations/connectors/node` | [MCP 与 OpenAPI 客户端](CONNECTORS.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/integrations/communication` | [渠道、草稿与送达回执](COMMUNICATION.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/integrations/communication/node` | [Webhook、连接器渠道与企业微信](COMMUNICATION.zh-CN.md) |

根入口导出两组无框架依赖的 Provider；`/node` 导出两组 Node 适配器。各组保留 `/mcp`、`/settings` 和 `/runtime-skill`。Provider ID、工具名、配置键和审批规则保持不变。创建消息草稿不会发送消息。按需使用具体 Node 子入口，避免加载不需要的实现。
