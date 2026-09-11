# @webpilot/capability-browser

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

永続的な JavaScript 環境とページ観測を通じて Playwright ブラウザーを操作します。

`BrowserSession.executeBrowserCode()` は `{ ok, summary, data, ... }` を返します。`data.result` はコードの出力、失敗時のみ `data.executionState` に実行状態を返します。`needChange: true` を指定した場合のみ、今回のセルの差分を読み取り、`data.domChanges` に返します。`needChange` の既定値は false で、過去のセルの差分は取得しません。これらのオブジェクトを直接読み取ってください。完全な内容は `data` にのみ保持されます。`createNodeBrowserCapability` の戻り値は、まず `@webpilot/capability-browser` の `browserOperationFromCapabilityResult` で Capability のラッパーを取り除きます。状態表示には `summary` を使います。

この README は完全な接続の入口です。任意の TypeScript Agent フレームワークでは手順 1–4、または後述の AI SDK/MCP を使います。例にあるファイルはすべて**利用側のプロジェクト**に作成し、このパッケージ内には作りません。

## 1. インストールと準備

Node.js >=22.16 と ESM TypeScript を使います。例は 0.1.0 ワークスペースの契約に対応しています。設定した npm レジストリから一致する版を導入してください。未公開なら管理者の同版リリース tarball/ワークスペースを使います。レジストリの 404 は実行時エラーではありません。異なるリリースを混在させないでください。新規プロジェクトでは：

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-browser @webpilot/capability-sdk @webpilot/capability-host playwright@^1.60.0
npm install -D typescript tsx @types/node
```

利用側のプロジェクトで `npx playwright install chromium` を実行し、対応する Chromium をインストールします。マウントごとに BrowserSession を作り、タブと JavaScript 変数が必要な会話全体で同じ実行インスタンスを保持します。ローカルで画面を表示するには `headless: false` を指定します。

`state` は観測、`code` は Skill に記載された `browser`、`page`、`nodeRepl` API による実行、`waitForHumanVerification` は人間による操作待ちです。パッケージの facade と通常の Playwright Page は完全には互換ではありません。コード生成前に実行時 Skill を読みます。タイムアウトや中断後は再実行前に現在の状態を確認します。スクリーンショットには画像コンテンツの変換と成果物ストレージが必要です。ダウンロードには File の `createNodeFileDownloadReceiver` を利用できます。

専用の `/mcp` は `browser.open`、`browser.code`、`browser.snapshot`、`browser.close` と明示的な `browserSessionId` を使います。このチュートリアルの汎用 Provider は単一の `browser` ツールを公開します。両者のスキーマを混在させないでください。複数リクエストにまたがるリモートセッションには MCP.md のステートフル HTTP 例または stdio を使います。リクエスト単位の簡易 HTTP Handler はメモリ内のセッション管理を保持しません。

## 2. Provider の作成

`provider.ts` として保存します。Provider、最初の有効な呼び出し、明示的な設定、ホストの後処理を公開します。

```ts
import { BrowserSession, createNodeBrowserCapability } from '@webpilot/capability-browser/node';
 const provider = createNodeBrowserCapability({
   createOptions: (context) => {
     const session = new BrowserSession({ headless: true, isolated: true });
     return { session, runId: context.runId,
       ensureStarted: () => session.start(), disposeSession: true,
       imageInputAvailable: false };
   },
 });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "browser",
  "input": {
    "action": "state",
    "reason": "Inspect the initial browser state"
  }
};
export async function cleanup() {  }
```

## 3. マウント・検証・実行

`integration.ts` として保存します。実行ごとに 1 つの実行器を共有し、直列グループを維持します。引数解析、中断、ポリシー、解放は接続コードの担当であり、モデル任せにはできません。

```ts
import { randomUUID } from 'node:crypto';
import { mountCapabilities, EnvironmentCapabilityConfigStore } from '@webpilot/capability-host';
import { createCapabilityExecutor, disposeOnce,
  type CapabilityExecutionPolicyOptions } from '@webpilot/capability-sdk';
import { providers, configurations, cleanup } from './provider.js';

export async function openCapabilities(options: {
  policy: CapabilityExecutionPolicyOptions;
  signal?: AbortSignal;
  beforeInvoke?: (name: string, input: unknown) => void | Promise<void>;
}) {
  const mounted = await mountCapabilities({
    providers, configurations,
    context: { runId: randomUUID(), abortSignal: options.signal },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
  }).catch(async error => { await cleanup(); throw error; });
  const execute = createCapabilityExecutor(options.policy);
  const tools = Object.values(mounted.tools).map(resolved => ({
    name: resolved.publicName,
    description: resolved.tool.description,
    inputSchema: resolved.tool.input.jsonSchema,
    inputExamples: resolved.tool.inputExamples,
    async execute(rawInput: unknown, call: { id?: string; signal?: AbortSignal } = {}) {
      const signals = [mounted.abortSignal, call.signal].filter(
        (value): value is AbortSignal => Boolean(value));
      const context = { invocationId: call.id || randomUUID(),
        abortSignal: signals.length ? AbortSignal.any(signals) : undefined };
      try {
        const input = resolved.tool.input.parse(rawInput);
        await options.beforeInvoke?.(resolved.publicName, input);
        return await execute(resolved, context,
          execution => resolved.tool.execute(input, execution));
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        return { ok: false as const, error: {
          code: 'host-tool-invocation-failed',
          message: error instanceof Error ? error.message : String(error),
        } };
      }
    },
  }));
  return {
    tools,
    instructions: mounted.skillCatalog.instructions('eager'),
    snapshot: mounted,
    dispose: disposeOnce(async () => {
      try { await mounted.dispose(); } finally { await cleanup(); }
    }),
  };
}
```

`policy.ts` として保存します。この単一ユーザー例は明示した Provider を許可します。共有 Agent では既存の認証済み権限・操作承認に接続します。ツールが prerequisite を宣言する場合、policy.prerequisite で条件を検証し、不成立なら例外を投げます。

```ts
import type { CapabilityExecutionPolicyOptions } from '@webpilot/capability-sdk';
import { providers } from './provider.js';

// This sample host grants the permissions of its explicitly configured providers.
// Replace this set with your authenticated user's grants in a shared service.
const grants = new Set(providers.flatMap(provider => [...(provider.manifest.permissions || [])]));
export const policy: CapabilityExecutionPolicyOptions = {
  authorize(permissions) {
    for (const permission of permissions) {
      if (!grants.has(permission)) throw new Error(`Permission denied: ${permission}`);
    }
  },
  reportProgress(event) { console.error(event.phase, event.message); },
};

// Put your existing action/draft approval check here, before calling the tool.
// No additional action-level approval is configured by this single-user example.
export async function beforeInvoke(_name: string, _input: unknown): Promise<void> {}
```

`first-call.ts` として保存し、`npx tsx first-call.ts` を実行します。最初の呼び出しにモデル/API キーは不要ですが、上記の能力固有の要件は必要です。

```ts
import { openCapabilities } from './integration.js';
import { exampleCall } from './provider.js';
import { policy, beforeInvoke } from './policy.js';
const runtime = await openCapabilities({ policy, beforeInvoke });
try {
  const tool = runtime.tools.find(tool => tool.name === exampleCall.name);
  if (!tool) throw new Error(`Tool not mounted: ${exampleCall.name}`);
  const result = await tool.execute(exampleCall.input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally { await runtime.dispose(); }
```

## 4. 自分の Agent に接続

返されたオブジェクトをフレームワークのネイティブツール登録に対応付けます。以下は上記コードの実際のフィールドであり、仮の createAgent API への依存ではありません。

| この接続コード | Agent 側 |
| --- | --- |
| `runtime.tools[].name` | ツール名 |
| `.description` | モデルに渡す説明 |
| `.inputSchema` | JSON Schema またはネイティブ Schema 変換 |
| `.execute(input, { id, signal })` | ツールコールバック。呼び出し ID と中断を渡す |
| `runtime.instructions` | 最初のモデル呼び出し前にシステム/Agent 指示へ追加 |
| `runtime.dispose()` | 実行/セッション全体が終わった後に待機して解放 |

各モデルステップで、ツールと指示を送信 → ツール呼び出しを受信 → 引数が文字列なら一度だけ JSON を解析 → 正確な名前でツールを検索 → execute を await → 同じ呼び出し ID に対応する tool-result メッセージに**完全な結果**を追加 → 再度モデルを呼び出します。最終回答またはステップ/中断制限で停止し、ループ全体で実行インスタンスを保持します。

ok、data、content、error（code/retryable/details 含む）を保持し、summary だけにしません。テキスト結果なら JSON.stringify(result) を使えます。画像モデルには実際の画像データとネイティブ画像パートが必要で、パスや JSON は画像入力になりません。返された成果物 URL を使い、ID や URL を生成し直しません。lazy Skill には読み取りツールとホスト側の既読状態/公開ルールが必要なので、この例は eager を使います。

次節は AI SDK による完全な Agent 実装です。他のフレームワークではツール・モデル・メッセージのネイティブ対応だけを変更し、上記の能力実行境界は維持します。

## AI SDK：モデルで動作する完全な Agent

```sh
npm install @webpilot/capability-adapter-ai-sdk "ai@>=7 <8" @ai-sdk/openai-compatible
```

ツール呼び出しに対応する Chat Completions 互換サービスを選びます。プロセス環境に AGENT_MODEL_BASE_URL（API 接頭辞含む）、AGENT_MODEL_ID、必要なら AGENT_MODEL_API_KEY を設定します。provider.ts、policy.ts と同じ場所に agent.ts として保存し、`npx tsx agent.ts "タスク"` で実行します。first-call.ts の代替入口であり、その中で再度マウントしません。既定のプロンプトは説明のみなので、操作には目的のタスクを渡します。

```ts
import { randomUUID } from 'node:crypto';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { mountAISDKCapabilities, EnvironmentCapabilityConfigStore } from '@webpilot/capability-adapter-ai-sdk';
import { providers, configurations, cleanup } from './provider.js';
import { policy, beforeInvoke } from './policy.js';

const baseURL = process.env.AGENT_MODEL_BASE_URL;
const modelId = process.env.AGENT_MODEL_ID;
if (!baseURL || !modelId) throw new Error('Set AGENT_MODEL_BASE_URL and AGENT_MODEL_ID');
const modelProvider = createOpenAICompatible({ name: 'agent-provider', baseURL,
  apiKey: process.env.AGENT_MODEL_API_KEY });
const abort = new AbortController();
const cancel = () => abort.abort(new Error('Agent interrupted'));
process.once('SIGINT', cancel);
let runtime: Awaited<ReturnType<typeof mountAISDKCapabilities>> | undefined;
try {
  runtime = await mountAISDKCapabilities({
    providers, configurations,
    context: { runId: randomUUID(), abortSignal: abort.signal },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
    skills: { mode: 'eager' },
    adapter: { policy, async execute(call) {
      await beforeInvoke(call.resolvedTool.publicName, call.input);
      return call.invoke();
    } },
  });
  const agent = new ToolLoopAgent({ model: modelProvider.chatModel(modelId),
    ...runtime.agentOptions, stopWhen: stepCountIs(10) });
  const result = await agent.generate({
    prompt: process.argv[2] || 'Describe the available tools and their intended usage.',
    abortSignal: abort.signal,
  });
  console.log(result.text);
} finally {
  process.removeListener('SIGINT', cancel);
  try { await runtime?.dispose(); } finally { await cleanup(); }
}
```

## MCP：stdio・HTTP サーバー・クライアント

同梱の独立した [MCP 完全ガイド](MCP.ja.md) を参照してください。依存導入、stdio プロセス、ステートフル HTTP 待ち受け、クライアントの検出・呼び出し、モデル駆動 Agent、中断、認証境界、終了処理を含みます。上記 provider.ts と policy.ts を再利用します。リモートクライアントは MCP URL とクライアント依存だけでよく、この能力を読み込みません。

サーバーローカル file URL はリモートダウンロードには使えません。上記の成果物/保存要件に従います。実行環境は MCP サーバーにあり、呼び出し側のファイル・ブラウザー・デスクトップが自動的に利用可能になるわけではありません。

## 設定とライフサイクル

設定定義は provider.manifest.configuration.settings にあり、key、defaultValue、control、secret、範囲/選択肢、applyMode を持ちます。これらから設定 UI を作成できます。値は文字列です。EnvironmentCapabilityConfigStore を渡した場合に環境値を読み、明示的 configurations[capabilityId] が保存/環境値を上書きします。マウント時に設定を注入し、永続状態には安定したユーザー/ワークスペース範囲を使います。設定変更時には再マウントし、モデル失敗や中断後にも dispose を待ちます。

以下は設定のリテラル既定値で、動的な定義は manifest を参照します。runtime は新しい実行への再マウント、startup は所有ドライバー/サービスの再起動も必要です。

| キー | 既定値 | 適用タイミング |
| --- | --- | --- |
| `BROWSER_PREVIEW_FPS` | `20` | `runtime` |
| `BROWSER_OUTPUT_PIXEL_RATIO` | `1.5` | `runtime` |
| `BROWSER_SCREENCAST_FORMAT` | `jpeg` | `runtime` |
| `BROWSER_SCREENCAST_QUALITY` | `90` | `runtime` |
| `BROWSER_PREVIEW_TRANSPORT` | `video` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_BITRATE_KBPS` | `` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_SOURCE_FORMAT` | `jpeg` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_MAX_WIDTH` | `1920` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_MAX_HEIGHT` | `1080` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_KEYFRAME_INTERVAL` | `15` | `runtime` |
| `BROWSER_PROFILE_CLEAR_CACHE_ON_CLOSE` | `true` | `startup` |
| `BROWSER_USER_BROWSER_IDLE_TIMEOUT_MS` | `180000` | `runtime` |
| `ELECTRON_EMBEDDED_BROWSER` | `false` | `startup` |
| `HEADLESS_BROWSER` | `false` | `startup` |
| `BROWSER_VIEWPORT_MODE` | `auto` | `startup` |
| `BROWSER_VIEWPORT_WIDTH` | `` | `startup` |
| `BROWSER_VIEWPORT_HEIGHT` | `` | `startup` |
| `BROWSER_NAVIGATION_DOM_QUIET_MS` | `250` | `runtime` |
| `BROWSER_NAVIGATION_DOM_STABILITY_TIMEOUT_MS` | `1000` | `runtime` |
| `BROWSER_IGNORE_HTTPS_ERRORS` | `false` | `startup` |
| `BROWSER_HTTP_REQUEST_HISTORY_LIMIT` | `400` | `runtime` |
| `AI_HTTP_REQUEST_TOOL_LIMIT` | `80` | `runtime` |
| `SCREENSHOT_TIMEOUT_MS` | `15000` | `runtime` |
| `MANUAL_VERIFICATION_TIMEOUT_MS` | `180000` | `runtime` |
| `BROWSER_CHAT_KEEP_BROWSER_OPEN_AFTER_TURN` | `true` | `runtime` |
| `BROWSER_CHAT_ACTION_FRAME_LIMIT` | `24` | `runtime` |
| `BROWSER_CHAT_SHOW_REASONING` | `false` | `runtime` |
| `BROWSER_CHAT_LOG_LIMIT` | `2000` | `runtime` |
| `AI_VISUAL_HISTORY_LIMIT` | `6` | `runtime` |
| `AI_COMPLETION_VERIFY` | `true` | `runtime` |
| `PLAYWRIGHT_TRACE` | `true` | `startup` |

## トラブル対処と接続完了の確認

- モジュールがない：公開 exports、版の一致、Node/ESM、入口の任意 peer を確認します。
- ツールがない：runtime.tools、有効な能力 ID、許可名を確認し、フォルダー名から推測しません。
- 検証失敗：実際の inputSchema と parse エラーを使い、別入口のスキーマを流用しません。
- 無効/未提供の操作：正規化設定、選択バックエンド、実行バイナリー、ホストコールバックを確認します。
- Skill が反映されない：モデル呼び出し前に eager 指示を追加するか、lazy 読み取りと公開ポリシーを実装します。
- タイムアウトは副作用がなかった証拠ではありません。再試行前に保存済み/現在の状態を確認します。
- 完了条件：最初の呼び出しが ok: true、Agent が同じスキーマと完全な結果を受け取り、必要なファイル/画像を利用でき、終了時に資源が解放されることです。

## 公開エントリーポイント

- `@webpilot/capability-browser`
- `@webpilot/capability-browser/node`
- `@webpilot/capability-browser/runtime-skill`
- `@webpilot/capability-browser/settings`
- `@webpilot/capability-browser/session-group`
- `@webpilot/capability-browser/mcp`

## 補足の動作リファレンス

利用側のプロジェクトで `npx playwright install chromium` を実行し、対応する Chromium をインストールします。マウントごとに BrowserSession を作り、タブと JavaScript 変数が必要な会話全体で同じ実行インスタンスを保持します。ローカルで画面を表示するには `headless: false` を指定します。

`state` は観測、`code` は Skill に記載された `browser`、`page`、`nodeRepl` API による実行、`waitForHumanVerification` は人間による操作待ちです。パッケージの facade と通常の Playwright Page は完全には互換ではありません。コード生成前に実行時 Skill を読みます。タイムアウトや中断後は再実行前に現在の状態を確認します。スクリーンショットには画像コンテンツの変換と成果物ストレージが必要です。ダウンロードには File の `createNodeFileDownloadReceiver` を利用できます。

専用の `/mcp` は `browser.open`、`browser.code`、`browser.snapshot`、`browser.close` と明示的な `browserSessionId` を使います。このチュートリアルの汎用 Provider は単一の `browser` ツールを公開します。両者のスキーマを混在させないでください。複数リクエストにまたがるリモートセッションには MCP.md のステートフル HTTP 例または stdio を使います。リクエスト単位の簡易 HTTP Handler はメモリ内のセッション管理を保持しません。

任意の system-browser-interactive-qa Skill が manifest に含まれ、主 Skill は UI デバッグ・受入確認をその参照に誘導します。永続セッションでの反復、機能の事後条件、画像確認、viewport 証拠を扱います。state/browser.snapshot は scope=active/all、正確な frame、一意 selector、query、maxOutputChars に対応します。nextCursor は同じ不変観測を継続し、選択条件を変えず、2 分・遷移・新観測・code 操作で失効します。capturedAt は過去の時刻なので操作前に現在の locator を確認します。失敗結果は executionState と requiresStateRefresh を含み、中断/タイムアウト/クラッシュでは一部実行済みの場合があり、kernelReset で JavaScript 変数は失われます。
