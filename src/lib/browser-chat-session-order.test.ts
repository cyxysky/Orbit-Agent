import assert from 'node:assert/strict';
import test from 'node:test';
import { browserChatSessionListTimestamp, compareBrowserChatSessionCreation, upsertBrowserChatSessionByCreation } from './browser-chat-session-order';

test('interleaved streaming updates keep both conversations in place and accept fresh data', () => {
  let sessions = [
    { id: 'new', createdAt: '2026-09-13T10:01:00Z', updatedAt: '2026-09-13T10:01:00Z', content: '' },
    { id: 'old', createdAt: '2026-09-13T10:00:00Z', updatedAt: '2026-09-13T10:00:00Z', content: '' },
  ];
  for (let index = 0; index < 20; index += 1) {
    const selected = sessions[index % 2];
    sessions = upsertBrowserChatSessionByCreation(sessions, { ...selected, updatedAt: `2026-09-14T11:00:${String(index).padStart(2, '0')}Z`, content: `chunk-${index}` });
    assert.deepEqual(sessions.map(session => session.id), ['new', 'old']);
    assert.equal(sessions.find(session => session.id === selected.id)?.content, `chunk-${index}`);
    assert.equal(browserChatSessionListTimestamp(sessions[1]), '2026-09-13T10:00:00Z');
  }
});

test('new sessions, historical pages and equal timestamps use the same deterministic order', () => {
  const items = [
    { id: 'chat_a', createdAt: '2026-09-13T10:00:00Z' },
    { id: 'chat_b', createdAt: '2026-09-13T10:00:00Z' },
    { id: 'chat_c', createdAt: '2026-09-14T10:00:00Z' },
    { id: 'chat_d', createdAt: '2026-09-12T10:00:00Z' },
  ];
  const received = items.reduce((sessions, item) => upsertBrowserChatSessionByCreation(sessions, item), [] as typeof items);
  assert.deepEqual(received.map(item => item.id), ['chat_c', 'chat_b', 'chat_a', 'chat_d']);
  assert.deepEqual(received, [...items].sort(compareBrowserChatSessionCreation));
});
