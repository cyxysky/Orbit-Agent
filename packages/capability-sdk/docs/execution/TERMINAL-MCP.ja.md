# MCP 経由のローカル端末

[README](TERMINAL.ja.md) に従って @cjfclonedeep/capability-sdk/execution/terminal、対応する SDK/host と tsx をインストールします。利用側 ESM プロジェクトに server.ts を保存します。この例は単一ユーザーのローカル端末アクセスを明示的に許可します。

このガイドは独立した npm パッケージではなく、`@cjfclonedeep/capability-sdk@0.2.1` のサブパスを説明します。例で使うツールの依存は同梱されています。

```ts
// server.ts
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';
import { serveTerminalMcpStdio } from '@cjfclonedeep/capability-sdk/execution/terminal/mcp';

serveTerminalMcpStdio({
  provider: createNodeTerminalCapability({ cwd: process.cwd() }),
  configurations: {
    'com.webpilot.terminal': { AGENT_TERMINAL_ENABLED: 'true' },
  },
  skillMode: 'eager',
  policy: {
    authorize(permissions) {
      if (permissions.some(permission => permission !== 'process:terminal')) {
        throw new Error('Permission denied.');
      }
    },
  },
});
```

```sh
npx tsx server.ts
```

```json
{
  "mcpServers": {
    "terminal": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/server.ts"]
    }
  }
}
```

クライアントの cwd をプロジェクトに設定し、server.ts は絶対パスを指定します。Windows で実行ファイル名が必要なら npx.cmd を使用します。stdout は MCP 専用とし、ログは stderr に出力します。

terminal の run/read/write/stop を公開します。サーバー指示と構造化結果全体をモデルへ渡し、プロセス操作全体で同じサーバー/ランタイムを維持してください。run/write はクライアントの操作承認へ接続します。権限フックはコマンド引数を検査しません。共有サービスでは認証済みユーザーとサーバー側の操作認可も必要です。

createTerminalMcpServer は未接続のサーバー、createTerminalMcpHandler は待ち受けを開始しない HTTP Handler を返します。簡易 HTTP Handler はリクエストごとの寿命のためプロセス状態を維持できません。状態付き HTTP では認証済み MCP セッションごとにサーバーを保持し、切断時の close でプロセスを停止します。[状態付き HTTP の例](../../../capability-sdk/docs/adapters/MCP-ADAPTER-MCP.ja.md) を参照してください。認証、OS 隔離、ファイル公開は自動提供されません。
