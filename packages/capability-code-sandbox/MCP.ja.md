# MCP サーバーと Agent クライアント

[English](MCP.md) | [简体中文](MCP.zh-CN.md) | [日本語](MCP.ja.md)

このガイドはパッケージに同梱されます。先に README の provider.ts と policy.ts を作成します。providers 配列を複数の能力ファクトリーに置き換えられますが、ツールと Skill ID は一意にします。sensitive-data はモデルミドルウェアなので配列に入れません。以下のファイルは利用側のプロジェクトに置きます。

処理はサーバー自身のマシンで実行されます。クライアントは MCP URL があればよく、能力 npm パッケージの読み込みは不要です。ローカルプロセスには stdio、ブラウザー/ワークスペース実行を呼び出し間で共有するリモート接続にはステートフル Streamable HTTP 例を使います。
## 1. サーバーの依存と設定

```sh
npm install @webpilot/capability-adapter-mcp @webpilot/capability-host @webpilot/capability-sdk @modelcontextprotocol/server@2.0.0
npm install -D tsx typescript @types/node
```

mcp-options.ts として保存します。セッションの文脈は信頼されたサーバーコードが作成し、モデル引数の任意 userId/runId を認証済みの識別子として扱いません。

```ts
import { randomUUID } from 'node:crypto';
import { EnvironmentCapabilityConfigStore } from '@webpilot/capability-host';
import type { CapabilityProvider } from '@webpilot/capability-sdk';
import { providers, configurations } from './provider.js';
import { policy, beforeInvoke } from './policy.js';

// The MCP policy hook receives permissions/context; wrap execution for input-aware approval.
const guardedProviders: CapabilityProvider[] = providers.map(provider => ({
  manifest: provider.manifest,
  async createRuntime(context) {
    const runtime = await provider.createRuntime(context);
    return { health: () => runtime.health(), dispose: () => runtime.dispose(),
      tools: Object.fromEntries(Object.entries(runtime.tools).map(([key, tool]) => [key, {
        ...tool, async execute(input, execution) {
          await beforeInvoke(tool.name, input);
          return tool.execute(input, execution);
        },
      }])),
    };
  },
}));
export function mcpOptions() {
  return { name: 'my-agent-capabilities', version: '1.0.0',
    providers: guardedProviders, configurations, policy,
    context: { runId: randomUUID() },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
    skillMode: 'eager' as const,
  };
}
```

## 2A. ローカル stdio プロセス

mcp-stdio.ts として保存します。手動接続なら npx tsx mcp-stdio.ts を実行するか、MCP クライアントに起動させます。stdout は MCP プロトコル専用、ログは stderr に出します。プロセスの寿命はクライアントが管理します。

```ts
import { serveCapabilityMcpStdio } from '@webpilot/capability-adapter-mcp';
import { mcpOptions } from './mcp-options.js';
import { cleanup } from './provider.js';
const handle = serveCapabilityMcpStdio(mcpOptions());
let closing: Promise<void> | undefined;
const stop = () => closing ||= (async () => {
  try { await handle.close(); } finally { await cleanup(); }
})();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
}
process.stdin.once('end', () => { void stop().catch(console.error); });
```

公式 SDK のクライアントでは第 3 節の HTTP transport を次のものに置き換えられます。MCP_SERVER_DIR は package.json と mcp-stdio.ts のある絶対ディレクトリです。クライアントの node とローカルの tsx を使い、shell やグローバル npx は不要です。GUI クライアントでは同じ command/args/cwd をその設定形式へ対応させます。

```ts
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const cwd = process.env.MCP_SERVER_DIR;
if (!cwd) throw new Error('Set MCP_SERVER_DIR');
const transport = new StdioClientTransport({
  command: process.execPath, args: ['--import', 'tsx', 'mcp-stdio.ts'], cwd,
  env: Object.fromEntries(Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined)),
});
// Connect with the same Client; final cleanup is client.close(), without terminateSession().
```

## 2B. ステートフル HTTP 待ち受け

リモート Agent にはこの代替入口を使います。初期化された通信セッションごとに MCP サーバー/能力実行を作り、以後の要求を mcp-session-id で振り分け、DELETE、アイドル期限、停止時に解放します。Browser Provider は createRuntime 内で BrowserSession を作るため、異なる MCP セッションでブラウザーを共有しません。公式 SDK 2.0.0 のステートフル Streamable HTTP transport と initialize ハンドシェイクを使います。

Node Request/Response ブリッジを http-bridge.ts として保存します。SSE を含む応答ストリームと切断による中断に対応します。既定 URL は http://127.0.0.1:3100/mcp です。リモート用には MCP_BIND_ADDRESS、MCP_PUBLIC_ORIGIN、MCP_TOKEN を設定し、サーバー/プロキシで HTTPS を終端します。例の Token は単一の信頼された利用者を表します。複数ユーザーのホストでは毎要求の認証、セッションとの結合、成果物/設定の分離が必要です。通信セッション ID はユーザー認証ではありません。

```ts
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function listen(fetchHandler: (request: Request) => Promise<Response>) {
  const port = Number(process.env.PORT || 3100);
  const hostname = process.env.MCP_BIND_ADDRESS || '127.0.0.1';
  const origin = process.env.MCP_PUBLIC_ORIGIN || `http://127.0.0.1:${port}`;
  const token = process.env.MCP_TOKEN;
  if (!['127.0.0.1', '::1'].includes(hostname) && !token) {
    throw new Error('Set MCP_TOKEN when binding outside loopback');
  }
  const server = createServer((req, res) => { void (async () => {
    if (req.url?.split('?')[0] !== '/mcp') { res.writeHead(404).end(); return; }
    // Accept only the configured public authority and same-origin browser requests.
    if (req.headers.host !== new URL(origin).host
      || (req.headers.origin && req.headers.origin !== origin)) {
      res.writeHead(403).end('Unexpected origin'); return;
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end('Unauthorized'); return;
    }
    const abort = new AbortController();
    req.once('aborted', () => abort.abort());
    res.once('close', () => { if (!res.writableFinished) abort.abort(); });
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    const init: RequestInit & { duplex?: 'half' } = {
      method: req.method, headers, signal: abort.signal,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
      init.duplex = 'half';
    }
    const response = await fetchHandler(new Request(new URL(req.url || '/mcp', origin), init));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
    } else res.end();
  })().catch(error => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500).end('MCP request failed');
    else res.destroy();
  }); });
  server.listen(port, hostname, () => console.error(`MCP endpoint: ${origin}/mcp`));
  return server;
}
```

mcp-http.ts として保存し、npx tsx mcp-http.ts を実行します。そのまま別端末でクライアントを起動します。リバースプロキシは MCP ヘッダーとストリームを保持してください。アイドル期限は 30 分で、新規セッションは新しい実行インスタンスになります。

```ts
import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport, isInitializeRequest } from '@modelcontextprotocol/server';
import { createCapabilityMcpServer } from '@webpilot/capability-adapter-mcp';
import { mcpOptions } from './mcp-options.js';
import { cleanup } from './provider.js';
import { listen } from './http-bridge.js';

type Entry = {
  transport: WebStandardStreamableHTTPServerTransport;
  server: Awaited<ReturnType<typeof createCapabilityMcpServer>>;
  lastUsed: number;
  active: number;
  closing?: Promise<void>;
};
const sessions = new Map<string, Entry>();
const entries = new Set<Entry>();
let stopping = false;
async function closeEntry(entry: Entry) {
  return entry.closing ||= (async () => {
    entries.delete(entry);
    for (const [id, current] of sessions) if (current === entry) sessions.delete(id);
    await entry.server.close();
  })();
}

const http = listen(async request => {
  if (stopping) return new Response('Shutting down', { status: 503 });
  const id = request.headers.get('mcp-session-id');
  let entry = id ? sessions.get(id) : undefined;
  if (id && !entry) return new Response('Unknown session', { status: 404 });
  if (!entry) {
    if (request.method !== 'POST') return new Response('Initialize first', { status: 400 });
    let body: unknown;
    try { body = await request.clone().json(); }
    catch { return new Response('Invalid JSON', { status: 400 }); }
    if (!isInitializeRequest(body)) return new Response('Initialize first', { status: 400 });
    const server = await createCapabilityMcpServer(mcpOptions());
    let created: Entry;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: sessionId => { sessions.set(sessionId, created); },
    });
    created = { server, transport, lastUsed: Date.now(), active: 0 };
    entry = created;
    entries.add(entry);
    try { await server.connect(transport); }
    catch (error) { await closeEntry(entry); throw error; }
  }
  entry.lastUsed = Date.now();
  // GET is an optional long-lived SSE stream; it must not prevent idle expiry forever.
  const operation = request.method !== 'GET';
  if (operation) entry.active++;
  try {
    const response = await entry.transport.handleRequest(request);
    if (request.method === 'DELETE' || (!id && response.status >= 400)) await closeEntry(entry);
    return response;
  } catch (error) {
    if (!id) await closeEntry(entry);
    throw error;
  } finally {
    if (operation) entry.active--;
    entry.lastUsed = Date.now();
  }
});
const idle = setInterval(() => {
  for (const entry of entries) {
    if (!entry.active && Date.now() - entry.lastUsed > 30 * 60_000) {
      void closeEntry(entry).catch(console.error);
    }
  }
}, 60_000);
idle.unref();
let closing: Promise<void> | undefined;
function stop() {
  return closing ||= (async () => {
    stopping = true;
    clearInterval(idle);
    const closed = new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    const settled = await Promise.allSettled([...entries].map(closeEntry));
    http.closeAllConnections();
    await closed;
    await cleanup();
    const errors = settled.flatMap(item => item.status === 'rejected' ? [item.reason] : []);
    if (errors.length) throw new AggregateError(errors, 'MCP cleanup failed');
  })();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
}
```

## 簡易 HTTP Handler を使う場合

createCapabilityMcpHandler(options) は { fetch, close, ... } を返し、待ち受ける HTTP サーバーではありません。ブリッジを listen(request => handler.fetch(request)) として使い、終了時に handler.close() を呼びます。公式 Handler は要求ごとにサーバーを作るため、永続 File レコードを再参照するなら context.runId を意図的に固定します。ただし共有 run ID だけではメモリ内ブラウザーは保持されません。複数呼び出しには上記ステートフル例を使います。両者の MCP ツールは同じで、資源の寿命が異なります。

## 3. 別プロジェクトから検出・呼び出し

```sh
npm init -y
npm pkg set type=module
npm install @modelcontextprotocol/client@2.0.0
npm install -D tsx typescript @types/node
```

client.ts として保存し、MCP_URL と、認証使用時は同じ MCP_TOKEN を設定します。npx tsx client.ts で全ページのツールとサーバー指示を取得し、README の最初の呼び出しを実行します。provider.ts や能力パッケージは読み込みません。MCP 通信成功でも isError: true ならツール処理は失敗です。

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const client = new Client({ name: 'my-agent-client', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(
  new URL(process.env.MCP_URL || 'http://127.0.0.1:3100/mcp'), {
    requestInit: { headers: process.env.MCP_TOKEN
      ? { authorization: `Bearer ${process.env.MCP_TOKEN}` } : {} },
  });
try {
  await client.connect(transport);
  const tools: Awaited<ReturnType<typeof client.listTools>>['tools'] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  const instructions = client.getInstructions() || '';
  console.log(instructions);
  console.log(tools.map(tool => ({ name: tool.name, inputSchema: tool.inputSchema })));
  const call = {
  "name": "codeSandbox",
  "arguments": {
    "action": "run",
    "reason": "Check JavaScript execution",
    "language": "javascript",
    "code": "console.log(JSON.stringify({ total: [1, 2, 3].reduce((a, b) => a + b, 0) }));"
  }
};
  if (!tools.some(tool => tool.name === call.name)) throw new Error('Requested tool is not exposed');
  const result = await client.callTool(call);
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
} finally {
  try { await transport.terminateSession(); } finally { await client.close(); }
}
```

## 4. モデル駆動 MCP クライアント Agent

```sh
npm install "ai@>=7 <8" @ai-sdk/openai-compatible
```

mcp-agent.ts として保存し、README のモデル環境変数を設定して npx tsx mcp-agent.ts "タスク" を実行します。サーバー側の引数解析と承認は維持されます。クライアントはサーバー指示と完全な MCP 結果を保持します。画像を観測するモデルにはネイティブ画像変換を追加します。

```ts
import { ToolLoopAgent, stepCountIs, jsonSchema, tool, type ToolSet } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const client = new Client({ name: 'my-agent-client', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(
  new URL(process.env.MCP_URL || 'http://127.0.0.1:3100/mcp'), {
    requestInit: { headers: process.env.MCP_TOKEN
      ? { authorization: `Bearer ${process.env.MCP_TOKEN}` } : {} },
  });
try {
  await client.connect(transport);
  const tools: Awaited<ReturnType<typeof client.listTools>>['tools'] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  const instructions = client.getInstructions() || '';
  const baseURL = process.env.AGENT_MODEL_BASE_URL;
  const modelId = process.env.AGENT_MODEL_ID;
  if (!baseURL || !modelId) throw new Error('Set AGENT_MODEL_BASE_URL and AGENT_MODEL_ID');
  const modelProvider = createOpenAICompatible({ name: 'agent-provider', baseURL,
    apiKey: process.env.AGENT_MODEL_API_KEY });
  const agentTools: ToolSet = Object.fromEntries(tools.map(remote => [remote.name, tool({
    description: remote.description || remote.name,
    inputSchema: jsonSchema<Record<string, unknown>>(remote.inputSchema),
    async execute(input, call) {
      return client.callTool({ name: remote.name, arguments: input }, {
        signal: call.abortSignal, timeout: 120_000,
      });
    },
  })]));
  const agent = new ToolLoopAgent({ model: modelProvider.chatModel(modelId),
    tools: agentTools, instructions, stopWhen: stepCountIs(10) });
  const result = await agent.generate({ prompt: process.argv[2]
    || 'Describe the available tools and their intended usage.' });
  console.log(result.text);
} finally {
  try { await transport.terminateSession(); } finally { await client.close(); }
}
```

## 成果物・画像・失敗・終了

- MCP は成果物のバイト列を自動配信しません。能力の公開処理と認証付き URL を用意します。file パスはサーバー側だけのものです。
- mcpOptions の resolveImage は信頼された保存先から { data: base64, mimeType } を返します。インライン画像は MCP image になります。クライアントでは content を保持し、image をモデルのネイティブ画像入力に変換します。結果 JSON だけでは画像入力になりません。
- structuredContent と content を保持し、isError と能力エラーを確認します。data/成果物 ID を捨てたり summary だけに置き換えたりしません。
- 中断は通信の request signal を使います。長い Office/ブラウザー操作には対応するタイムアウトを設定します。不明な失敗後は状態を確認してから変更操作の再送を判断します。
- HTTP は transport.terminateSession() の後に client.close()、stdio は client.close() のみです。例のサーバーは停止時に能力とホスト所有の資源を解放します。
- メモリ内のセッション ID はサーバー再起動を越えて保持されません。成果物は永続化できますがブラウザー変数は残りません。活動中のセッションは同じプロセスへルーティングします。

公式クライアント API：[MCP TypeScript SDK 接続ガイド](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)。サーバー例はインストール済み @modelcontextprotocol/server 2.0.0 の型宣言に対応します。
