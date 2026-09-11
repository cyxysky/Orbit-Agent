# @webpilot/capability-media

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

メディアの調査、フレーム抽出、ホストが選んだ OCR・文字起こし・生成エンジンへの接続を行います。

この README は完全な接続の入口です。任意の TypeScript Agent フレームワークでは手順 1–4、または後述の AI SDK/MCP を使います。例にあるファイルはすべて**利用側のプロジェクト**に作成し、このパッケージ内には作りません。

`mediaConfigurationForProviders` ????????????? Codex CLI ??????????????????????? Codex ??????????API ???URL???? ID ????????????????????????????`ai-sdk-provider-codex-cli` ??????????????? Codex CLI ??????CLI ?????????????????????????????????????????????????????????????????????

## 1. インストールと準備

Node.js >=22.16 と ESM TypeScript を使います。例は 0.1.0 ワークスペースの契約に対応しています。設定した npm レジストリから一致する版を導入してください。未公開なら管理者の同版リリース tarball/ワークスペースを使います。レジストリの 404 は実行時エラーではありません。異なるリリースを混在させないでください。新規プロジェクトでは：

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-media @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

FFmpeg/ffprobe をインストールし、`MEDIA_SOURCE_PATH` を設定します。この実行可能な例はメディア調査と JPEG フレーム抽出を実装します。ホストは不透明な `sourceRef` を許可されたファイルに対応付け、一時ディレクトリの削除前にフレームを永続ストレージへコピーします。リモート利用では file URL を認証付き成果物配信に置き換えます。

OCR と文字起こしには明示的な `ocr`/`transcribe` 実装が必要で、FFmpeg は提供しません。生成には `/ai-sdk` の `createAiSdkMediaGenerationOperations({ configuration, readSource, publishArtifact })` を調査操作と組み合わせます。その入口を使う場合は AI SDK と選択したプロバイダーのパッケージが必要です。`/models` と `/model-settings` で設定し、`listModels` が返す設定 ID を `modelRef` に使います。この例は生成モデルを設定しません。

画像・動画・音声生成は Base64 ではなく成果物メタデータを返し、FFmpeg を必要としません。動画のポーリングと総タイムアウトには上限があり、中断結果が不明な有料生成を自動再送しないでください。`url` は埋め込み、`downloadUrl` はダウンロードに使います。

## 2. Provider の作成

`provider.ts` として保存します。Provider、最初の有効な呼び出し、明示的な設定、ホストの後処理を公開します。

```ts
import { copyFile, mkdir } from 'node:fs/promises';
 import { randomUUID } from 'node:crypto';
 import path from 'node:path';
 import { pathToFileURL } from 'node:url';
 import { createMediaCapability } from '@webpilot/capability-media';
 import { createFfmpegMediaOperations } from '@webpilot/capability-media/node';
 const sourcePath = process.env.MEDIA_SOURCE_PATH;
 if (!sourcePath) throw new Error('Set MEDIA_SOURCE_PATH to a local media file');
 const sources = new Map([['sample', path.resolve(sourcePath)]]);
 const provider = createMediaCapability({ createOperations: () => createFfmpegMediaOperations({
   ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
   ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
   async resolveSource(sourceRef) {
     const source = sources.get(sourceRef);
     if (!source) throw new Error('Unknown sourceRef');
     return source;
   },
   async publishArtifact(filePath) {
     const directory = path.resolve('./agent-data/media');
     await mkdir(directory, { recursive: true });
     const fileName = randomUUID() + path.extname(filePath);
     const target = path.join(directory, fileName);
     await copyFile(filePath, target);
     return { artifactId: fileName, fileName, mediaType: 'image/jpeg',
       url: pathToFileURL(target).href, downloadUrl: pathToFileURL(target).href };
   },
 }) });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "media",
  "input": {
    "action": "inspect",
    "reason": "Inspect registered media",
    "sourceRef": "sample"
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
| `AGENT_MEDIA_TIMEOUT_MS` | `120000` | `runtime` |
| `AGENT_MEDIA_MAX_FRAMES` | `12` | `runtime` |

## トラブル対処と接続完了の確認

- モジュールがない：公開 exports、版の一致、Node/ESM、入口の任意 peer を確認します。
- ツールがない：runtime.tools、有効な能力 ID、許可名を確認し、フォルダー名から推測しません。
- 検証失敗：実際の inputSchema と parse エラーを使い、別入口のスキーマを流用しません。
- 無効/未提供の操作：正規化設定、選択バックエンド、実行バイナリー、ホストコールバックを確認します。
- Skill が反映されない：モデル呼び出し前に eager 指示を追加するか、lazy 読み取りと公開ポリシーを実装します。
- タイムアウトは副作用がなかった証拠ではありません。再試行前に保存済み/現在の状態を確認します。
- 完了条件：最初の呼び出しが ok: true、Agent が同じスキーマと完全な結果を受け取り、必要なファイル/画像を利用でき、終了時に資源が解放されることです。

## 公開エントリーポイント

- `@webpilot/capability-media`
- `@webpilot/capability-media/node`
- `@webpilot/capability-media/model-settings`
- `@webpilot/capability-media/models`
- `@webpilot/capability-media/ai-sdk`
- `@webpilot/capability-media/mcp`
- `@webpilot/capability-media/runtime-skill`
- `@webpilot/capability-media/settings`

## 生成モデルの接続例

互換 Images API サービス向けの代替 provider.ts です。ai@>=7 <8 と @ai-sdk/openai-compatible を導入し、実際の MEDIA_MODEL_BASE_URL、MEDIA_MODEL_ID、MEDIA_MODEL_API_KEY を設定します。最初はモデル一覧を返し、生成には media に { action: "generateImage", reason: "Create an image", prompt: "A blue ceramic cup", modelRef: "image-main" } を渡します。他のプロトコルは driver/kind と対応 SDK を変更します。生成専用ホストの inspect は明示的に未提供を返します。公開処理はローカル保存なので、リモート利用には配信 URL が必要です。

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMediaCapability } from '@webpilot/capability-media';
import { mediaModelConfigurationSchema } from '@webpilot/capability-media/models';
import { createAiSdkMediaGenerationOperations } from '@webpilot/capability-media/ai-sdk';
const model = process.env.MEDIA_MODEL_ID;
const baseURL = process.env.MEDIA_MODEL_BASE_URL;
if (!model || !baseURL) throw new Error('Set MEDIA_MODEL_ID and MEDIA_MODEL_BASE_URL');
const configuration = mediaModelConfigurationSchema.parse({
  models: [{ id: 'image-main', kind: 'image', name: 'My image service',
    driver: 'openai-compatible', model, baseURL, enabled: true,
    apiKey: process.env.MEDIA_MODEL_API_KEY }],
  defaults: { image: 'image-main' },
});
// Register only host-approved source files. Unknown references fail explicitly.
const sources = new Map<string, string>();
if (process.env.MEDIA_SOURCE_PATH) sources.set('sample', path.resolve(process.env.MEDIA_SOURCE_PATH));
const generation = createAiSdkMediaGenerationOperations({
  configuration,
  async readSource(ref) {
    const source = sources.get(ref);
    if (!source) throw new Error('Unknown media source');
    return readFile(source);
  },
  async publishArtifact(file) {
    const directory = path.resolve('./agent-data/generated-media');
    await mkdir(directory, { recursive: true });
    const extensions: Record<string, string> = {
      'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
      'video/mp4': '.mp4', 'audio/mpeg': '.mp3', 'audio/wav': '.wav',
    };
    const fileName = randomUUID() + (extensions[file.mediaType] || '.bin');
    const target = path.join(directory, fileName);
    await writeFile(target, file.data, { flag: 'wx' });
    return { artifactId: fileName, fileName, mediaType: file.mediaType,
      url: pathToFileURL(target).href, downloadUrl: pathToFileURL(target).href };
  },
});
const provider = createMediaCapability({ createOperations: () => ({
  ...generation,
  async inspect() { throw new Error('Inspection is not configured in this generation-only host'); },
}) });
export const providers = [provider];
export const configurations = {};
export const exampleCall = { name: 'media', input: {
  action: 'listModels', reason: 'Inspect available generation models',
} };
export async function cleanup() {}
```

## 補足の動作リファレンス

成果物は data に各ファイルを一度だけ返し、content に一覧を重複しません。artifactId、fileName、mediaType、url、downloadUrl を持ち、アプリ相対 URL はそのまま使います。/models はモデル構造とドライバー一覧を提供し、kind、安定 id、driver、provider model、認証、baseURL、パス、既定パラメーター、timeout を持ちます。defaults は image/video/speech を別々に選びます。削除時は秘密情報も削除し、空 key は保存値を維持、clearApiKey で明示削除し、公開スナップショットは key を隠します。/model-settings はフォーム、既定値、選択と解決契約を提供し、UI はホストが描画します。

ドライバーは OpenAI の画像/音声、OpenAI-compatible の Base64/URL 画像と音声、MiniMax の原生画像と被写体参照、Google の Imagen/Gemini 画像・Veo 動画・Gemini TTS、xAI の Grok 画像/動画と model ID 不要 TTS、Alibaba の Wan/DashScope 動画を含みます。要求、認証、動画ポーリングは各実装が行い、baseURL/path の変更では別プロトコルに変換されません。パスは baseURL 相対で {model}/{id}/{operation} を保持します。追加パラメーターは選択 SDK provider の名前に従い、互換画像は生の要求フィールドを使い、モデル名は固定しません。

MiniMax は aspect_ratio、width/height、subject_reference を使い mask は非対応です。旧互換設定が公式 MiniMax /image_generation を指す場合は現行実装が認識し、独自ゲートウェイは MiniMax driver を選びます。画像編集は sourceRefs と任意 maskRef、画像→動画は 1 枚の参照を使います。generateSpeech は読み上げであり音楽/効果音ではありません。ホストの selectedModels が modelRef より優先されます。中断、ポーリング、総タイムアウトを制限し、有料生成を自動再送しません。ローカル中断はリモート停止を保証しません。

FFmpeg は出力時間ゼロでストリームヘッダーを検査します。中断/タイムアウトでは子プロセスツリーを停止し、不完全な stderr を成功として扱いません。
