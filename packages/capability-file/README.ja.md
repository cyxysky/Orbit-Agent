# @webpilot/capability-file

## JavaScript モード: Excel と HTML 文書

`OFFICE_GENERATION_MODE=javascript` では XLSX は従来の ExcelJS を使用し、DOCX・PPTX・PDF は HTML ソースから生成します。計画は `generator:html` と `.html` ファイル名を返します。`jsApi(documentId)` で仕様を確認し、完全な HTML を `generate.program` に渡します。編集・保存・検証は同じ文書ワークフローです。

PPTX は同じ寸法の `section[data-slide]` をページとして扱います。テキストと表は編集可能な Office オブジェクト、SVG・画像は画像素材になります。任意の CSS の完全な変換は保証しません。MD・TXT・HTML・JS・CSS・JSON・YAML・CSV 等は全モードで `file.write({fileName,content})` により UTF-8 のまま保存できます。HTML には Chromium、Office ファイルのプレビューには LibreOffice が必要です。既存ファイルの変更と明示的な UNO モードは UNO を使用します。

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

ファイルの読み取りと公開、Office 文書の生成・編集、成果物ワークスペースの管理を行います。

この README は完全な接続の入口です。任意の TypeScript Agent フレームワークでは手順 1–4、または後述の AI SDK/MCP を使います。例にあるファイルはすべて**利用側のプロジェクト**に作成し、このパッケージ内には作りません。

## 1. インストールと準備

Node.js >=22.16 と ESM TypeScript を使います。例は 0.1.0 ワークスペースの契約に対応しています。設定した npm レジストリから一致する版を導入してください。未公開なら管理者の同版リリース tarball/ワークスペースを使います。レジストリの 404 は実行時エラーではありません。異なるリリースを混在させないでください。新規プロジェクトでは：

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-file @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

最初の呼び出しは UTF-8 テキストを書き込むだけなので Office のインストールは不要です。Office の生成は `plan → generate → render` の順に行い、作成前に Skill と plan が返すエンジン/API の説明を読みます。ローカルの Office 変換には LibreOffice、UNO による作成にはさらに `import uno` が可能な Python が必要です。JavaScript による作成とファイル変換の要件は別です。`OFFICE_GENERATION_MODE` を明示的に設定してください。

画像プレビューが有効な場合、`render` は現在の `artifactId`、総ページ数、スクリーンショット ID とページ番号、`nextOffset`、そのまま呼び出せる `nextRead` を含む `visualIndex` を返します。同じ一覧を再取得せずに `visualRead` を実行できます。既定では最初の 100 件を返し、追加の一覧や失われた索引が必要な場合だけ `visualIndex` を呼びます。再描画後は新しい結果の ID を使います。一覧の取得だけで画像の確認や品質検証が完了したことにはなりません。

`readSource(documentId)` は生成コード、`readContent(artifactId)` は公開済みの内容を読みます。`edit` には `readSource` が返した正確な `patchBaseDigest` を渡し、編集後に再度 render します。ホストが `readFileVisuals` を提供し、画像を実際にモデルへ渡す場合だけ画像入力を有効にします。添付ファイルには `attachmentBindings` またはホストの `readFile` 実装が必要です。

既定の成果物 URL はサーバーローカルの `file:` URL です。リモートクライアントはダウンロードできません。`workspace.artifactUrl({ absolutePath, relativePath })` と、対応するバイト列を配信する認証付きルートまたはオブジェクトストレージを用意します。URL の生成だけではファイルは配信されません。同じ実行の下書きや成果物を扱う間は run ID を維持してください。

## 2. Provider の作成

`provider.ts` として保存します。Provider、最初の有効な呼び出し、明示的な設定、ホストの後処理を公開します。

```ts
import { createNodeFileCapability, disposeUnoRuntime } from '@webpilot/capability-file/node';
 const provider = createNodeFileCapability({
   workspace: { artifactsRoot: './agent-data/files' },
   visualInputAvailable: false,
 });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "file",
  "input": {
    "action": "write",
    "fileName": "hello.md",
    "content": "# Hello\n\nCreated by the file capability.\n"
  }
};
export async function cleanup() { await disposeUnoRuntime(); }
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
| `OFFICE_GENERATION_MODE` | `uno` | `runtime` |

## トラブル対処と接続完了の確認

- モジュールがない：公開 exports、版の一致、Node/ESM、入口の任意 peer を確認します。
- ツールがない：runtime.tools、有効な能力 ID、許可名を確認し、フォルダー名から推測しません。
- 検証失敗：実際の inputSchema と parse エラーを使い、別入口のスキーマを流用しません。
- 無効/未提供の操作：正規化設定、選択バックエンド、実行バイナリー、ホストコールバックを確認します。
- Skill が反映されない：モデル呼び出し前に eager 指示を追加するか、lazy 読み取りと公開ポリシーを実装します。
- タイムアウトは副作用がなかった証拠ではありません。再試行前に保存済み/現在の状態を確認します。
- 完了条件：最初の呼び出しが ok: true、Agent が同じスキーマと完全な結果を受け取り、必要なファイル/画像を利用でき、終了時に資源が解放されることです。

## 公開エントリーポイント

- `@webpilot/capability-file`
- `@webpilot/capability-file/node`
- `@webpilot/capability-file/formats`
- `@webpilot/capability-file/office`
- `@webpilot/capability-file/runtime-skill`
- `@webpilot/capability-file/settings`
- `@webpilot/capability-file/mcp`
- `@webpilot/capability-file/node/artifacts`
- `@webpilot/capability-file/node/convert`
- `@webpilot/capability-file/node/download`
- `@webpilot/capability-file/node/generate`
- `@webpilot/capability-file/node/office`
- `@webpilot/capability-file/node/read`
- `@webpilot/capability-file/node/text-extraction`
- `@webpilot/capability-file/node/workspace`

## 生成ファイルをリモートクライアントに配信

単一利用者向けの完全なダウンロード経路です。artifact-server.ts として保存し、別端末で npx tsx artifact-server.ts を実行します。同じ File ワークスペースを配信し、シンボリックリンクを含めた実パスを検証してストリーム送信します。作業ディレクトリが違う場合は両プロセスで同じ絶対 FILE_ARTIFACTS_DIR を使います。リモートでは FILE_BIND_ADDRESS/FILE_PORT と HTTPS を設定します。FILE_DOWNLOAD_TOKEN はローカルでは任意、リモートでは必須です。例は 1 つのルートを 1 利用者と扱うため、複数ユーザーではパス解決前に所有権を調べます。

2 つ目のブロックで Provider 作成を置き換え、既存 export と cleanup を維持します。FILE_PUBLIC_URL はクライアントから到達できる origin または基底パスです。認証有効時は Bearer ヘッダーを送り、ブラウザーのリンクにはアプリのセッションまたは短期署名 URL を統合します。ツールは URL に認証情報を埋め込みません。

```ts
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { artifactContentType } from '@webpilot/capability-file/formats';
const directory = path.resolve(process.env.FILE_ARTIFACTS_DIR || './agent-data/files');
await mkdir(directory, { recursive: true });
const root = await realpath(directory);
const port = Number(process.env.FILE_PORT || 3101);
const hostname = process.env.FILE_BIND_ADDRESS || '127.0.0.1';
const token = process.env.FILE_DOWNLOAD_TOKEN;
if (!['127.0.0.1', '::1'].includes(hostname) && !token) throw new Error('Set FILE_DOWNLOAD_TOKEN');
const server = createServer((req, res) => { void (async () => {
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end(); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/artifacts/')) { res.writeHead(404).end(); return; }
  const relativePath = decodeURIComponent(url.pathname.slice('/artifacts/'.length));
  const candidate = await realpath(path.resolve(root, relativePath));
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    res.writeHead(403).end(); return;
  }
  const info = await stat(candidate);
  if (!info.isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {
    'content-type': artifactContentType(candidate),
    'content-length': String(info.size), 'x-content-type-options': 'nosniff',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(candidate))}`,
    'cache-control': 'private, no-store',
  });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(candidate), res);
})().catch(error => {
  console.error(error);
  if (!res.headersSent) res.writeHead(404).end(); else res.destroy();
}); });
server.listen(port, hostname, () => console.error(`Artifact server listening on ${hostname}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.close(); server.closeAllConnections(); });
}
```

```ts
import { createNodeFileCapability, disposeUnoRuntime } from '@webpilot/capability-file/node';
const publicBase = process.env.FILE_PUBLIC_URL || 'http://127.0.0.1:3101';
const provider = createNodeFileCapability({
  workspace: {
    artifactsRoot: process.env.FILE_ARTIFACTS_DIR || './agent-data/files',
    artifactUrl: ({ relativePath }) => publicBase.replace(/\/$/, '') + '/artifacts/'
      + relativePath.split(/[\\/]/).map(encodeURIComponent).join('/'),
  },
  visualInputAvailable: false,
});
// Retain provider.ts's providers, configurations, exampleCall and cleanup exports.
```

## 補足の動作リファレンス

ルートは file 契約、動的 JSON Schema、入力正規化、検証、manifest、操作ルーティング、実行時 Skill、Office 文書モデル、MIME 登録を提供します。/node は成果物のパス検証・メタデータ・URL・一意名・ハッシュ、制限付きダウンロードと同一オリジン並行制御・キャッシュ・再試行・中断、LibreOffice/UNO Python 検出、注入可能な変換/プレビュー、JavaScript/Python Office worker、Word/PPT/Excel テンプレート、DOCX 構造検査と DOCX/XLSX/PPTX 生成、ソース/成果物検証、添付テキスト抽出を含みます。既定の変換はローカル LibreOffice で、リモート変換器も注入できます。

図解用の任意 Skill は `system-file-diagram-design`、`system-file-diagram-structure`、`system-file-diagram-process`、`system-file-diagram-time`、`system-file-diagram-data` です。主 Skill が必要な参照へ誘導し、ホストが正確な ID で読みます。全文を主 Skill に埋め込まず、通常操作に読み取りゲートを追加しません。既存 JavaScript/UNO と検証を使い、HTML→Office 変換、描画 API、字体依存、固定テーマは追加しません。現行の同梱ライセンスは [licenses/](licenses/) にあります。

`write(fileName, content)` は UTF-8 をそのまま保存し、字下げ、改行、末尾空白、空ファイルを保持します。上限は 1,000,000 文字です。Markdown/TXT/HTML/JS/CSS/JSON/YAML/CSV/SVG 等のテキストに対応し、コードは実行しません。バイナリーには生成器を使います。書き込みごとに不変の成果物と artifactId・ダウンロード URL を返します。

`list` は下書き、`readSource(documentId)` は生成コード、`readContent(artifactId または attachmentId)` は公開/添付内容です。既定は 8,000 文字で offset/limit は文字単位、小さい limit も尊重します。プレビューには includeVisuals が必要です。Excel は sheet と A1 range を使い、複数シートでは sheet 必須、最大 100,000 セルです。PDF は 1 始まりの contentPages、DOCX は正確で一意な section 見出しを使い、曖昧なら失敗します。pages は画像プレビュー範囲で、offset は選択済み内容内の位置です。

抽出キャッシュは SHA-256、解析器版、内容選択に基づき、offset/limit だけの変更で再利用できます。worker は既定で 30 秒維持します。CPU_WORKER_COUNT、MAX_QUEUED、QUEUE_TIMEOUT_MS、TASK_TIMEOUT_MS、MAX_FILE_BYTES、MAX_HEAP_MB、TEXT_CACHE_BYTES、IDLE_TIMEOUT_MS はすべて CPU_WORKER_ 接頭辞付きで設定します。待機中の中断に対応し、実行スロットは worker 後処理後に解放します。worker は runtime/ に同梱され、UNO/JavaScript 作成、下書きロック、同一オリジンのダウンロードにも有界・中断可能なキューを使います。

createNodeFileDownloadReceiver は実際のブラウザーダウンロードを run の downloads/ に保存し、URL を再取得しません。既定 readContent は同じ run の成果物と登録済み添付だけを読み、ホスト readFile で変更できます。readSource はソース・位置・digest・検証状態・診断件数を一度だけ返します。includeDiagnostics は保存済み診断を読み、再検証しません。summary は短いラベルで data を重複しません。Calc の同一セル/範囲、書式、行高、列幅の更新は要素 ID を再利用できますが、新規オブジェクトや別対象は衝突を検査します。

ソースと内容 ID の混用は失敗し、reason はルーティングを変えません。現行の伝送境界は旧 read を readSource/readContent に正規化でき、旧ホスト read handler も残っていますが、新規接続は明示的な操作名を使います。下書き/描画結果の sourceRead と成果物の contentRead をホスト登録や圧縮要約でも区別します。修正は readSource → edit → render で、再読込のための再生成は不要です。

edit は現在の patchBaseDigest と正確な replacements または Codex patch を使います。同じ元スナップショットで一意・非重複の対象を探し、ソース単位パスで限定できます。空白や記号の曖昧一致はしません。全変更は原子的で、衝突は failed/blocked、changed=false、saved=false を返します。古い版は拒否し、直近の完全一致要求と結果版の保存済み受領記録だけを重複排除します。新しい文字列があるだけでは編集の証拠になりません。検証失敗ソースも編集可能で、saved=true は validation=passed を意味しません。新 digest と過去の部分編集衝突も保持します。

UNO API は正確な版付き/版なしモジュール ID を優先し、未知の版には索引を返します。キーワード検索は数字の版を無視して全語一致を求め、索引キャッシュに worker digest を含め、メタデータ更新も文書ロックを使います。

新規 Office は意味的 spec を使えます。既定配置は読みやすい字体、余白、画像の内包、長文/表の分割、表見出し反復、列幅・固定見出し・印刷配置を設定します。plan の semanticGeneration.available は利用可能性であり、選択には recommended に従います。独自設計は plan.design に mode=bespoke、対象者、目的、2–3 方向（id/concept/composition/typography/imagery）、selectedDirection、selectionReason、rhythm を指定し、拘束力のある reference がある場合は 1 方向でも構いません。preserve/avoid は制約です。template は通常の短時間作成向けで既定トークンは変更可能です。

設計ブリーフは検証して下書きに保存し、plan と簡略モデル結果も designGuidance を保持します。bespoke は空白面、独自 program、grid/stack、内容に基づく形状を推奨し、境界・ネイティブ要素・字体・描画検証を維持します。エンジン変更や固定テーマは強制しません。代表的構図を最初の有効な描画で確認してから同じ下書きを拡張します。機能検証が全文書を必要とするなら部分試作を無理に通しません。最終確認は全ページで行い、bespoke は deckReview.checks.designIntent と compositionRhythm を追加します。これは証拠に基づくモデル評価で、自動美的採点ではありません。一貫性は全ページ同一配置や変化数のノルマを意味しません。

作成済みワークスペースの再 plan は冪等でブリーフ/ソースを上書きしません。有界ソース読み取りはブリーフを繰り返さず、完全な readSource で圧縮後に回復できます。既存ファイルは再設計指示がなければ元のデザインを保ちます。画像入力無効時は visualIndex/visualRead/visualReport と画像専用引数をスキーマから外します。ホストは添付/画像読み取り、URL、ダウンロード、変換、プレビュー、保存を注入できます。

webpilot-file-mcp は stdio 入口で、保存先は CAPABILITY_FILE_ARTIFACTS_DIR または ARTIFACTS_DIR です。Office worker は既定で runtime/ にあり、CAPABILITY_FILE_RUNTIME_DIR、Python worker は LIBREOFFICE_UNO_PROGRAM_WORKER_PATH で指定できます。
