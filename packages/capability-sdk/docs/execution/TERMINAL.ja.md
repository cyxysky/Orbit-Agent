# @cjfclonedeep/capability-sdk/execution/terminal

[English](TERMINAL.md) | [简体中文](TERMINAL.zh-CN.md) | [日本語](TERMINAL.ja.md)

このガイドは独立した npm パッケージではなく、`@cjfclonedeep/capability-sdk@0.3.0` のサブパスを説明します。例で使うツールの依存は同梱されています。

フレームワークに依存しないローカル端末の CapabilityProvider です。モデル、クラウドサンドボックス、Agent Loop は不要です。コマンドは Agent サービスを実行するマシン上で、その OS アカウントの権限で動作します。Web クライアント側の PC では実行されません。

## インストールと最初の呼び出し

対応する 0.3.0 ワークスペースまたは公開パッケージを使用します。利用側プロジェクトで package.json を type=module に設定し、次のファイルを作成します。モデル/API キーは不要です。

```sh
npm install @cjfclonedeep/capability-sdk
npm install -D typescript tsx @types/node
```

```ts
// terminal.ts — Node >=22.16, ESM TypeScript
import { randomUUID } from 'node:crypto';
import type { TerminalResult } from '@cjfclonedeep/capability-sdk/execution/terminal';
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
  const created = await call({ action: 'create', reason: 'Open a reusable terminal', name: 'Workspace' });
  if (!created.ok) throw new Error(created.error.message);
  const terminalId = (created.data as TerminalResult).terminal!.terminalId;
  let result = await call({
    action: 'run', reason: 'Inspect the local working directory', terminalId,
    command: process.platform === 'win32' ? 'Get-Location' : 'pwd', yieldMs: 1000,
  });
  console.log(result);
  while (result.ok && (result.data as TerminalResult).terminal?.status === 'running') {
    result = await call({
      action: 'wait', reason: 'Wait for command completion', terminalId,
      cursor: (result.data as TerminalResult).cursor, yieldMs: 30000,
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

- `create`: 任意の name、cwd、cols、rows で再利用可能な terminalId を作成。`list` は既存端末を列挙します。
- `run`: terminalId、command、任意の timeoutMs、yieldMs。同じ Shell のディレクトリ、変数、環境を維持します。実行中の端末は別の run を拒否します。
- `read`: terminalId と任意の cursor。保持された出力を即時取得し、他の読み手のバッファを消費しません。
- `wait`: terminalId、任意の cursor と yieldMs。コマンド終了まで待機して出力を取得します。
- `write`: terminalId と input。生の入力を送信し、Enter は `\r` で表します。
- `interrupt`: Ctrl+C を送信し、応答しない場合は端末を終了します。
- `resize`: cols/rows。`rename`: name。`close` は端末と子プロセスを終了して出力を保持し、`delete` は記録も削除します。

すべての操作に reason が必要です。yieldMs は 0–30000 で、呼び出しの待機時間だけを制限します。running は成功ではありません。command.status=succeeded と command.exitCode=0 が成功を示します。run/wait の失敗、中断、タイムアウト時は error.details に TerminalResult が入ります。

## 実行環境と寿命

実際の PTY を独立したネイティブ宿主プロセスで動かします。対話入力、ANSI 出力、サイズ変更をサポートします。auto は Windows で Windows PowerShell、それ以外で Bash を使用します。powershell、pwsh、bash を選択でき、Windows は前二者のみ対応します。Shell profile は読み込みません。.ps1/.cmd を含むパッケージ管理コマンドを直接呼び出せるため、バックグラウンドへの切り離しやログファイルのポーリングは不要です。

単独の createNodeTerminalCapability は管理器を所有し、dispose 時に端末を終了します。モデル要求をまたいで保持する場合は、パッケージの createTerminalWorkspaceRegistry を使用します。userId と sessionId で分離し、capability() は解放権限を持たないハンドルを返します。通常の応答完了やコンテキスト圧縮では端末を維持します。会話の停止・終了・削除時には stop({ ownerId, workspaceId }) で端末と子プロセスを終了して記録を削除し、サービス終了時には dispose() を呼びます。再起動後の端末復元やコマンド再実行は行いません。

Node 管理器の subscribe は出力と状態を配信します。Orbit は認可済み SSE で配信し、再接続時に保持出力を再送します。生の出力は絶対カーソルを使い、モデル読み取りでは制御コードを除去します。PTY は stdout/stderr を統合するため、stderr の進捗だけでは失敗になりません。出力上限を超えると末尾を保持して truncated=true を返します。最大 64 件を明示的な削除まで保持します。timeoutMs=0 は期限なし、正数は期限到達時に前面コマンドを中断します。

## 設定

Windows は powershell/pwsh のみ対応します。ユーザーコマンドの実行前に Shell を Windows Job に入れ、終了時に子プロセスも停止します。Job への登録に失敗した場合はコマンドを実行しません。PowerShell のネイティブ引数の引用規則はそのまま適用されるため、複雑な引用にはスクリプトファイルを使用してください。

| Key | Default |
| --- | --- |
| `AGENT_TERMINAL_ENABLED` | `false` |
| `AGENT_TERMINAL_CWD` | application cwd |
| `AGENT_TERMINAL_SHELL` | `auto` |
| `AGENT_TERMINAL_TIMEOUT_MS` | `0` |
| `AGENT_TERMINAL_MAX_OUTPUT_CHARS` | `50000` |
| `AGENT_TERMINAL_MAX_PROCESSES` | `4` |

Shell と初期ディレクトリは新規端末に適用され、管理器の設定更新は後続操作に適用されます。明示的な工場 cwd は AGENT_TERMINAL_CWD より優先されます。createNodeTerminalOperations の直接利用ではホストが認可と解放を管理します。env はホストだけが注入し、省略するとサービスの環境を継承します。

## Agent 接続

tool.input.jsonSchema をモデルの引数定義に変換し、実行前に input.parse を呼びます。共通の createCapabilityExecutor で権限と直列実行を管理し、Skill をモデルに渡してください。本人確認、操作承認、キャンセルはホストの責任です。Orbit は本地终端の設定と既存の run/write 承認処理に接続します。

AI SDK では Provider と設定を @cjfclonedeep/capability-sdk/ai-sdk の mountAISDKCapabilities に渡し、agentOptions を自分の Agent に渡します。すべての呼び出し終了後に解放します。コアと Node 入口は AI SDK に依存しません。

公開入口はルートの Provider/契約、/node、/settings、/runtime-skill、/mcp です。[MCP 接続](TERMINAL-MCP.ja.md) に実行可能なサービス例があります。

## 会話のワークスペースと端末 UI

/workspaces は管理器、/http の terminalHttpResponse は操作と SSE、/client の createHttpTerminalClient はホストルートへの接続、/react の TerminalWorkspace は作成・切り替え・改名・中断・終了・削除・リアルタイム出力・端末入力を提供します。入力プロンプトは最後の出力行の直後です。画面を閉じても端末は保持されます。ホストは認証、ワークスペース認可、設定とライフサイクル連携を担当し、モデル要求ごとの dispose で共有端末を破棄しません。
