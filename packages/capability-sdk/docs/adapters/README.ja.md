# @cjfclonedeep/capability-sdk

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

AI SDK と MCP のアダプターを一つのパッケージで提供し、明示的なエントリで選択します。

```sh
npm install @cjfclonedeep/capability-sdk 
```

| エントリ | 用途 |
| --- | --- |
| `@cjfclonedeep/capability-sdk/ai-sdk` | [AI SDK のツール、指示、マウント](AI-SDK.ja.md) |
| `@cjfclonedeep/capability-sdk/ai-sdk/node` | [JSON 設定ストア付き AI SDK マウント](AI-SDK.ja.md) |
| `@cjfclonedeep/capability-sdk/ai-sdk/typeorm` | [TypeORM 設定ストア付き AI SDK マウント](AI-SDK.ja.md) |
| `@cjfclonedeep/capability-sdk/mcp` | [MCP サーバー、HTTP Handler、stdio](MCP-ADAPTER.ja.md) |

npm 依存はすべて含まれます。ルートは契約と実行機能を公開し、すべてのツールやアダプターを一括ロードしません。通常の npm インストールでは postinstall が対応する Windows/Linux の実行環境も準備します。
