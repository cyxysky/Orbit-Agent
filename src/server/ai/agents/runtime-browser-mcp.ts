import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { BrowserSession } from '@cjfclonedeep/capability-sdk/browser/node';

const clients = new WeakMap<BrowserSession, Promise<MCPClient>>();
const excludedTools = new Set(['browser_run_code_unsafe', 'browser_close', 'browser_tabs']);
const resolvePackage = createRequire(path.join(process.cwd(), 'package.json'));

async function connectedClient(session: BrowserSession, runId: string) {
  const existing = clients.get(session);
  if (existing) return existing;
  const pending = (async () => {
    const connection = session.browserAutomationConnection();
    const packageFile = resolvePackage.resolve('@playwright/mcp/package.json');
    const cli = path.join(path.dirname(packageFile), 'cli.js');
    const outputDir = path.resolve(process.cwd(), 'runtime', 'artifacts', runId.replace(/[^a-zA-Z0-9_-]/g, '_'), 'playwright-mcp');
    await mkdir(outputDir, { recursive: true });
    const transport = new Experimental_StdioMCPTransport({
      command: process.execPath,
      args: [cli, `${connection.protocol === 'cdp' ? '--cdp-endpoint' : '--endpoint'}=${connection.endpoint}`,
        '--snapshot-mode=full', `--output-dir=${outputDir}`, '--output-max-size=20000000'],
      cwd: process.cwd(), stderr: 'ignore',
    });
    let client: MCPClient;
    try { client = await createMCPClient({ transport, clientName: 'webpilot-browser-chat', maxRetries: 0 }); }
    catch (error) { await transport.close().catch(() => undefined); throw error; }
    session.onClose(async () => {
      clients.delete(session);
      await client.close();
    });
    return client;
  })();
  clients.set(session, pending);
  try { return await pending; }
  catch (error) { clients.delete(session); throw error; }
}

function availableTool(name: string) {
  return name.startsWith('browser_') && !excludedTools.has(name);
}

async function selectOwnedTab(client: MCPClient, session: BrowserSession, signal?: AbortSignal) {
  const result = await client.callTool({ name: 'browser_tabs', arguments: { action: 'list' }, options: { signal } });
  const text = (Array.isArray(result.content) ? result.content : [])
    .filter(part => part.type === 'text').map(part => part.text).join('\n');
  const tabs = [...text.matchAll(/^- (\d+): (\(current\) )?.*?\]\((.*)\)$/gm)]
    .map(match => ({ index: Number(match[1]), current: Boolean(match[2]), url: match[3] }));
  const matches = tabs.filter(tab => tab.url === session.currentUrl());
  if (matches.length !== 1) return { ok: false, actual: `Playwright MCP cannot uniquely identify this conversation's active tab (${matches.length} matches for ${session.currentUrl()}). Use native browser action=tabs or navigate, then retry.` };
  if (!matches[0].current) await client.callTool({ name: 'browser_tabs', arguments: { action: 'select', index: matches[0].index }, options: { signal } });
  return undefined;
}

export async function executePlaywrightMcpOperation(session: BrowserSession, input: {
  tool: string; arguments?: Record<string, unknown>;
}, options: { runId: string; abortSignal?: AbortSignal }) {
  options.abortSignal?.throwIfAborted();
  await session.focusActivePage();
  const client = await connectedClient(session, options.runId);
  options.abortSignal?.throwIfAborted();
  const definitions = await client.listTools({ options: { signal: options.abortSignal } });
  const tools = definitions.tools.filter(tool => availableTool(tool.name));
  if (input.tool === 'list') return { ok: true, actual: JSON.stringify({
    server: client.serverInfo, tools: tools.map(tool => ({ name: tool.name,
      description: tool.description, inputSchema: tool.inputSchema })),
  }) };
  if (!tools.some(tool => tool.name === input.tool)) return { ok: false,
    actual: `Playwright MCP tool ${input.tool} is unavailable. Call tool=list for current server definitions.` };
  const tabError = await selectOwnedTab(client, session, options.abortSignal);
  if (tabError) return tabError;
  let result: Awaited<ReturnType<MCPClient['callTool']>>;
  try {
    result = await client.callTool({ name: input.tool, arguments: input.arguments || {},
      options: { signal: options.abortSignal } });
  } catch (error) {
    clients.delete(session);
    await client.close().catch(() => undefined);
    throw error;
  }
  const imagePaths: string[] = [];
  const texts: string[] = [];
  for (const part of Array.isArray(result.content) ? result.content : []) {
    if (part.type === 'text') texts.push(part.text);
    if (part.type === 'image' && typeof part.data === 'string') {
      const extension = part.mimeType === 'image/jpeg' ? 'jpg' : part.mimeType === 'image/webp' ? 'webp' : 'png';
      const directory = path.resolve(process.cwd(), 'runtime', 'artifacts', options.runId.replace(/[^a-zA-Z0-9_-]/g, '_'));
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, `mcp-${randomUUID()}.${extension}`);
      await writeFile(file, Buffer.from(part.data, 'base64'));
      imagePaths.push(file);
    }
  }
  const actual = texts.join('\n').trim();
  const limit = 24000;
  return { ok: result.isError !== true,
    actual: actual.length > limit ? `${actual.slice(0, limit)}\n[Snapshot truncated in model receipt; full MCP result is archived for contextRead.]` : actual || `Playwright MCP ${input.tool} returned no text.`,
    data: { mcp: { tool: input.tool, isError: result.isError === true, textCharacters: actual.length,
      imageCount: imagePaths.length } },
    ...(imagePaths.length ? { referenceImagePaths: imagePaths } : {}),
  };
}
