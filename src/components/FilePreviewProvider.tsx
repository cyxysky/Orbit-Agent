'use client';

import { FilePreviewContext, fileNameFromPreviewUrl, isFilePreviewHref, type FilePreviewContextValue, type FilePreviewRequest } from './file-preview-context';
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { FileText, Scissors, X } from 'lucide-react';
import { textDocumentIdFromFile } from '@/lib/text-editor';
import type { VideoEditorHandle } from './VideoEditorPanel';
import type { PreviewSource } from '@open-file-viewer/core';
import { artifactContentType } from '@cjfclonedeep/capability-sdk/file/formats';
import { BeautifulLoadingState } from '@/components/BeautifulLoadingState';
import { CreativeEditorLoading } from './CreativeEditorLoading';
import { useI18n } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { useToolCapabilityCatalog } from './useToolCapabilityCatalog';
import { AppModal } from '@/components/ui/app-modal';
import { FloatingWindow } from '@cjfclonedeep/capability-sdk/ui/floating-window';
import '@/app/styles/creative-editors.css';


function FilePreviewModuleLoading() {
  const { t } = useI18n();
  return <BeautifulLoadingState label={t('正在加载文件预览')} />;
}

// The viewer and its format plugins use browser APIs. Keep them out of server
// rendering and load them only when a preview is opened.
const OpenFileViewerSurface = dynamic(() => import('./OpenFileViewerSurface').then(module => module.OpenFileViewerSurface), {
  ssr: false, loading: FilePreviewModuleLoading,
});
const VideoEditorPanel = lazy(() => import('./VideoEditorPanel').then(module => ({ default: module.VideoEditorPanel })));

class SurfaceErrorBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const TextEditorPanel = lazy(() => import('./TextEditorPanel').then(module => ({ default: module.TextEditorPanel })));

function filePreviewMimeType(fileName: string, mimeType?: string) {
  const explicit = String(mimeType || '').trim();
  if (explicit) return explicit;
  const inferred = artifactContentType(fileName);
  return inferred === 'application/octet-stream' ? undefined : inferred;
}

export function FilePreviewProvider({ children }: { children: ReactNode }) {
  const { language, t } = useI18n();
  const { mode } = useTheme();
  const titleId = useId();
  const [request, setRequest] = useState<FilePreviewRequest | null>(null);
  const [resolvedSource, setResolvedSource] = useState<PreviewSource | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [error, setError] = useState('');
  const [editingVideo, setEditingVideo] = useState(false);
  const editingText = request?.mode === 'editText';
  const { loaded: toolCatalogLoaded, isEnabled: toolEnabled } = useToolCapabilityCatalog();
  const textEditorEnabled = toolEnabled('textEditor');
  const editor = useRef<VideoEditorHandle>(null);
  const handleSurfaceError = useCallback((reason: Error) => setError(reason.message), []);

  const closeFilePreview = useCallback(async () => {
    try { await editor.current?.flush(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    setRequest(null);
    setResolvedSource(null);
    setLoadingSource(false);
    setError('');
    setEditingVideo(false);
  }, []);
  useEffect(() => {
    if (toolCatalogLoaded && !textEditorEnabled && editingText) void closeFilePreview();
  }, [toolCatalogLoaded, textEditorEnabled, editingText, closeFilePreview]);
  const openFilePreview = useCallback(async (nextRequest: FilePreviewRequest) => {
    try { await editor.current?.flush(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    setRequest({
      ...nextRequest,
      ...(!nextRequest.mode && textDocumentIdFromFile(nextRequest.fileName) ? { mode: 'editText', textDocumentId: textDocumentIdFromFile(nextRequest.fileName) } : {}),
      mimeType: filePreviewMimeType(nextRequest.fileName, nextRequest.mimeType),
    });
    setResolvedSource(typeof nextRequest.source === 'function' ? null : nextRequest.source);
    setLoadingSource(typeof nextRequest.source === 'function');
    setError('');
    setEditingVideo(nextRequest.mode === 'editVideo');
  }, []);

  useEffect(() => {
    if (!request || typeof request.source !== 'function') return undefined;
    let active = true;
    request.source()
      .then((source) => {
        if (!active) return;
        setResolvedSource(source);
        setLoadingSource(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : t('文件预览加载失败'));
        setLoadingSource(false);
      });
    return () => {
      active = false;
    };
  }, [request, t]);

  useEffect(() => {
    function handleFileLinkClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('.file-preview-dialog')) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.dataset.filePreview === 'false') return;
      const href = anchor.getAttribute('href') || '';
      if (anchor.hasAttribute('download')) return;
      try {
        const url = new URL(href, window.location.href);
        const download = url.searchParams.get('download');
        if (download !== null && !/^(0|false|no)$/i.test(download)) return;
      } catch {
        // Invalid links are ignored by the preview check below.
      }
      const fileName = anchor.dataset.fileName || fileNameFromPreviewUrl(href);
      if (!isFilePreviewHref(href, fileName)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openFilePreview({
        fileName,
        mimeType: anchor.dataset.fileType,
        source: anchor.href,
      });
    }
    document.addEventListener('click', handleFileLinkClick, true);
    return () => document.removeEventListener('click', handleFileLinkClick, true);
  }, [openFilePreview]);

  const contextValue = useMemo<FilePreviewContextValue>(() => ({
    closeFilePreview,
    filePreviewOpen: Boolean(request),
    openFilePreview,
  }), [closeFilePreview, openFilePreview, request]);

  const dialog = request && (editingText || editingVideo) ? (
    <FloatingWindow title={editingText ? '文本编辑器' : '视频剪辑'} className={`creative-editor-window ${editingText ? 'text-editor-window' : 'video-editor-window'}`} onClose={closeFilePreview}>
      <div className="creative-editor-body">
        <Suspense fallback={<CreativeEditorLoading label={t('正在加载编辑器')} />}>
          {error ? <p role="alert" className="media-video-editor-error">{error}</p> : null}
          {editingText && loadingSource ? <CreativeEditorLoading label={t('正在读取文件')} /> : null}
          {editingText && !loadingSource ? <SurfaceErrorBoundary onError={handleSurfaceError}><TextEditorPanel key={request.textDocumentId || request.fileName} documentId={request.textDocumentId} importSourceUrl={!request.textDocumentId && typeof resolvedSource === 'string' ? resolvedSource || undefined : undefined} fileName={request.fileName} handleRef={editor} /></SurfaceErrorBoundary> : null}
          {editingVideo && loadingSource ? <CreativeEditorLoading label={t('正在读取文件')} /> : null}
          {editingVideo && !loadingSource && !error && typeof resolvedSource === 'string' ? <SurfaceErrorBoundary onError={handleSurfaceError}><VideoEditorPanel key={resolvedSource} sourceUrl={resolvedSource} handleRef={editor} /></SurfaceErrorBoundary> : null}
        </Suspense>
      </div>
    </FloatingWindow>
  ) : request ? (
    <AppModal
      ariaLabelledBy={titleId}
      backdropClassName="file-preview-overlay"
      dialogClassName="file-preview-dialog"
      onClose={closeFilePreview}
      size="preview"
    >
      <header className="ui-modal-header file-preview-header">
        <h2 id={titleId} className="file-preview-title"><FileText aria-hidden="true" size={18} /><span title={request.fileName}>{request.fileName}</span></h2>
        {typeof resolvedSource === 'string' && /\.(txt|md|markdown|html?)$/i.test(request.fileName) ? <button className="ui-button file-preview-edit-button" type="button" onClick={() => { setRequest({ ...request, mode: 'editText' }); setError(''); }}><FileText size={16} />编辑文本</button> : null}
        {typeof resolvedSource === 'string' && /\/api\/artifacts\//.test(resolvedSource) && /\.(mp4|webm|mov|mkv|avi)$/i.test(request.fileName) && !editingVideo ? (
          <button className="ui-button file-preview-edit-button" onClick={() => { setEditingVideo(true); setError(''); }} type="button"><Scissors size={16} />{t('剪辑视频')}</button>
        ) : null}
        <button aria-label={t('关闭')} autoFocus className="ui-icon-button ui-modal-close file-preview-close" onClick={closeFilePreview} type="button">
          <X size={18} />
        </button>
      </header>
      <div className="ui-modal-body file-preview-stage">
        <Suspense fallback={<FilePreviewModuleLoading />}>
          {loadingSource ? <BeautifulLoadingState label={t('正在读取文件')} /> : null}
          {!loadingSource && error && !editingVideo ? (
            <div className="file-preview-error" role="alert">
              <FileText size={24} />
              <strong>{t('无法预览此文件')}</strong>
              <span>{error}</span>
            </div>
          ) : null}
          {editingVideo && error ? <p role="alert" className="media-video-editor-error">{error}</p> : null}
          {!editingVideo && !loadingSource && !error && resolvedSource !== null ? (
            <SurfaceErrorBoundary onError={handleSurfaceError}>
              <OpenFileViewerSurface
                fileName={request.fileName}
                locale={language === 'en' ? 'en-US' : 'zh-CN'}
                mimeType={request.mimeType}
                onError={handleSurfaceError}
                source={resolvedSource}
                theme={mode}
              />
            </SurfaceErrorBoundary>
          ) : null}
        </Suspense>
      </div>
    </AppModal>
  ) : null;

  return (
    <FilePreviewContext.Provider value={contextValue}>
      {children}
      {dialog}
    </FilePreviewContext.Provider>
  );
}
