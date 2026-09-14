import type { IncomingMessage } from 'node:http';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { readEmbedAuth } from '@/server/embed/browser-chat-embed';
import { readBrowserChatSessionOwner, readBrowserChatMessageById } from '@/server/storage/browser-chat-history-store';
import { getAutomationRun } from '@/server/storage/automation-store';
import type { ExecutionTask } from '@/server/runtime/execution-ownership';

export function isInterruptRequest(method: string | undefined, pathname: string) {
  return method === 'POST' && /^\/api\/(?:embed\/)?browser-chat\/[^/]+\/(?:interrupt|subagents\/[^/]+\/stop)$/.test(pathname)
    || method === 'DELETE' && /^\/api\/automation\/runs\/[^/]+$/.test(pathname);
}

export async function authorizeInterrupt(incoming: IncomingMessage, pathname: string, tasks: Iterable<ExecutionTask>) {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    const value = Buffer.from(chunk); size += value.length;
    if (size > 8192) throw new Error('Interrupt request too large');
    parts.push(value);
  }
  const body = Buffer.concat(parts);
  const headers = new Headers();
  for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
  const request = new Request(`http://${headers.get('host') || '127.0.0.1'}${incoming.url}`, { headers });
  // The worker keeps the endpoint's normal validation and error format. This
  // extra authorization controls only the destructive timeout escalation.
  try {
    const chat = /^\/api\/(embed\/)?browser-chat\/([^/]+)\/(?:interrupt|subagents\/[^/]+\/stop)$/.exec(pathname);
    let watchdog = false;
    if (chat) {
      const sessionId = decodeURIComponent(chat[2]);
      const userId = chat[1] ? readEmbedAuth(request, sessionId).userId : requestApplicationUserId(request);
      const owner = await readBrowserChatSessionOwner(sessionId);
      if (!owner || String(owner.userId || '1') !== userId) throw new Error('Browser chat session not found');
      const task = [...tasks].find(item => item.kind === 'chat' && item.id === sessionId);
      if (pathname.endsWith('/interrupt')) {
        const input = JSON.parse(body.toString('utf8') || '{}');
        if (typeof input.clientMessageId !== 'string' || !input.clientMessageId.trim()) throw new Error('Browser chat turn id is required');
        const message = task?.turnId ? await readBrowserChatMessageById<{ clientMessageId?: string }>(sessionId, task.turnId) : undefined;
        watchdog = Boolean(message && message.clientMessageId === input.clientMessageId.trim());
      }
      // A subagent stop remains scoped to that subagent. It must not escalate to
      // termination of the parent process and unrelated turns.
    } else {
      const runId = decodeURIComponent(pathname.split('/').at(-1)!);
      const run = await getAutomationRun(runId, requestApplicationUserId(request));
      if (!run) throw new Error('Automation run not found');
      watchdog = [...tasks].some(task => task.kind === 'automation' && task.id === runId);
    }
    return { body, watchdog };
  } catch {
    return { body, watchdog: false };
  }
}
