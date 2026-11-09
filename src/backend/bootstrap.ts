export async function startExecutionServices() {
  const { store } = await import('@/server/db/store');
  await store.refreshRuntimeSettings();
  const [{ startAutomationScheduler }, { startCommunicationRuntime, stopCommunicationRuntime }, { startMemoryExtractionWorker }] = await Promise.all([
    import('@/server/automation/automation-scheduler'), import('@/server/integrations/communication-runtime'),
    import('@/server/ai/runtime-memory-lifecycle'),
  ]);
  const stopScheduler = startAutomationScheduler();
  startCommunicationRuntime();
  const stopMemoryWorker = startMemoryExtractionWorker();
  return async () => {
    stopScheduler();
    stopCommunicationRuntime();
    await stopMemoryWorker();
    const { closeAllBrowserSessions } = await import('@cjfclonedeep/capability-sdk/browser/node');
    const { conversationTerminals } = await import('@/server/capabilities/terminal-manager');
    const { closeBrowserPreviewWebSocketServer } = await import('@/server/realtime/browser-preview-ws');
    const { disposeManagedTools } = await import('@/server/capabilities/managed-tools');
    await Promise.all([closeAllBrowserSessions(), conversationTerminals.dispose(), closeBrowserPreviewWebSocketServer(), disposeManagedTools()]);
  };
}
