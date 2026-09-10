import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserChatMessage } from '@/server/ai/agents/browser-chat.service';

const mocks = vi.hoisted(() => ({ owner: vi.fn(), chart: vi.fn(), launch: vi.fn(), root: '' }));
vi.mock('@/server/storage/browser-chat-history-store', () => ({ readBrowserChatSessionOwner: mocks.owner }));
vi.mock('@/server/capabilities/browser-chat-chart', () => ({ readBrowserChatChart: mocks.chart }));
vi.mock('@/server/auth/mount-identity', () => ({ createMountIdentityTicket: () => ({ ticket: 'private-test-ticket' }) }));
vi.mock('@/server/storage/paths', () => ({ artifactPath: (...parts: string[]) => path.join(mocks.root, ...parts) }));
vi.mock('playwright', () => ({ chromium: { launch: mocks.launch } }));

import { exportBrowserChatChartImage } from '@/server/capabilities/browser-chat-chart-image';
import { communicationReplyWithChartImages } from './communication-chart-images';

const sessionId = 'chat_123456abcdef';
const chartId = 'chart_000001';
const message = {
  role: 'assistant', content: '流程图已生成', status: 'passed',
  parts: [1, 2].map(() => ({ type: 'data-chart', data: { chartId } })),
} as BrowserChatMessage;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.root = await mkdtemp(path.join(os.tmpdir(), 'orbit-chart-images-'));
  mocks.owner.mockResolvedValue({ userId: '1' });
  mocks.chart.mockResolvedValue({ chartId, engine: 'excalidraw', revision: 1, option: { elements: [] } });
  const png = await sharp({ create: { width: 20, height: 30, channels: 4, background: '#abcdef' } }).png().toBuffer();
  mocks.launch.mockResolvedValue({ close: vi.fn(), newPage: async () => ({
    route: vi.fn(), goto: async () => ({ ok: () => true }), waitForFunction: vi.fn(),
    evaluate: async () => `data:image/png;base64,${png.toString('base64')}`,
  }) });
});

afterEach(async () => {
  const directory = path.resolve(mocks.root);
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(directory)).toMatch(/^orbit-chart-images-/);
  await rm(directory, { recursive: true, force: true });
});

it('persists a real PNG, deduplicates reply references and reuses only the same chart version', async () => {
  const replies = await communicationReplyWithChartImages(message, sessionId, '1');
  const images = replies.filter(reply => reply.format === 'image');
  expect(images).toHaveLength(1);
  const first = images[0] as { artifactId: string };
  const metadata = await sharp(await readFile(path.join(mocks.root, first.artifactId))).metadata();
  expect(metadata).toMatchObject({ format: 'png', width: 20, height: 30 });
  expect(await exportBrowserChatChartImage(sessionId, chartId, '1')).toBe(first.artifactId);
  expect(mocks.launch).toHaveBeenCalledTimes(1);
  mocks.chart.mockResolvedValue({ chartId, engine: 'excalidraw', revision: 2, option: { elements: [], appState: { theme: 'dark' } } });
  expect(await exportBrowserChatChartImage(sessionId, chartId, '1')).not.toBe(first.artifactId);
  expect(mocks.launch).toHaveBeenCalledTimes(2);
});

it('keeps text on export failure and excludes credentials and nonexistent image attachments', async () => {
  mocks.launch.mockResolvedValue({ close: vi.fn(), newPage: async () => ({
    route: vi.fn(), goto: async () => { throw new Error('Navigation failed: ?identityTicket=private-test-ticket'); },
  }) });
  const replies = await communicationReplyWithChartImages(message, sessionId, '1');
  expect(replies.some(reply => reply.format === 'image')).toBe(false);
  expect(JSON.stringify(replies)).toContain('流程图已生成');
  expect(JSON.stringify(replies)).toContain('PNG 导出失败');
  expect(JSON.stringify(replies)).not.toContain('private-test-ticket');
});

it('rejects another account before reading a chart or launching Chromium', async () => {
  await expect(exportBrowserChatChartImage(sessionId, chartId, 'other-user')).rejects.toThrow('画布不存在');
  expect(mocks.chart).not.toHaveBeenCalled();
  expect(mocks.launch).not.toHaveBeenCalled();
});
