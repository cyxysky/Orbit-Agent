# @webpilot/capability-chart

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

ECharts/Three.js のチャートレコードを生成・保存・編集し、必要に応じて React で描画します。

この README は完全な接続の入口です。任意の TypeScript Agent フレームワークでは手順 1–4、または後述の AI SDK/MCP を使います。例にあるファイルはすべて**利用側のプロジェクト**に作成し、このパッケージ内には作りません。

## 1. インストールと準備

Node.js >=22.16 と ESM TypeScript を使います。例は 0.1.0 ワークスペースの契約に対応しています。設定した npm レジストリから一致する版を導入してください。未公開なら管理者の同版リリース tarball/ワークスペースを使います。レジストリの 404 は実行時エラーではありません。異なるリリースを混在させないでください。新規プロジェクトでは：

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-chart @webpilot/capability-sdk @webpilot/capability-host echarts@^6
npm install -D typescript tsx @types/node
```

Node の検証には ECharts 6 が必要です。結果はチャートレコードであり、ホスト済み Web ページではありません。`chartId` を保存し、更新前に read して最新の `revision` を `expectedRevision` に渡します。リビジョンファイルは不変で、古い版への書き込みは失敗します。`api` でパッケージの例とスキーマを取得できます。

UI には React 19、必要に応じて Three.js `>=0.184.0 <0.186` をインストールし、`/react` から `ChartRenderer` を読み込みます。`ChartRecord` と、自分の保存 API に接続した `onSave(nextRecord, expectedRevision)` / `onReload()` を渡します。描画コンポーネント自体は HTTP 通信を行いません。Three.js には WebGL2 が必要です。JSON formatter はテンプレート文字列を使い、JavaScript 関数のソースは使いません。

## 2. Provider の作成

`provider.ts` として保存します。Provider、最初の有効な呼び出し、明示的な設定、ホストの後処理を公開します。

```ts
import { createNodeChartCapability } from '@webpilot/capability-chart/node';
 const provider = createNodeChartCapability({ directory: './agent-data/charts' });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "chart",
  "input": {
    "action": "create",
    "reason": "Create a small example chart",
    "title": "Example",
    "renderer": "svg",
    "option": {
      "xAxis": {
        "type": "category",
        "data": [
          "A",
          "B"
        ]
      },
      "yAxis": {
        "type": "value"
      },
      "series": [
        {
          "type": "bar",
          "data": [
            3,
            5
          ]
        }
      ]
    }
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

## トラブル対処と接続完了の確認

- モジュールがない：公開 exports、版の一致、Node/ESM、入口の任意 peer を確認します。
- ツールがない：runtime.tools、有効な能力 ID、許可名を確認し、フォルダー名から推測しません。
- 検証失敗：実際の inputSchema と parse エラーを使い、別入口のスキーマを流用しません。
- 無効/未提供の操作：正規化設定、選択バックエンド、実行バイナリー、ホストコールバックを確認します。
- Skill が反映されない：モデル呼び出し前に eager 指示を追加するか、lazy 読み取りと公開ポリシーを実装します。
- タイムアウトは副作用がなかった証拠ではありません。再試行前に保存済み/現在の状態を確認します。
- 完了条件：最初の呼び出しが ok: true、Agent が同じスキーマと完全な結果を受け取り、必要なファイル/画像を利用でき、終了時に資源が解放されることです。

## 公開エントリーポイント

- `@webpilot/capability-chart`
- `@webpilot/capability-chart/core`
- `@webpilot/capability-chart/node`
- `@webpilot/capability-chart/react`
- `@webpilot/capability-chart/runtime-skill`
- `@webpilot/capability-chart/settings`
- `@webpilot/capability-chart/mcp`

## 補足の動作リファレンス

ファイルストアはディレクトリ索引をキャッシュし、既定で最新 20 版と不変の原本を保持します。retainedRevisions は 1–1000 です。公開は原子的で古い編集は拒否します。React はデータ更新時に ECharts インスタンスを再利用し、描画器変更や Three.js 形状再構築時は作り直します。全画面、PNG/JSON/CSV、SVG 描画時の SVG 出力、アクセシブルな表/JSON 編集ダイアログを含みます。ツールバー、アイコン、メニュー、フォーカス、CSS は同梱され、Orbit、Next.js、会話 API、アプリ CSS に依存せず HTTP も行いません。onSave がなければ変更は現在のページだけです。

JSON モードはローカル CodeMirror 6 を遅延読込し、暗色テーマ、強調表示、行番号、折り畳み、undo/redo、字下げ、JSON 診断を備えます。選択モードを表示し、確認ボタンは常時表示、無変更なら閉じ、変更があれば検証して onSave を呼びます。api/create/read/update を公開し、update は最新 expectedRevision が必要です。現行実装は既存 version-2 記録の読み取りと編集も可能です。

ECharts formatter は `{b}: {c}` 等のテンプレートを使い、JavaScript 関数ソースは使いません。作成/更新では不正パスを報告し、旧記録の関数文字列は読み取り時にメモリ内だけで省き、原本は変更しません。ウォーターフォールの空白系列は tooltip.show=false にします。Three.js は bar3D/scatter3D/line3D/surface3D を提供し、点は [x,y,z]、z が高さ、曲面は行優先 grid:{rows,columns} が必要です。api query=three を先に読み、React 3D には任意 Three.js peer と WebGL2 が必要で、3D 表示時だけ読み込みます。単純な ECharts 棒/線/散布にも非永続の 3D プレビューがあります。webpilot-chart-mcp の保存先は CAPABILITY_CHART_ARTIFACTS_DIR または ARTIFACTS_DIR です。
