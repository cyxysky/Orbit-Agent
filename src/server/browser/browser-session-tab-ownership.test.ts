import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import { BrowserCodeKernel, BrowserSession } from '@cjfclonedeep/capability-sdk/browser/node';

function markedPage(groupId: string, nativeTabId: number) {
  let reads = 0;
  return {
    isClosed: () => false,
    url: () => 'https://example.test/same-url',
    evaluate: async () => (++reads === 1 ? groupId : nativeTabId),
  } as unknown as Page;
}

test('reclaims shared pages only from exact session markers and keeps their native tab id', async () => {
  const session = new BrowserSession({
    headless: true,
    runId: 'chat_current',
  });
  const current = markedPage('chat_current', 71);
  const otherConversationAtSameUrl = markedPage('chat_other', 82);
  const claimed: Page[] = [];
  Reflect.set(session, 'claimPage', (page: Page) => {
    claimed.push(page);
    return true;
  });
  const context = {
    pages: () => [current, otherConversationAtSameUrl],
  } as unknown as BrowserContext;

  const reclaimed = await Reflect.get(session, 'reclaimSessionPagesByMarker').call(session, context) as Page[];

  assert.deepEqual(reclaimed, [current]);
  assert.deepEqual(claimed, [current]);
  const nativeIds = Reflect.get(session, 'nativeTabIdByPage') as WeakMap<Page, number>;
  assert.equal(nativeIds.get(current), 71);
  assert.equal(nativeIds.get(otherConversationAtSameUrl), undefined);
});

test('browser code does not claim five other conversations starting in its shared context', async () => {
  const runtimeKey = `ownership-${randomUUID()}`;
  const sessions = Array.from({ length: 6 }, (_, index) => new BrowserSession({
    runId: `${runtimeKey}-${index}`,
    headless: true,
    sharedBrowserRuntimeKey: runtimeKey,
    configuration: {
      AI_WEB_TEST_FORCE_PLAYWRIGHT_BROWSER: 'true',
      BROWSER_NATIVE_TAB_GROUPS: 'false',
      BROWSER_CLOSE_SHARED_WHEN_IDLE: 'true',
    },
  }));
  const input = { runId: runtimeKey, stepIndex: 1, code: "await page.goto('about:blank'); nodeRepl.write({ status: 'ok', url: page.url() });" };
  const originalExecute = BrowserCodeKernel.prototype.execute;
  let entered!: () => void;
  let release!: () => void;
  const executing = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let firstExecution: ReturnType<BrowserSession['executeBrowserCode']> | undefined;
  let first = true;
  BrowserCodeKernel.prototype.execute = async function (...args) {
    if (first) {
      first = false;
      entered();
      await gate;
    }
    return originalExecute.apply(this, args);
  };
  try {
    await sessions[0].start();
    firstExecution = sessions[0].executeBrowserCode(input);
    await executing;
    const results = await Promise.allSettled(sessions.slice(1).map(async (session) => {
      await session.start();
      assert.equal(session.isUsable(), true);
      assert.equal((await session.executeBrowserCode(input)).ok, true);
    }));
    release();
    assert.equal((await firstExecution).ok, true);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const tabs = sessions.map((session) => session.getTabsSnapshot());
    assert.deepEqual(tabs.map((items) => items.length), [1, 1, 1, 1, 1, 1]);
    assert.equal(new Set(tabs.flatMap((items) => items.map((tab) => tab.groupId))).size, 6);

    const popup = await sessions[0].executeBrowserCode({ ...input, code: "await browser.tabs.new(); nodeRepl.write({ count: (await browser.tabs.list()).length });" });
    assert.equal(popup.ok, true);
    assert.equal(sessions[0].getTabsSnapshot().length, 2);
    assert.deepEqual(sessions.slice(1).map((session) => session.getTabsSnapshot().length), [1, 1, 1, 1, 1]);
  } finally {
    release();
    await firstExecution?.catch(() => undefined);
    BrowserCodeKernel.prototype.execute = originalExecute;
    await Promise.all(sessions.map((session) => session.close({ force: true })));
  }
});
