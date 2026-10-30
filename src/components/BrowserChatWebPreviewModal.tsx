'use client';
import { useMemo } from 'react';
import { BrowserPreviewWindow, type BrowserPreviewClient } from '@cjfclonedeep/capability-sdk/browser/preview/react';
import { useI18n } from '@/i18n/I18nProvider';
import { readApiJson } from '@/lib/api-client';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
export function BrowserChatWebPreviewModal({ onClose, sessionId, userId }: { onClose: () => void; sessionId: string; userId: string }) {
  const { t } = useI18n();
  const client = useMemo<BrowserPreviewClient>(() => {
    const bridge = typeof window === 'undefined' ? undefined : (window as Window & { webPilotSystem?: {
      downloadUrl?: (input: { fileName: string; url: string }) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
    } }).webPilotSystem?.downloadUrl;
    return {
    async connect(signal) {
      const response = await fetch(withWebPilotBasePath('/api/browser-chat/preview-stream') + '?sessionId=' + encodeURIComponent(sessionId), { cache: 'no-store', method: 'POST', signal });
      const data = await readApiJson<{ url: string; transport?: 'image' | 'video' }>(response, '实时界面连接失败');
      const url = new URL(data.url); url.searchParams.set('sessionId', sessionId);
      return { ...data, url: url.href };
    },
    async uploadFile(file) {
      const response = await fetch(withWebPilotBasePath('/api/uploads'), {
        body: file, method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-webpilot-file-name': encodeURIComponent(file.name), 'x-webpilot-upload': 'raw' },
      });
      const data = await readApiJson<Record<string, unknown>>(response, '文件上传失败');
      return { mimeType: String(data.type || file.type || 'application/octet-stream'), name: String(data.name || file.name), path: String(data.path || '') };
    },
    resolveDownloadUrl: withWebPilotBasePath,
    download: bridge ? async ({ fileName, url }) => {
      const result = await bridge({ fileName, url });
      if (!result.ok && !result.canceled) throw new Error(result.error || '文件下载失败');
    } : undefined,
  }; }, [sessionId]);
  return <BrowserPreviewWindow key={userId + ':' + sessionId} client={client} translate={t} onClose={onClose} />;
}
