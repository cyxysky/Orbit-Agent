# @cjfclonedeep/capability-sdk/execution/terminal

[English](TERMINAL.md) | [简体中文](TERMINAL.zh-CN.md) | [日本語](TERMINAL.ja.md)

このガイドは独立した npm パッケージではなく、`@cjfclonedeep/capability-sdk@0.2.1` のサブパスを説明します。例で使うツールの依存は同梱されています。

フレームワークに依存しないローカル端末の CapabilityProvider です。モデル、クラウドサンドボックス、Agent Loop は不要です。コマンドは Agent サービスを実行するマシン上で、その OS アカウントの権限で動作します。Web クライアント側の PC では実行されません。

## インストールと最初の呼び出し

対応する 0.1.0 ワークスペースまたは公開パッケージを使用します。利用側プロジェクトで package.json を type=module に設定し、次のファイルを作成します。モデル/API キーは不要です。

```sh
npm install @cjfclonedeep/capability-sdk
npm install -D typescript tsx @types/node
```

```ts
// terminal.ts — Node >=22.16, ESM TypeScript
import { randomUUID } from 'node:crypto';
import { mountCapabilities } from '@cjfclonedeep/capability-sdk/host';
import { createCapabilityExecutor } from '@cjfclonedeep/capability-sdk';
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';

const mounted = await mountCapabilities({
  providers: [createNodeTerminalCapability({ cwd: process.cwd() })],
  context: { runId: randomUUID() },
  configurations: {
    'com.webpilot.terminal': { AGENT_TERMINAL_ENABLED: 'true' },
  },
});
// This single-user example grants terminal execution explicitly.
// A shared host supplies its authenticated user's permission policy.
const execute = createCapabilityExecutor({
  authorize(permissions) {
    if (permissions.some(permission => permission !== 'process:terminal')) {
      throw new Error('Permission denied.');
    }
  },
});
const resolved = mounted.tools.terminal;
async function call(raw: unknown) {
  const input = resolved.tool.input.parse(raw);
  return execute(resolved, { invocationId: randomUUID() },
    context => resolved.tool.execute(input, context));
}
try {
  console.log(mounted.skillCatalog.instructions('eager'));
  let result = await call({
    action: 'run', reason: 'Inspect the local working directory',
    command: process.platform === 'win32' ? 'Get-Location' : 'pwd',
    yieldMs: 1000,
  });
  console.log(result);
  while (result.ok && (result.data as { status: string }).status === 'running') {
    result = await call({
      action: 'read', reason: 'Collect remaining command output',
      sessionId: (result.data as { sessionId: string }).sessionId, yieldMs: 1000,
    });
    console.log(result);
  }
  if (!result.ok) throw new Error(result.error.message);
} finally {
  await mounted.dispose();
}
```

```sh
npx tsx terminal.ts
```

## 操作

- `run`: command と省略可能な cwd、stdin、keepStdinOpen、timeoutMs、yieldMs。毎回新しい Shell を起動します。相対 cwd は設定済みディレクトリから解決され、ファイルシステムの隔離境界ではありません。
- `read`: sessionId と省略可能な yieldMs。前回以降の stdout/stderr、状態、終了コード、シグナル、切り捨て情報を取得します。
- `write`: sessionId、stdin、任意の closeStdin と yieldMs。後から入力する場合は run で keepStdinOpen=true を指定します。既定では初期入力後に stdin を閉じます。
- `stop`: sessionId。プロセスツリーを停止し、終了を待ちます。

各操作には reason が必要です。yieldMs は 0–10000、既定値は 1000。running の場合は同じコマンドを再実行せず read で結果を取得します。非ゼロ終了、タイムアウト、キャンセルは ok=false と error.details 内の完全な TerminalResult を返します。実行中と成功した結果は data に入ります。

## 実行環境と寿命

auto は Windows で Windows PowerShell、それ以外で Bash を使用します。ホストは powershell、pwsh、bash、sh も指定できます。対象 Shell を事前にインストールしてください。Windows ではウィンドウを表示せず、Shell profile を読み込みません。PTY ではなくパイプを利用するため、TTY 必須または全画面アプリは非対応です。別の run に cd や変数は引き継がれません。

run/read/write/stop は同一ランタイムを再利用します。dispose、キャンセル、タイムアウトでプロセスツリーを停止します。Orbit は Agent のターン終了時に解放するため、ターンや再起動をまたぐ常駐実行には使えません。stdout/stderr は出力予算の半分ずつを使用し、超過時は末尾を残して truncated=true を返します。最大 64 件の記録を保持し、古い完了済み記録を先に削除します。

## 設定

Windows は powershell/pwsh のみ対応します。ユーザーコマンドの実行前に Shell を Windows Job に入れ、終了時に子プロセスも停止します。Job への登録に失敗した場合はコマンドを実行しません。PowerShell のネイティブ引数の引用規則はそのまま適用されるため、複雑な引用にはスクリプトファイルを使用してください。

| Key | Default |
| --- | --- |
| `AGENT_TERMINAL_ENABLED` | `false` |
| `AGENT_TERMINAL_CWD` | application cwd |
| `AGENT_TERMINAL_SHELL` | `auto` |
| `AGENT_TERMINAL_TIMEOUT_MS` | `120000` |
| `AGENT_TERMINAL_MAX_OUTPUT_CHARS` | `50000` |
| `AGENT_TERMINAL_MAX_PROCESSES` | `4` |

設定は再マウント後に適用されます。明示的な工場 cwd は AGENT_TERMINAL_CWD より優先されます。createNodeTerminalOperations の直接利用ではホストが認可と解放を管理します。env はホストだけが注入し、省略するとサービスの環境を継承します。

## Agent 接続

tool.input.jsonSchema をモデルの引数定義に変換し、実行前に input.parse を呼びます。共通の createCapabilityExecutor で権限と直列実行を管理し、Skill をモデルに渡してください。本人確認、操作承認、キャンセルはホストの責任です。Orbit は本地终端の設定と既存の run/write 承認処理に接続します。

AI SDK では Provider と設定を @cjfclonedeep/capability-sdk/ai-sdk の mountAISDKCapabilities に渡し、agentOptions を自分の Agent に渡します。すべての呼び出し終了後に解放します。コアと Node 入口は AI SDK に依存しません。

公開入口はルートの Provider/契約、/node、/settings、/runtime-skill、/mcp です。[MCP 接続](TERMINAL-MCP.ja.md) に実行可能なサービス例があります。
