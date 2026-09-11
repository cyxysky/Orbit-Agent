'use client';

import type { ResponseRenderContext } from '@webpilot/capability-response/react';
import { responseRegistry } from '@/lib/response-registry';
import { subscribeRealtimeRefresh } from '@/lib/realtime-refresh';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

export function createResponseContext(input: Pick<ResponseRenderContext, 'locale' | 'translate' | 'renderMarkdown'> & {
  sessionId?: string; automationRunId?: string;
}): ResponseRenderContext {
  const scope = input.automationRunId || input.sessionId || '';
  const endpoint = withWebPilotBasePath(input.automationRunId
    ? `/api/automation/runs/${encodeURIComponent(scope)}/responses`
    : `/api/browser-chat/${encodeURIComponent(scope)}/responses`);
  return {
    ...input, identity: scope, readOnly: Boolean(input.automationRunId),
    async request<T>(block: Parameters<ResponseRenderContext['request']>[0], operation: string, value?: unknown, signal?: AbortSignal): Promise<T> {
      if (!scope) throw new Error('内容缺少所属会话。');
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ block, operation, ...(value === undefined ? {} : { input: value }) }) });
      const payload = await response.json() as { data?: T; error?: string };
      if (!response.ok || !('data' in payload)) throw Object.assign(new Error(payload.error || '内容加载失败。'), { status: response.status });
      return payload.data as T;
    },
    subscribe(block, refresh) {
      const resource = responseRegistry.resource(block);
      if (!resource) return () => {};
      return subscribeRealtimeRefresh(event => {
        if (event.entityType === resource.topic && event.id === `${scope}/${resource.id}`) refresh();
      }, { onResync: refresh });
    },
  };
}
