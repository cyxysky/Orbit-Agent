# @cjfclonedeep/capability-sdk/integrations

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

This guide describes a subpath of `@cjfclonedeep/capability-sdk@0.2.1`, not a separate npm package. The tools package includes the dependencies used by these examples.

External service connectors and draft-first communication in one package. Communication can reuse connector operations without a separate package dependency.

```sh
npm install @cjfclonedeep/capability-sdk
```

| Entry | Purpose |
| --- | --- |
| `@cjfclonedeep/capability-sdk/integrations/connectors` | [Connector discovery and invocation](CONNECTORS.md) |
| `@cjfclonedeep/capability-sdk/integrations/connectors/node` | [MCP and OpenAPI clients](CONNECTORS.md) |
| `@cjfclonedeep/capability-sdk/integrations/communication` | [Channels, drafts and delivery receipts](COMMUNICATION.md) |
| `@cjfclonedeep/capability-sdk/integrations/communication/node` | [Webhooks, connector channels and WeCom](COMMUNICATION.md) |

The root exports both framework-neutral providers; `/node` exports both Node adapters. Each group also has `/mcp`, `/settings` and `/runtime-skill`. Provider IDs, tool names, settings and approval rules are unchanged. Creating a message draft does not send it. Use the specific Node entry to load only the integration you need.
