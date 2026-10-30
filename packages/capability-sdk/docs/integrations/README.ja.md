# @cjfclonedeep/capability-sdk/integrations

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

このガイドは独立した npm パッケージではなく、`@cjfclonedeep/capability-sdk@0.2.1` のサブパスを説明します。例で使うツールの依存は同梱されています。

外部サービスのコネクターと通信機能を一つのパッケージで提供します。通信は別パッケージに依存せず、コネクターの操作を再利用できます。

```sh
npm install @cjfclonedeep/capability-sdk
```

| エントリ | 用途 |
| --- | --- |
| `@cjfclonedeep/capability-sdk/integrations/connectors` | [コネクターの検出と呼び出し](CONNECTORS.ja.md) |
| `@cjfclonedeep/capability-sdk/integrations/connectors/node` | [MCP と OpenAPI クライアント](CONNECTORS.ja.md) |
| `@cjfclonedeep/capability-sdk/integrations/communication` | [チャネル、下書き、配信結果](COMMUNICATION.ja.md) |
| `@cjfclonedeep/capability-sdk/integrations/communication/node` | [Webhook、コネクターチャネル、WeCom](COMMUNICATION.ja.md) |

ルートは両方の Provider、`/node` は両方の Node アダプターを公開します。それぞれに `/mcp`、`/settings`、`/runtime-skill` があります。Provider ID、ツール名、設定キー、承認ルールは変わりません。下書きの作成では送信しません。必要な Node エントリを直接インポートすると、不要な実装を読み込まずに済みます。
