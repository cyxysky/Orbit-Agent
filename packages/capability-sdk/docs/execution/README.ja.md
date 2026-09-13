# @cjfclonedeep/capability-sdk/execution

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

このガイドは独立した npm パッケージではなく、`@cjfclonedeep/capability-sdk@0.2.1` のサブパスを説明します。例で使うツールの依存は同梱されています。

コード実行とローカル端末を一つのパッケージで提供します。ツール、設定、Skill、権限は Provider ごとに管理します。

```sh
npm install @cjfclonedeep/capability-sdk
```

| エントリ | 用途 |
| --- | --- |
| `@cjfclonedeep/capability-sdk/execution/code` | [JavaScript/Python の契約と Provider](CODE.ja.md) |
| `@cjfclonedeep/capability-sdk/execution/code/node` | [ローカルプロセス実行器](CODE.ja.md) |
| `@cjfclonedeep/capability-sdk/execution/code/remote` | [HTTP Runner 実行器](CODE.ja.md) |
| `@cjfclonedeep/capability-sdk/execution/terminal` | [端末の契約と Provider](TERMINAL.ja.md) |
| `@cjfclonedeep/capability-sdk/execution/terminal/node` | [ローカル Shell セッション](TERMINAL.ja.md) |

ルートは両方の Provider、`/node` は両方の Node ファクトリを公開します。それぞれに `/mcp`、`/settings`、`/runtime-skill` もあります。プロセスツリーの終了処理を共有し、環境、出力ポリシー、実行バックエンドは個別に保持します。ローカルコード実行は OS 隔離ではありません。隔離には対応するリモートバックエンドを使います。端末はホストの権限で動作し、セッションはマウントしたランタイムの破棄まで続きます。コード実行の失敗時に端末へ自動的に切り替わることはありません。
