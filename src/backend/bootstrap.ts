export async function startExecutionServices() {
  const { store } = await import('@/server/db/store');
  await store.applyRuntimeEnv();
  const [{ startAutomationScheduler }, { startCommunicationRuntime, stopCommunicationRuntime }] = await Promise.all([
    import('@/server/automation/automation-scheduler'), import('@/server/integrations/communication-runtime'),
  ]);
  const stopScheduler = startAutomationScheduler();
  startCommunicationRuntime();
  return async () => {
    stopScheduler();
    stopCommunicationRuntime();
    const { closeAllBrowserSessions } = await import('@cjfclonedeep/capability-sdk/browser/node');
    await closeAllBrowserSessions();
  };
}
