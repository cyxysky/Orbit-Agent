# @webpilot/capability-code-sandbox

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

交換可能な実行器で制限付き JavaScript/Python 計算を実行します。

この README は完全な接続の入口です。任意の TypeScript Agent フレームワークでは手順 1–4、または後述の AI SDK/MCP を使います。例にあるファイルはすべて**利用側のプロジェクト**に作成し、このパッケージ内には作りません。

## 1. インストールと準備

Node.js >=22.16 と ESM TypeScript を使います。例は 0.1.0 ワークスペースの契約に対応しています。設定した npm レジストリから一致する版を導入してください。未公開なら管理者の同版リリース tarball/ワークスペースを使います。レジストリの 404 は実行時エラーではありません。異なるリリースを混在させないでください。新規プロジェクトでは：

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-code-sandbox @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

ローカル例は信頼された計算を実行して短い結果を表示し、OS 隔離は提供しません。JavaScript は ESM なので裸の require ではなく import を使います。Python にはインストール済みのインタープリターが必要で、`pythonExecutable` で選択できます。依存は `lodash@4.17.21` や `requests==2.32.3` のように固定します。

隔離済み HTTP runner がある場合は `/remote` の `createHttpCodeSandboxCapability({ url, token })` を使います。runner は利用側が別途配置します。`AGENT_CODE_SANDBOX_BACKEND` だけでは明示的に選んだファクトリーは変わりません。ローカル版では `networkMode: "none"` を強制できず、CPU・メモリ・ネットワーク隔離は実行バックエンドの担当です。

最小ファクトリーは出力ファイルを公開しません。outputs にファイルを作る場合は、`createCodeSandboxCapability({ createExecutor })` で `createNodeProcessCodeSandbox` または `createHttpCodeSandboxExecutor` をラップします。内部の `files[].base64` を保存して files を artifacts に置き換え、readFile と artifactInputs から inputFiles への解決を実装します。内部 Base64 をモデルへ返さないでください。具体的な成果物アダプターを後述します。解放時にはローカル実行ワークスペースが削除されるため、成果物は別の場所へ保存します。stdout/stderr の切り詰めとプロセス失敗は別の状態です。

## 2. Provider の作成

`provider.ts` として保存します。Provider、最初の有効な呼び出し、明示的な設定、ホストの後処理を公開します。

```ts
import { createNodeCodeSandboxCapability } from '@webpilot/capability-code-sandbox/node';
 const provider = createNodeCodeSandboxCapability({
   workspaceDirectory: (context) => `./agent-data/code/${context.runId}`,
 });

export const providers = [provider];
export const configurations = {
  "com.webpilot.code-sandbox": {
    "AGENT_CODE_SANDBOX_ENABLED": "true",
    "AGENT_CODE_SANDBOX_BACKEND": "local"
  }
};
export const exampleCall = {
  "name": "codeSandbox",
  "input": {
    "action": "run",
    "reason": "Check JavaScript execution",
    "language": "javascript",
    "code": "console.log(JSON.stringify({ total: [1, 2, 3].reduce((a, b) => a + b, 0) }));"
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
| `AGENT_CODE_SANDBOX_ENABLED` | `false` | `runtime` |
| `AGENT_CODE_SANDBOX_BACKEND` | `remote` | `runtime` |
| `AGENT_CODE_SANDBOX_RUNNER_URL` | `http://webpilot-code-sandbox:18100` | `runtime` |
| `AGENT_CODE_SANDBOX_RUNNER_TOKEN` | `` | `runtime` |
| `AGENT_CODE_SANDBOX_TIMEOUT_MS` | `30000` | `runtime` |
| `AGENT_CODE_SANDBOX_INSTALL_TIMEOUT_MS` | `120000` | `runtime` |
| `AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS` | `30000` | `runtime` |
| `AGENT_CODE_SANDBOX_NETWORK_MODE` | `full` | `runtime` |
| `AGENT_CODE_SANDBOX_ALLOW_PACKAGE_INSTALL` | `true` | `runtime` |
| `AGENT_CODE_SANDBOX_MAX_PACKAGES` | `16` | `runtime` |
| `AGENT_CODE_SANDBOX_MAX_CONCURRENCY` | `2` | `runtime` |
| `AGENT_CODE_SANDBOX_MEMORY_MB` | `512` | `runtime` |
| `AGENT_CODE_SANDBOX_CPU_LIMIT` | `1` | `runtime` |
| `AGENT_CODE_SANDBOX_PIDS_LIMIT` | `128` | `runtime` |
| `AGENT_CODE_SANDBOX_WORKSPACE_MB` | `256` | `runtime` |

## トラブル対処と接続完了の確認

- モジュールがない：公開 exports、版の一致、Node/ESM、入口の任意 peer を確認します。
- ツールがない：runtime.tools、有効な能力 ID、許可名を確認し、フォルダー名から推測しません。
- 検証失敗：実際の inputSchema と parse エラーを使い、別入口のスキーマを流用しません。
- 無効/未提供の操作：正規化設定、選択バックエンド、実行バイナリー、ホストコールバックを確認します。
- Skill が反映されない：モデル呼び出し前に eager 指示を追加するか、lazy 読み取りと公開ポリシーを実装します。
- タイムアウトは副作用がなかった証拠ではありません。再試行前に保存済み/現在の状態を確認します。
- 完了条件：最初の呼び出しが ok: true、Agent が同じスキーマと完全な結果を受け取り、必要なファイル/画像を利用でき、終了時に資源が解放されることです。

## 公開エントリーポイント

- `@webpilot/capability-code-sandbox`
- `@webpilot/capability-code-sandbox/node`
- `@webpilot/capability-code-sandbox/remote`
- `@webpilot/capability-code-sandbox/mcp`
- `@webpilot/capability-code-sandbox/runtime-skill`
- `@webpilot/capability-code-sandbox/settings`

## サンドボックス出力ファイルの公開

provider.ts の能力作成を任意で置き換えます。configurations/exampleCall/cleanup を保持し、結合時には重複 provider export を除きます。このラッパーは実行別登録、出力公開、有界ページ読み取り、後続入力を実装します。再起動を越えるには登録メタデータを保存し、ダウンロードルートを提供します。worker は一時ディレクトリだけを所有します。HTTP runner では /remote の createHttpCodeSandboxExecutor({url,token}) に置き換えます。出力は最大 16 ファイル、1 件 10 MB、合計 32 MB で、runner がシンボリックリンクと範囲外パスを拒否します。

既存リポジトリ説明にある本番 runner と Dockerfile は Orbit アプリのもので、この npm パッケージには含まれません。独立ホストは POST /execute、GET /health を実装した隔離 runner（/remote 用）または独自 CodeSandboxExecutor を用意します。ローカル例は信頼された単一マシン向けです。

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCodeSandboxCapability, type CodeSandboxArtifact } from '@webpilot/capability-code-sandbox';
import { createNodeProcessCodeSandbox } from '@webpilot/capability-code-sandbox/node';

export const provider = createCodeSandboxCapability({
  createExecutor(context) {
    const worker = createNodeProcessCodeSandbox({
      workspaceDirectory: path.resolve('./agent-data/code-work', context.runId),
    });
    // Published files are outside the disposable worker directory.
    const directory = path.resolve('./agent-data/code-artifacts', context.runId);
    const artifacts = new Map<string, CodeSandboxArtifact & { absolutePath: string }>();
    function lookup(id: string) {
      const artifact = artifacts.get(id);
      if (!artifact) throw new Error('Unknown artifact in this run');
      return artifact;
    }
    return {
      async run(input, execution) {
        const inputFiles = await Promise.all((input.artifactInputs || []).map(async item => {
          const artifact = lookup(item.artifactId);
          return { path: item.path, base64: (await readFile(artifact.absolutePath)).toString('base64') };
        }));
        const result = await worker.run({ ...input, artifactInputs: undefined, inputFiles }, execution);
        const { files = [], ...publicResult } = result;
        const published: CodeSandboxArtifact[] = [];
        await mkdir(directory, { recursive: true });
        for (const file of files) {
          const id = randomUUID();
          const fileName = path.basename(file.path);
          const target = path.join(directory, id);
          const bytes = Buffer.from(file.base64, 'base64');
          await writeFile(target, bytes, { flag: 'wx' });
          const artifact: CodeSandboxArtifact = { artifactId: id, fileName,
            size: bytes.length, mediaType: 'application/octet-stream',
            url: pathToFileURL(target).href, downloadUrl: pathToFileURL(target).href };
          artifacts.set(id, { ...artifact, absolutePath: target });
          published.push(artifact);
        }
        return { ...publicResult, artifacts: published };
      },
      async readFile(input) {
        const { absolutePath, ...artifact } = lookup(input.artifactId);
        const bytes = await readFile(absolutePath);
        const offset = Math.min(bytes.length, Math.max(0, input.offset || 0));
        const end = Math.min(bytes.length, offset + Math.min(65536, Math.max(1, input.limit || 8192)));
        const encoding = input.encoding || 'utf8';
        return { ...artifact, encoding, content: bytes.subarray(offset, end).toString(encoding),
          offset, nextOffset: end < bytes.length ? end : undefined, totalBytes: bytes.length };
      },
      health: () => worker.health?.() || Promise.resolve({ status: 'healthy' as const }),
      dispose: () => worker.dispose?.() || Promise.resolve(),
    };
  },
});
```

## 補足の動作リファレンス

ローカル例は信頼された計算を実行して短い結果を表示し、OS 隔離は提供しません。JavaScript は ESM なので裸の require ではなく import を使います。Python にはインストール済みのインタープリターが必要で、`pythonExecutable` で選択できます。依存は `lodash@4.17.21` や `requests==2.32.3` のように固定します。

隔離済み HTTP runner がある場合は `/remote` の `createHttpCodeSandboxCapability({ url, token })` を使います。runner は利用側が別途配置します。`AGENT_CODE_SANDBOX_BACKEND` だけでは明示的に選んだファクトリーは変わりません。ローカル版では `networkMode: "none"` を強制できず、CPU・メモリ・ネットワーク隔離は実行バックエンドの担当です。

最小ファクトリーは出力ファイルを公開しません。outputs にファイルを作る場合は、`createCodeSandboxCapability({ createExecutor })` で `createNodeProcessCodeSandbox` または `createHttpCodeSandboxExecutor` をラップします。内部の `files[].base64` を保存して files を artifacts に置き換え、readFile と artifactInputs から inputFiles への解決を実装します。内部 Base64 をモデルへ返さないでください。具体的な成果物アダプターを後述します。解放時にはローカル実行ワークスペースが削除されるため、成果物は別の場所へ保存します。stdout/stderr の切り詰めとプロセス失敗は別の状態です。
