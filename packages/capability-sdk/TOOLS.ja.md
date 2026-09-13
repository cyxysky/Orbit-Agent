# @cjfclonedeep/capability-sdk

[English](TOOLS.md) | [简体中文](TOOLS.zh-CN.md) | [日本語](TOOLS.ja.md)

全ツールと npm 依存関係。必要な機能のサブパスをインポートします。

```sh
npm install @cjfclonedeep/capability-sdk@0.2.1
```

npm 依存はすべて含まれます。ルートは契約と実行機能を公開し、すべてのツールやアダプターを一括ロードしません。通常の npm インストールでは postinstall が対応する Windows/Linux の実行環境も準備します。 [Runtime](RUNTIME.md)

| エントリ | ガイド |
| --- | --- |
| `/browser` | [ブラウザーセッション](docs/browser/README.ja.md) |
| `/chart` | [チャートとレンダラー](docs/chart/README.ja.md) |
| `/maps` | [地図](docs/maps/README.md) |
| `/file` | [ファイルと Office](docs/file/README.ja.md) |
| `/execution` | [コードと端末](docs/execution/README.ja.md) |
| `/integrations` | [コネクターと通信](docs/integrations/README.ja.md) |
| `/knowledge` | [知識検索](docs/knowledge/README.ja.md) |
| `/data` | [構造化データ](docs/data/README.ja.md) |
| `/media` | [メディア](docs/media/README.ja.md) |
| `/computer` | [デスクトップ操作](docs/computer/README.ja.md) |
| `/sensitive-data` | [機密データのフィルター](docs/sensitive-data/README.ja.md) |

[Automatic runtime setup](RUNTIME.md) · [SDK](README.ja.md)

## ローカル端末 MCP サーバー

Node.js >=22.16 のプロジェクトで server.mjs として保存します。MCP クライアントが node server.mjs で stdio サーバーを起動します。この例はローカル端末の実行を有効にします。標準出力は MCP 専用なのでログを書かないでください。

```js
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';
import { serveTerminalMcpStdio } from '@cjfclonedeep/capability-sdk/execution/terminal/mcp';

serveTerminalMcpStdio({
  provider: createNodeTerminalCapability({ cwd: process.cwd() }),
  configurations: {
    'com.webpilot.terminal': { AGENT_TERMINAL_ENABLED: 'true' },
  },
  skillMode: 'eager',
});
```

これらのエントリは 0.2.1 用です。以前の個別パッケージは旧リリースとして残ります。移行時には旧パッケージ名を新しいサブパスに置き換えます。インストールにはサブパスではなくパッケージ名を使います。
