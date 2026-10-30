import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), resolve: vi.fn(), apply: vi.fn(), automation: vi.fn() }));
vi.mock('@/server/ai/agents/browser-chat-read.service', () => ({ readBrowserChatRuntimeState: mocks.read }));
vi.mock('@/server/storage/automation-store', () => ({ getAutomationRun: mocks.automation }));
vi.mock('@/server/auth/user-context', () => ({ requestApplicationUserId: () => 'user-1' }));
vi.mock('@/server/db/store', () => ({ store: { applyRuntimeEnv: mocks.apply } }));
vi.mock('@/server/capabilities/browser-chat-maps', () => ({ resolveBrowserChatMap: mocks.resolve }));
vi.mock('@/server/observability/runtime-observability', () => ({ incrementMetric: vi.fn(), structuredLog: vi.fn() }));
import { mapViewResponse } from './browser-chat-maps-route';
import { browserChatFinalBlocksToParts, browserChatFinalResponseSchema } from '@/lib/browser-chat-ui-message';
import { browserChatOrderedResponseParts } from '@/components/browser-chat-markdown';
const mapId = `map_${'a'.repeat(24)}`;
beforeEach(() => vi.resetAllMocks());
describe('maps host integration', () => {
  it('checks ownership before resolving a map or exposing the browser key', async () => {
    mocks.read.mockResolvedValue(undefined);
    const response = await mapViewResponse(new Request('http://localhost/api/maps', { method: 'POST' }), 'chat_123456abcdef', mapId);
    expect(response.status).toBe(404); expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('renders structured map blocks in order and deduplicates identical map ids', () => {
    const result = browserChatFinalResponseSchema.parse({ blocks: [{ type: 'markdown', text: 'Map' }, { type: 'map', mapId }, { type: 'map', mapId }] });
    const parts = browserChatOrderedResponseParts(browserChatFinalBlocksToParts(result.blocks), 'fallback');
    expect(parts.map(part => part.type)).toEqual(['text', 'data-map']);
    expect(() => browserChatFinalResponseSchema.parse({ blocks: [{ type: 'map', mapId: '../../secret' }] })).toThrow();
  });
});
