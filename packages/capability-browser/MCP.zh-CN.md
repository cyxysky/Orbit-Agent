# MCP 服务端与 Agent 客户端

[English](MCP.md) | [简体中文](MCP.zh-CN.md) | [日本語](MCP.ja.md)

本指南随能力包发布。先按 README 创建 provider.ts 与 policy.ts，可以将 providers 数组替换为多个能力工厂，工具及 Skill ID 必须唯一。sensitive-data 是模型中间件，不放入数组。以下文件均位于使用方项目。

服务端在自己的机器执行操作。客户端需要 MCP 地址，不需要导入你的能力 npm 包。本地进程可用 stdio，需要跨调用共享浏览器/工作区运行实例的远程连接使用有状态 Streamable HTTP 示例。
## 1. 服务端依赖与选项

```sh
npm install @webpilot/capability-adapter-mcp @webpilot/capability-host @webpilot/capability-sdk @modelcontextprotocol/server@2.0.0
npm install -D tsx typescript @types/node
```

保存为 mcp-options.ts。会话上下文由可信服务端代码创建，不能把模型参数中的任意 userId/runId 当作已鉴权身份。

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

## 2A. 本地 stdio 进程

保存为 mcp-stdio.ts。手动连接时运行 npx tsx mcp-stdio.ts，也可以让 MCP 客户端启动。stdout 专用于 MCP 协议，日志写入 stderr。客户端负责进程生命周期。

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

使用官方 SDK 的客户端可将第 3 节 HTTP transport 替换如下。MCP_SERVER_DIR 指向包含 package.json 和 mcp-stdio.ts 的绝对目录。使用客户端进程的 node 和本地安装的 tsx，无需 shell 或全局 npx。GUI 客户端按其配置结构填写同样的 command/args/cwd。

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

## 2B. 有状态 HTTP 监听服务

远程 Agent 使用此替代入口。每个初始化的传输会话创建一个 MCP 服务/能力运行实例，后续请求按 mcp-session-id 路由，在 DELETE、空闲到期或服务关闭时清理。浏览器 Provider 在 createRuntime 内创建 BrowserSession，因此不同 MCP 会话不共享浏览器。示例使用官方 SDK 2.0.0 的有状态 Streamable HTTP transport 和 initialize 握手。

Node Request/Response 桥接保存为 http-bridge.ts，支持流式响应（含 SSE）和断连取消。默认地址为 http://127.0.0.1:3100/mcp。远程访问设置 MCP_BIND_ADDRESS、MCP_PUBLIC_ORIGIN、MCP_TOKEN，在服务或代理提供 HTTPS。示例 Token 对应一个可信使用方；多用户宿主应逐请求鉴权、将会话绑定到该身份，并隔离产物/配置存储。传输会话 ID 不等同于用户鉴权。

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

保存为 mcp-http.ts，运行 npx tsx mcp-http.ts，保持该进程运行，在另一个终端启动客户端。反向代理应保留 MCP 请求头和流式响应。空闲超时为 30 分钟，新会话创建新的运行实例。

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

## 何时使用便捷 HTTP Handler

createCapabilityMcpHandler(options) 返回 { fetch, close, ... }，不是已监听端口的 HTTP 服务。可复用桥接 listen(request => handler.fetch(request))，关闭时调用 handler.close()。官方 Handler 按请求创建服务对象；需要跨请求访问 File 持久化记录时应明确保持 context.runId 稳定。仅共享 run ID 无法保存内存浏览器运行实例，跨调用浏览器会话使用上面的有状态示例。两种路径暴露相同的 MCP 工具，区别在资源生命周期。

## 3. 从另一个项目发现并调用

```sh
npm init -y
npm pkg set type=module
npm install @modelcontextprotocol/client@2.0.0
npm install -D tsx typescript @types/node
```

保存为 client.ts，设置 MCP_URL；启用鉴权时配置相同的 MCP_TOKEN。执行 npx tsx client.ts。代码读取所有分页工具、服务指令，并执行 README 中的首次调用，不导入 provider.ts 或能力包。MCP 传输成功仍可能返回 isError: true，表示工具执行失败。

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
  "name": "browser",
  "arguments": {
    "action": "state",
    "reason": "Inspect the initial browser state"
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

## 4. 模型驱动的 MCP 客户端 Agent

```sh
npm install "ai@>=7 <8" @ai-sdk/openai-compatible
```

保存为 mcp-agent.ts，按 README 配置模型环境变量，运行 npx tsx mcp-agent.ts "你的任务"。服务端参数解析与授权仍然有效。客户端转发服务指令并保留完整 MCP 结果。该文本结果示例在模型需要观察截图时，还需补原生图片映射。

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

## 产物、图片、失败与关闭

- MCP 不会自动提供产物字节。配置能力的发布器和可访问且有鉴权的 URL；file 路径只属于服务端本机。
- mcpOptions 的 resolveImage 从可信存储读取截图，返回 { data: base64, mimeType }；内联图片自动转成 MCP image 内容。客户端保留 content，并把 image 转成模型原生图片输入；工具结果 JSON 本身不等于视觉输入。
- 保留 structuredContent 和 content，检查 isError 及能力错误信息，不丢弃 data/产物 ID，也不要只保留 summary。
- 取消使用传输请求信号，长时间 Office/浏览器操作应设置对应调用超时。不确定失败后先读取实时/持久状态，再决定是否重发写操作。
- HTTP 先 transport.terminateSession() 再 client.close()；stdio 只需 client.close()。示例服务在关闭时释放能力资源并清理宿主持有资源。
- 内存会话映射不能跨服务重启保留 session ID；持久化文件可能存在，浏览器变量不会保留。活动会话的所有请求应路由到同一服务进程。

官方客户端 API 参考：[MCP TypeScript SDK 连接说明](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)。服务端示例已对照当前安装的 @modelcontextprotocol/server 2.0.0 类型声明。
