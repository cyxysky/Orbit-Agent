import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import type { ChartRecord } from '@webpilot/capability-chart';
import type { ChartExportWindow } from '@/components/ChartPngExport';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import { createMountIdentityTicket } from '@/server/auth/mount-identity';
import { readBrowserChatSessionOwner } from '@/server/storage/browser-chat-history-store';
import { artifactPath } from '@/server/storage/paths';
import { normalizeWebPilotBasePath } from '@/lib/webpilot-base-path';
import { readBrowserChatChart } from './browser-chat-chart';

// Serialize exports across conversations to bound Chromium and canvas memory.
const exportsState = ((globalThis as typeof globalThis & {
  __orbitChartImageExports?: { tail: Promise<unknown> };
}).__orbitChartImageExports ??= { tail: Promise.resolve() });

async function renderPng(chart: ChartRecord, userId: string) {
  const port = Number(process.env.WEBPILOT_REALTIME_PUBLISH_PORT || process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('画布导出服务端口无效。');
  const origin = `http://127.0.0.1:${port}`;
  const basePath = normalizeWebPilotBasePath(process.env.ORBIT_BASE_PATH ?? process.env.WEBPILOT_BASE_PATH);
  const url = new URL(`${basePath}/chart-export`, origin);
  const identityTicket = createMountIdentityTicket({ userId }).ticket;
  url.searchParams.set('identityTicket', identityTicket);
  const browser = await chromium.launch({ headless: true, timeout: 30_000,
    ...(process.env.AI_WEB_TEST_CHROMIUM_EXECUTABLE_PATH?.trim()
      ? { executablePath: process.env.AI_WEB_TEST_CHROMIUM_EXECUTABLE_PATH.trim() } : {}),
  });
  const deadline = setTimeout(() => { void browser.close().catch(() => {}); }, 90_000);
  try {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1000, height: 800 }, deviceScaleFactor: 2 });
    // Scene images are embedded data. Only local application code/fonts may load.
    await page.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort());
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!response?.ok()) throw new Error(`画布导出页面加载失败（${response?.status() || 0}）。`);
    await page.waitForFunction(() => typeof (window as ChartExportWindow).orbitExportChartPng === 'function', undefined, { timeout: 30_000 });
    const dataUrl = await page.evaluate(record => (window as ChartExportWindow).orbitExportChartPng!(record), chart);
    if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('画布导出没有返回 PNG。');
    const source = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    // Keep image delivery small; retain PNG rather than silently changing formats.
    for (const dimension of [4096, 3072, 2048, 1536, 1024]) {
      const png = await sharp(source).resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 }).toBuffer();
      if (png.length <= 2 * 1024 * 1024) return png;
    }
    throw new Error('画布 PNG 超过图片发送大小限制，请简化画布后重试。');
  } catch (error) {
    // Navigation diagnostics can include the URL; never send its ticket to chat.
    const detail = error instanceof Error ? error.message : '画布导出失败。';
    throw new Error(identityTicket ? detail.replaceAll(identityTicket, '[redacted]') : detail);
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}

/** Produce an owned, immutable image artifact; never upload/send from the renderer. */
export async function exportBrowserChatChartImage(sessionId: string, chartId: string, userId: string) {
  if (!/^chat_[a-f0-9]{12}$/i.test(sessionId) || !/^chart_\d{6}$/.test(chartId)) throw new Error('画布标识无效。');
  const owner = await readBrowserChatSessionOwner(sessionId);
  if (!owner || normalizeApplicationUserId(owner.userId) !== normalizeApplicationUserId(userId)) throw new Error('画布不存在。');
  const chart = await readBrowserChatChart(sessionId, chartId);
  if (!chart) throw new Error('画布不存在。');
  const digest = createHash('sha256').update(JSON.stringify({ engine: chart.engine, option: chart.option,
    renderer: chart.renderer, height: chart.height, maps: chart.maps })).digest('hex').slice(0, 16);
  const fileName = `${chartId}.revision-${chart.revision || 0}-${digest}.png`;
  const directory = artifactPath(sessionId, 'charts', 'images');
  const filename = path.join(directory, fileName);
  const artifactId = `${sessionId}/charts/images/${fileName}`;
  const run = exportsState.tail.catch(() => {}).then(async () => {
    try {
      const existing = await readFile(filename);
      if (existing.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return artifactId;
      throw new Error('已保存的画布 PNG 损坏。');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const png = await renderPng(chart, userId);
    // The conversation may have been deleted while Chromium was rendering.
    const latestOwner = await readBrowserChatSessionOwner(sessionId);
    if (!latestOwner || normalizeApplicationUserId(latestOwner.userId) !== normalizeApplicationUserId(userId)) throw new Error('画布对话已删除。');
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, png, { flag: 'wx' });
      await link(temporary, filename).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    } finally { await unlink(temporary).catch(() => {}); }
    return artifactId;
  });
  exportsState.tail = run.catch(() => {});
  return run;
}
