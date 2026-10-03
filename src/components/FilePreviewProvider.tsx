'use client';

import dynamic from 'next/dynamic';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BookOpen, FileText, Scissors, X } from 'lucide-react';
import { novelProjectIdFromFile } from '@/lib/novel-editor';
import type { VideoEditorHandle } from './VideoEditorPanel';
import type { PreviewSource } from '@open-file-viewer/core';
import { artifactContentType } from '@cjfclonedeep/capability-sdk/file/formats';
import { BeautifulLoadingState } from '@/components/BeautifulLoadingState';
import { CreativeEditorLoading } from './CreativeEditorLoading';
import { useI18n } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { AppModal } from '@/components/ui/app-modal';
import { FloatingWindow } from '@cjfclonedeep/capability-sdk/ui/floating-window';
import '@/app/styles/creative-editors.css';

function FilePreviewModuleLoading() {
  const { t } = useI18n();
  return <BeautifulLoadingState label={t('正在加载文件预览')} />;
}

const OpenFileViewerSurface = dynamic(
  () => import('@/components/OpenFileViewerSurface').then((module) => module.OpenFileViewerSurface),
  {
    loading: () => <FilePreviewModuleLoading />,
    ssr: false,
  },
);
const VideoEditorPanel = dynamic(() => import('./VideoEditorPanel').then(module => module.VideoEditorPanel), { ssr: false, loading: () => <CreativeEditorLoading label="正在加载视频编辑器" /> });
const NovelEditorPanel = dynamic(() => import('./NovelEditorPanel').then(module => module.NovelEditorPanel), { ssr: false, loading: () => <CreativeEditorLoading label="正在加载小说编辑器" /> });

const FILE_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'rtf', 'odt',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv',
  'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'odp', 'ofd', 'epub', 'xps', 'oxps',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'jxl', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif',
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm3u8', 'flv', 'm2ts', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'midi', 'mid',
  'txt', 'md', 'markdown', 'json', 'jsonc', 'json5', 'ipynb', 'yaml', 'yml', 'toml', 'ini', 'xml', 'lrc',
  'js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'css', 'scss', 'less', 'py', 'go', 'rs', 'rb', 'swift', 'kt', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'sql', 'proto', 'hcl', 'tex', 'gv', 'http',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'eml', 'msg', 'mbox',
  'apk', 'bin', 'deb', 'dmg', 'exe', 'ipa', 'msi', 'pkg', 'rpm',
  'dxf', 'dwg', 'dwf', 'step', 'stp', 'ifc', 'gds', 'gdsii', 'oas', 'oasis',
  'gltf', 'glb', 'obj', 'stl', 'fbx', 'dae', '3mf', 'usdz',
  'geojson', 'topojson', 'kml', 'kmz', 'gpx', 'shp', 'drawio', 'excalidraw', 'xmind',
  'ttf', 'otf', 'woff', 'woff2', 'psd', 'psb', 'ai', 'eps', 'sqlite', 'sqlite3', 'db', 'wasm', 'parquet', 'avro', 'webarchive',
]);

export type FilePreviewRequest = {
  fileName: string;
  mimeType?: string;
  source: PreviewSource | (() => Promise<PreviewSource>);
  mode?: 'preview' | 'editVideo' | 'editNovel';
  novelProjectId?: string;
};

function filePreviewMimeType(fileName: string, mimeType?: string) {
  const explicit = String(mimeType || '').trim();
  if (explicit) return explicit;
  const inferred = artifactContentType(fileName);
  return inferred === 'application/octet-stream' ? undefined : inferred;
}

type FilePreviewContextValue = {
  closeFilePreview: () => void;
  filePreviewOpen: boolean;
  openFilePreview: (request: FilePreviewRequest) => void;
};

const FilePreviewContext = createContext<FilePreviewContextValue | undefined>(undefined);

export function fileNameFromPreviewUrl(value: string) {
  try {
    const parsed = new URL(value, typeof window === 'undefined' ? 'http://127.0.0.1/' : window.location.href);
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) || 'file');
    return name || 'file';
  } catch {
    return value.split(/[?#]/, 1)[0]?.split('/').filter(Boolean).at(-1) || 'file';
  }
}

export function isFilePreviewHref(href?: string, fileName?: string) {
  const rawHref = String(href || '').trim();
  if (!rawHref || rawHref.startsWith('#') || /^(javascript|mailto|tel):/i.test(rawHref)) return false;
  const candidateName = String(fileName || fileNameFromPreviewUrl(rawHref)).trim();
  const extension = candidateName.match(/\.([a-z0-9]{1,12})(?:$|[?#])/i)?.[1]?.toLowerCase();
  if (extension && FILE_EXTENSIONS.has(extension)) return true;
  try {
    const url = new URL(rawHref, typeof window === 'undefined' ? 'http://127.0.0.1/' : window.location.href);
    return url.pathname.includes('/api/artifacts/') || url.pathname.includes('/api/tutorial/sample/');
  } catch {
    return false;
  }
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
  const editingNovel = request?.mode === 'editNovel';
  const editor = useRef<VideoEditorHandle>(null);

  const closeFilePreview = useCallback(async () => {
    try { await editor.current?.flush(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    setRequest(null);
    setResolvedSource(null);
    setLoadingSource(false);
    setError('');
    setEditingVideo(false);
  }, []);
  const openFilePreview = useCallback(async (nextRequest: FilePreviewRequest) => {
    try { await editor.current?.flush(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    setRequest({
      ...nextRequest,
      ...(!nextRequest.mode && novelProjectIdFromFile(nextRequest.fileName) ? { mode: 'editNovel', novelProjectId: novelProjectIdFromFile(nextRequest.fileName) } : {}),
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

  const dialog = request && (editingNovel || editingVideo) ? (
    <FloatingWindow title={editingNovel ? '小说书架 · 阅读与编辑' : '视频剪辑'} className={`creative-editor-window ${editingNovel ? 'novel-editor-window' : 'video-editor-window'}`} onClose={closeFilePreview}>
      <div className="creative-editor-body">
        {error ? <p role="alert" className="media-video-editor-error">{error}</p> : null}
        {editingNovel ? <NovelEditorPanel key={request.novelProjectId || 'library'} projectId={request.novelProjectId} handleRef={editor} /> : null}
        {editingVideo && loadingSource ? <CreativeEditorLoading label={t('正在读取文件')} /> : null}
        {editingVideo && !loadingSource && typeof resolvedSource === 'string' ? <VideoEditorPanel key={resolvedSource} sourceUrl={resolvedSource} handleRef={editor} /> : null}
      </div>
    </FloatingWindow>
  ) : request ? (
    <AppModal
      ariaLabelledBy={titleId}
      backdropClassName="file-preview-overlay"
      dialogClassName={`file-preview-dialog${editingVideo ? ' file-preview-video-editor-dialog' : ''}${editingNovel ? ' file-preview-novel-dialog' : ''}`}
      onClose={closeFilePreview}
      size="preview"
    >
      <header className="ui-modal-header file-preview-header">
        <span aria-hidden="true" className="file-preview-heading-icon">{editingNovel ? <BookOpen size={18} /> : <FileText size={18} />}</span>
        <div className="file-preview-heading-copy">
          <h2 id={titleId}>{editingNovel ? '小说工作台' : request.fileName}</h2>
          <p>{editingNovel ? '阅读故事，打磨文字' : t(editingVideo ? '视频剪辑' : '文件预览')}</p>
        </div>
        {typeof resolvedSource === 'string' && /\/api\/artifacts\//.test(resolvedSource) && /\.(mp4|webm|mov|mkv|avi)$/i.test(request.fileName) && !editingVideo ? (
          <button className="ui-button file-preview-edit-button" onClick={() => { setEditingVideo(true); setError(''); }} type="button"><Scissors size={16} />{t('剪辑视频')}</button>
        ) : null}
        <button aria-label={t('关闭')} autoFocus className="ui-icon-button ui-modal-close file-preview-close" onClick={closeFilePreview} type="button">
          <X size={18} />
        </button>
      </header>
      <div className="ui-modal-body file-preview-stage">
        {loadingSource ? <BeautifulLoadingState label={t('正在读取文件')} /> : null}
        {!loadingSource && error && !editingVideo && !editingNovel ? (
          <div className="file-preview-error" role="alert">
            <FileText size={24} />
            <strong>{t('无法预览此文件')}</strong>
            <span>{error}</span>
          </div>
        ) : null}
        {(editingVideo || editingNovel) && error ? <p role="alert" className="media-video-editor-error">{error}</p> : null}
        {editingNovel ? <NovelEditorPanel key={request.novelProjectId || 'library'} projectId={request.novelProjectId} handleRef={editor} /> : null}
        {!loadingSource && editingVideo && typeof resolvedSource === 'string' ? <VideoEditorPanel key={resolvedSource} sourceUrl={resolvedSource} handleRef={editor} /> : null}
        {!editingVideo && !editingNovel && !loadingSource && !error && resolvedSource !== null ? (
          <OpenFileViewerSurface
            fileName={request.fileName}
            locale={language === 'en' ? 'en-US' : 'zh-CN'}
            mimeType={request.mimeType}
            onError={(reason) => setError(reason.message)}
            source={resolvedSource}
            theme={mode}
          />
        ) : null}
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

export function useFilePreview() {
  const context = useContext(FilePreviewContext);
  if (!context) throw new Error('useFilePreview must be used inside FilePreviewProvider');
  return context;
}
