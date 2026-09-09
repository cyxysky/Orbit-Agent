# @webpilot/capability-sensitive-data

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

最終モデルプロバイダー境界で機密データを処理します。本パッケージはミドルウェアであり、**CapabilityProvider や MCP ツールではありません**。host ではマウントしません。SDK は内部依存で、移植可能なクライアントに host や Capability アダプターは不要です。
## 1. インストールと秘匿化サービスの起動

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-sensitive-data
npm install -D tsx typescript @types/node
```

Node >=22.16 を使います。GLINER_SERVICE_URL で既存の信頼された HTTP サービスを指定するか、同梱の Python >=3.10 ローカル環境を導入します。利用側のプロジェクトディレクトリで実行します：

```sh
node node_modules/@webpilot/capability-sensitive-data/scripts/install-runtime.cjs
node node_modules/@webpilot/capability-sensitive-data/scripts/start-runtime.cjs
```

起動プロセスを維持します。既定 URL は http://127.0.0.1:18001 です。インストールは利用側ディレクトリに .venv-gliner を作り、Python/モデル依存を取得します。GLINER_BOOTSTRAP_PYTHON は導入用、GLINER_PYTHON_PATH は実行用 Python を選び、モデルキャッシュは .data/gliner-models です。起動スクリプトはループバックのみにバインドします。外部サービスはホストが管理します。GLINER_SERVICE_API_KEY は x-api-key に対応します。

HTTP 契約は POST `<serviceUrl>/redact`、要求 { texts: string[], labels?: string[], threshold?: number }、応答 { texts: string[], replacements?: [...] } です。テキストの数と順番は一致する必要があります。通常のモデル会話エンドポイントへ接続しないでください。

## 2. クライアント作成と最初の呼び出し

redaction.ts として保存：

```ts
import { createSensitiveDataRedactor, sensitiveDataFilterConfigFromEnvironment } from '@webpilot/capability-sensitive-data';
export const config = sensitiveDataFilterConfigFromEnvironment({
  ...process.env,
  AI_SENSITIVE_DATA_FILTER_ENABLED: 'true',
  GLINER_SERVICE_URL: process.env.GLINER_SERVICE_URL || 'http://127.0.0.1:18001',
});
export const redact = createSensitiveDataRedactor({ getConfig: () => config });
```

first-call.ts として保存し npx tsx first-call.ts を実行します。置換内容は設定された検出器によるため、実際のモデル接続前に返却テキストを確認します。

```ts
import { redact } from './redaction.js';
const result = await redact(['Example contact: ada@example.com'], AbortSignal.timeout(60_000));
console.log(result.texts);
console.log(result.replacements);
```

## 3. 任意の Agent フレームワークへの接続

boundary.ts として保存します。この完全なアダプターはテキスト/ツールのプロンプト形状を定義します。実際のフレームワークの送信プロンプトを意味ごとのフィールドに対応付け、send コールバックでネイティブ要求に戻します。毎ステップ、システム、助手履歴、ツール引数・結果を含む最終プロンプトを処理します。HTTP 要求全体を再帰変換しないでください。認証ヘッダー、モデル ID、ツール名、呼び出し ID、通信 URL はプロトコル用です。バイナリー画像/音声は対象外です。

```ts
import { config, redact } from './redaction.js';

// Apply only to textual fields in your framework's outbound request schema.
// Transport control fields, IDs, URLs and binary payloads must remain unchanged.
type Part = { kind: 'text'; text: string }
  | { kind: 'tool-call'; callId: string; name: string; arguments: unknown }
  | { kind: 'tool-result'; callId: string; result: unknown };
export type OutboundPrompt = {
  system: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: Part[] }>;
};

function mapStrings(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform)]));
  }
  return value;
}
function mapPrompt(prompt: OutboundPrompt, transform: (text: string) => string): OutboundPrompt {
  return { system: transform(prompt.system), messages: prompt.messages.map(message => ({
    ...message, content: message.content.map(part => {
      if (part.kind === 'text') return { ...part, text: transform(part.text) };
      if (part.kind === 'tool-call') return { ...part, arguments: mapStrings(part.arguments, transform) };
      return { ...part, result: mapStrings(part.result, transform) };
    }),
  })) };
}
export async function filterPrompt(prompt: OutboundPrompt, signal?: AbortSignal) {
  if (!config.enabled) return prompt;
  try {
    const texts: string[] = [];
    mapPrompt(prompt, text => { texts.push(text); return text; });
    if (!texts.length) return prompt;
    const result = await redact(texts, signal);
    let index = 0;
    return mapPrompt(prompt, () => result.texts[index++]);
  } catch (error) {
    if (config.failureMode === 'open') { console.error('Redaction failed open'); return prompt; }
    throw error;
  }
}

// Your model adapter invokes this boundary on EVERY step, including after tool results.
export async function callFilteredModel<T>(prompt: OutboundPrompt,
  send: (prompt: OutboundPrompt, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
  const filtered = await filterPrompt(prompt, signal);
  return send(filtered, signal);
}
```

## 4. 完全な AI SDK モデルラッパー

```sh
npm install "ai@>=7 <8" @ai-sdk/openai-compatible
```

AGENT_MODEL_BASE_URL、AGENT_MODEL_ID、必要なら AGENT_MODEL_API_KEY を設定し、agent.ts として保存して npx tsx agent.ts を実行します。対象は LanguageModelV4 のプロンプト（AI SDK 7）で、v4 は provider のインターフェース版であり AI SDK のメジャー 4 ではありません。

```ts
import { generateText, wrapLanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAiSdkSensitiveDataFilter } from '@webpilot/capability-sensitive-data/ai-sdk';
import { config, redact } from './redaction.js';
const baseURL = process.env.AGENT_MODEL_BASE_URL;
const modelId = process.env.AGENT_MODEL_ID;
if (!baseURL || !modelId) throw new Error('Set model URL and ID');
const provider = createOpenAICompatible({ name: 'agent-provider', baseURL,
  apiKey: process.env.AGENT_MODEL_API_KEY });
const filter = createAiSdkSensitiveDataFilter({ getConfig: () => config, redact });
const model = wrapLanguageModel({ model: provider.chatModel(modelId), middleware: {
  specificationVersion: 'v4',
  transformParams: async ({ params }) => filter(params),
} });
const result = await generateText({ model,
  prompt: 'Summarize this example contact: Ada, ada@example.com.' });
console.log(result.text);
// Reuse this wrapped model in ToolLoopAgent so every model call crosses the filter.
```

## Node 管理ランタイムと設定

ホスト注入の設定には /node の createNodeSensitiveDataFilter({ getConfig }) を使います。redactSensitiveTexts と filterSensitiveData を返し、要求前に任意のローカルサービスを準備します。設定コールバックはホストの担当です。GLINER_RUNTIME_MODE は auto/local/external で、既存サービスには external を選びます。scripts/prepare-runtime.cjs はランタイムの同梱用です。別起動したサービスプロセスはホストが所有します。

AI_SENSITIVE_DATA_FILTER_ENABLED は既定で無効、FAILURE_MODE は closed で、秘匿化失敗時にモデル要求を止めます。明示的な open は未処理要求を送り、失敗を報告しますが元の機密内容は記録しません。移植可能な redactor 自体は常にサービスを呼び、enabled/failureMode は境界アダプターが扱います。プレースホルダーを一貫して保持し、モデル出力の自動復元はありません。HTTP クライアントに長寿命の解放対象接続はなく、AbortSignal で要求を中断し、ホストが起動したサービスを停止します。

| キー | 既定値 | 適用タイミング |
| --- | --- | --- |
| `AI_SENSITIVE_DATA_FILTER_ENABLED` | `false` | `runtime` |
| `GLINER_RUNTIME_MODE` | `auto` | `startup` |
| `GLINER_SERVICE_URL` | `http://127.0.0.1:18001` | `startup` |
| `GLINER_SERVICE_API_KEY` | `` | `runtime` |
| `AI_SENSITIVE_DATA_FILTER_FAILURE_MODE` | `closed` | `runtime` |
| `AI_SENSITIVE_DATA_FILTER_TIMEOUT_MS` | `60000` | `runtime` |
| `AI_SENSITIVE_DATA_FILTER_THRESHOLD` | `0.5` | `runtime` |
| `AI_SENSITIVE_DATA_FILTER_LABELS` | `` | `runtime` |
| `GLINER_DEVICE` | `cpu` | `startup` |
| `GLINER_BATCH_SIZE` | `8` | `startup` |

## MCP での配置とトラブル対処

Agent が MCP ツールを使う場合、結果をプロンプトに取り込んだ後の**クライアント Agent の最終モデル境界**にフィルターを置きます。サーバーツールとして登録するとモデルが回避できます。

接続拒否ならプロセスと URL、応答形式エラーなら redact 契約とテキスト数、置換されないなら enabled・labels/threshold・検出器環境を確認します。ブロック時は closed の意味を保ちつつサービス障害を調べます。システム/ユーザー/ツールの最終プロンプトが毎回 provider 呼び出し前にラッパーを通って初めて接続完了です。

入口はルートが設定/クライアント/manifest、/ai-sdk が V4 プロンプト走査とフィルター、/node が管理サービス接続、/settings がパッケージ設定です。業務/認証ルール、LiquidAI PII、GLiNER2.5 のオープンラベル検出、中国語 RoBERTa 補正を含み、ローカル検出器には対応するモデル資源の準備が必要です。
