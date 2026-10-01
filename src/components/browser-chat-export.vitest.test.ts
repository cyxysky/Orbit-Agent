import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'patchright';
import type { BrowserChatExportSnapshot, buildBrowserChatExport } from './browser-chat-export';

let browser: Browser;
let page: Page;
let server: Server;
let directory: string;
let origin: string;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCqkAAAAASUVORK5CYII=', 'base64');
const file = Buffer.from('offline attachment: original bytes\n');
const charts = {
  chart_000001: { chartId: 'chart_000001', title: '数据图表', version: 3, engine: 'echarts', renderer: 'canvas', height: 400, createdAt: '2026-10-01', option: { xAxis: { type: 'category', data: ['A', 'B'] }, yAxis: {}, series: [{ type: 'bar', data: [2, 5] }] } },
  chart_000002: { chartId: 'chart_000002', title: '画布', version: 3, engine: 'excalidraw', renderer: 'canvas', height: 400, createdAt: '2026-10-01', option: { elements: [{ id: 'rect', type: 'rectangle', x: 0, y: 0, width: 240, height: 120, backgroundColor: '#c0eb75', fillStyle: 'solid', strokeColor: '#1e1e1e', strokeWidth: 2, roughness: 0, angle: 0, opacity: 100, seed: 1, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], boundElements: [], updated: 1, link: null, locked: false }], appState: { viewBackgroundColor: '#ffffff' }, files: {} } },
};

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'orbit-chat-export-'));
  const bundle = await build({ entryPoints: ['src/components/browser-chat-export.tsx'], bundle: true, write: false, platform: 'browser', conditions: ['production'], format: 'iife', globalName: 'ChatExportFixture',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, loader: { '.css': 'empty', '.woff2': 'dataurl' }, logLevel: 'silent' });
  server = createServer(async (request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(`try { ${bundle.outputFiles[0].text} } catch(error) { document.documentElement.dataset.error = error.stack; }`); }
    else if (request.url === '/api/artifacts/image.png') { response.setHeader('content-type', 'image/png'); response.end(png); }
    else if (request.url?.startsWith('/api/artifacts/report.txt')) { response.setHeader('content-type', 'text/plain'); response.end(file); }
    else if (request.url?.endsWith('/responses')) {
      let body = ''; for await (const chunk of request) body += chunk;
      const id = JSON.parse(body).block.params.chartId as keyof typeof charts;
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: charts[id] }));
    } else if (request.url === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Export fixture</title><script src="/fixture.js"></script>'); }
    else { response.writeHead(404); response.end('missing'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ acceptDownloads: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => Boolean((window as unknown as { ChatExportFixture?: { buildBrowserChatExport?: unknown } }).ChatExportFixture?.buildBrowserChatExport), undefined, { timeout: 5000 })
    .catch(async error => { throw new Error(`${String(error)}\n${errors.join('\n')}\n${await page.locator('html').getAttribute('data-error')}`); });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (directory) {
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(tmpdir()));
    expect(path.basename(directory)).toMatch(/^orbit-chat-export-/);
    await rm(directory, { recursive: true, force: true });
  }
});

const snapshot = (): BrowserChatExportSnapshot => ({
  id: 'chat_123456789abc', title: '完整会话 </script><img src=x onerror=alert(1)>', exportedAt: '2026-10-01T12:00:00Z', steps: [], subagents: [],
  messages: [
    ...Array.from({ length: 25 }, (_, index) => ({ id: `old-${index}`, role: 'user' as const, content: `历史消息 ${index}`, createdAt: '2026-10-01T10:00:00Z' })),
    { id: 'answer', role: 'assistant', content: '', createdAt: '2026-10-01T11:00:00Z',
      artifacts: [{ id: 'image', kind: 'image', fileName: 'image.png', url: '/api/artifacts/image.png' }, { id: 'file', kind: 'file', fileName: 'report.txt', url: '/api/artifacts/report.txt?download=1' }],
      parts: [
        { type: 'data-response', data: { type: 'core.markdown', params: { text: '# 格式\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n公式：$x^2$\n\n![生成图片](/api/artifacts/image.png)\n\n[文件](/api/artifacts/report.txt)' } } },
        { type: 'data-response', data: { type: 'core.ui', params: { tree: { type: 'stat', props: { label: '总数', value: '42' } } } } },
        { type: 'data-response', data: { type: 'com.webpilot.chart', params: { chartId: 'chart_000001' } } },
        { type: 'data-response', data: { type: 'com.webpilot.canvas', params: { chartId: 'chart_000002' } } },
        { type: 'data-response', data: { type: 'core.html', params: { title: 'HTML 卡片', text: '卡片详情', html: '<section style="height:360px"><h2>完整卡片</h2><details><summary>展开详情</summary><p>更多内容</p></details><a href="/api/artifacts/report.txt">卡片内下载</a><script>parent.pwned=true</script><img src=x onerror="parent.pwned=true"></section>' } } },
      ],
    },
  ],
});

async function render(data: BrowserChatExportSnapshot) {
  return page.evaluate(async json => {
    const data = JSON.parse(json) as BrowserChatExportSnapshot;
    const fixture = (window as unknown as { ChatExportFixture: { buildBrowserChatExport: typeof buildBrowserChatExport } }).ChatExportFixture;
    return fixture.buildBrowserChatExport(data, { locale: 'zh', signal: new AbortController().signal, onProgress: () => {} });
  }, JSON.stringify(data), undefined, false);
}

it('preserves all messages, charts, editable canvas, HTML, images and original files after going offline', async () => {
  const html = await render(snapshot());
  const filename = path.join(directory, 'conversation.html'); await writeFile(filename, html);
  const offline = await browser.newPage({ acceptDownloads: true });
  await offline.context().setOffline(true);
  await offline.goto(pathToFileURL(filename).href);
  expect(await offline.locator('article').count()).toBe(26);
  expect(await offline.locator('table').count()).toBe(1);
  expect(await offline.locator('math').count()).toBe(1);
  expect(await offline.getByText('总数').count()).toBe(1);
  await offline.waitForFunction(() => [...document.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0));
  expect(await offline.locator('figure img').count()).toBe(3);
  const frame = offline.frameLocator('iframe');
  await frame.getByText('完整卡片').waitFor();
  await offline.waitForFunction(() => parseInt(document.querySelector('iframe')!.style.height) >= 360, undefined, { timeout: 5000 });
  expect(await offline.evaluate(() => 'pwned' in window)).toBe(false);
  const downloadPromise = offline.waitForEvent('download'); await frame.getByText('卡片内下载').click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!)).toEqual(file);
  const canvasPromise = offline.waitForEvent('download'); await offline.getByText('下载可编辑画布').click();
  const canvas = await canvasPromise;
  const scene = JSON.parse(await readFile((await canvas.path())!, 'utf8'));
  expect(scene.type).toBe('excalidraw'); expect(scene.elements[0].id).toBe('rect');
  await offline.close();
}, 90_000);

it('rejects missing assets instead of silently exporting broken references', async () => {
  const data = snapshot(); data.messages = [{ id: 'missing', role: 'assistant', createdAt: '2026-10-01', content: '![lost](/api/artifacts/missing.png)' }];
  await expect(render(data)).rejects.toThrow(/无法内嵌/);
});
