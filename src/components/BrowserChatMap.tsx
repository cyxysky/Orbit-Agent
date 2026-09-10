'use client';
import { useCallback } from 'react';
import { GoogleMapRenderer, type GoogleMapPayload } from '@webpilot/capability-maps/react';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

export function BrowserChatMap({ mapId, title, sessionId, automationRunId }: { mapId: string; title?: string; sessionId?: string; automationRunId?: string }) {
  const endpoint = withWebPilotBasePath(automationRunId
    ? `/api/automation/runs/${encodeURIComponent(automationRunId)}/maps/${encodeURIComponent(mapId)}`
    : `/api/browser-chat/${encodeURIComponent(sessionId || '')}/maps/${encodeURIComponent(mapId)}`);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!sessionId && !automationRunId) throw new Error('地图缺少所属会话。');
    const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '地图加载失败。');
    return payload as GoogleMapPayload;
  }, [endpoint, sessionId, automationRunId]);
  return <GoogleMapRenderer title={title} load={load} />;
}
