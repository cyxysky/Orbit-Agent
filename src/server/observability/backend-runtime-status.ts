import { readBrowserChatRuntimeStatus } from '@/server/ai/agents/browser-chat.service';
import { backendMemorySnapshot } from './process-memory';

export type BackendRuntimeStatus = ReturnType<typeof readBackendRuntimeStatus>;

export function readBackendRuntimeStatus() {
  return {
    generatedAt: new Date().toISOString(),
    process: { pid: process.pid, uptimeSeconds: Math.round(process.uptime()) },
    memory: backendMemorySnapshot(),
    ...readBrowserChatRuntimeStatus(),
  };
}
