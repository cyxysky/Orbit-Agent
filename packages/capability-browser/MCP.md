# MCP server and Agent client

[English](MCP.md) | [简体中文](MCP.zh-CN.md) | [日本語](MCP.ja.md)

This guide ships with the package. First create `provider.ts` and `policy.ts` from its README. You can replace the providers array with several capability factories; keep tool and Skill IDs unique. `sensitive-data` is model middleware and does not go in this array. All files below live in the consuming project.

The server executes operations on its own machine. The client needs an MCP endpoint, not npm imports of your capabilities. Use stdio for a local process, or the stateful Streamable HTTP example for remote calls that share a browser/workspace runtime.
## 1. Server dependencies and options

```sh
npm install @webpilot/capability-adapter-mcp @webpilot/capability-host @webpilot/capability-sdk @modelcontextprotocol/server@2.0.0
npm install -D tsx typescript @types/node
```

Save as `mcp-options.ts`. The session context is created by trusted server code. Do not accept an arbitrary userId/runId from model arguments as an authorization identity.

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

## 2A. Local stdio process

Save as `mcp-stdio.ts`. Run `npx tsx mcp-stdio.ts` when connecting manually, or let your MCP client launch it. stdout is exclusively MCP protocol output; logs go to stderr. The client owns process lifetime.

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

A client using the official SDK can replace the HTTP transport in section 3 with the following. Set MCP_SERVER_DIR to the absolute directory containing package.json and mcp-stdio.ts. Resolve `node` explicitly from the client process and use the local tsx installation; no shell or global npx command is required. For GUI clients, adapt these same command/args/cwd fields to that client's configuration schema.

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

## 2B. Listening stateful HTTP server

Use this alternative for a remote Agent. It creates one MCP server/runtime per initialized transport session, routes later requests by mcp-session-id, and closes on DELETE, idle expiry or shutdown. The browser Provider creates its BrowserSession inside createRuntime, so different MCP sessions do not share a browser. It uses the official SDK 2.0.0 stateful Streamable HTTP transport and the initialize handshake.

Save the Node Request/Response bridge as `http-bridge.ts`. It streams responses (including SSE) and propagates disconnect cancellation. Default address is http://127.0.0.1:3100/mcp. For remote access configure MCP_BIND_ADDRESS, MCP_PUBLIC_ORIGIN and MCP_TOKEN, and terminate HTTPS at your server/proxy. This sample token represents one trusted principal. A multi-user host must authenticate each request, bind sessions to that identity, and partition artifact/configuration storage; a transport session ID is not user authentication.

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

Save as `mcp-http.ts`, then run `npx tsx mcp-http.ts`. Keep this process running while starting the client in a second terminal. A reverse proxy must preserve MCP headers and streaming responses. The idle timeout is 30 minutes; a new session starts a new runtime.

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

## When to use the convenience HTTP handler

`createCapabilityMcpHandler(options)` returns `{ fetch, close, ... }`, not a listening HTTP server. Reuse http-bridge.ts as `listen(request => handler.fetch(request))`, and call handler.close() during shutdown. The official handler creates per-request servers; context.runId must be deliberately stable if persistent File records need to be revisited. A shared run ID alone does not preserve an in-memory browser runtime. Use the stateful example above for multi-call browser sessions. Both paths expose the same MCP tools; they differ in resource lifetime.

## 3. Discover and call from another project

```sh
npm init -y
npm pkg set type=module
npm install @modelcontextprotocol/client@2.0.0
npm install -D tsx typescript @types/node
```

Save as client.ts. Set MCP_URL and, if enabled, the same MCP_TOKEN. Run `npx tsx client.ts`. This code lists all pages of tools, reads server instructions and performs the package README's first call. It does not import provider.ts or the capability package. A successful MCP transport can still return isError: true for a tool failure.

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

## 4. Model-driven MCP client Agent

```sh
npm install "ai@>=7 <8" @ai-sdk/openai-compatible
```

Save as mcp-agent.ts. Set the same model environment variables documented in README, then run `npx tsx mcp-agent.ts "your task"`. Server-side parsing and authorization remain in force. The client forwards server instructions and preserves full MCP results. This text-result example needs an additional native image mapping when the model must inspect screenshots.

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

## Artifacts, images, failures and shutdown

- MCP does not serve artifact bytes automatically. Configure the capability's artifact publisher and an accessible authenticated URL; file: paths are local to the server.
- `resolveImage` on mcpOptions must return `{ data: base64, mimeType }` from trusted storage for stored screenshots. Inline images already become native MCP image content. In your client, preserve `content` and map image blocks to the model's native image input; tool-result JSON alone is not vision.
- Preserve `structuredContent` and `content`; inspect isError and the capability error data. Do not discard data/artifact IDs or replace results with summary text.
- Cancellation uses the transport request signal; configure tool-call timeout for long Office/browser work. After an uncertain failure, read live/persisted state before resubmitting a mutation.
- Close the HTTP session with transport.terminateSession(), then client.close(); stdio only needs client.close(). The sample server releases runtime resources and host-owned cleanup during shutdown.
- A session ID cannot survive a server restart in this in-memory session map. Persistent artifacts may survive; browser bindings do not. Keep all calls of an active session on the same server process.

Official client API reference: [MCP TypeScript SDK: connect](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect). The server examples are aligned with the installed @modelcontextprotocol/server 2.0.0 declarations.
