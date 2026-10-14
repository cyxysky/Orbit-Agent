'use client';

import { createContext, useContext } from 'react';
import type { PreviewSource } from '@open-file-viewer/core';

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

export type FilePreviewContextValue = {
  closeFilePreview: () => void;
  filePreviewOpen: boolean;
  openFilePreview: (request: FilePreviewRequest) => void;
};

export const FilePreviewContext = createContext<FilePreviewContextValue | undefined>(undefined);

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

export function useFilePreview() {
  const context = useContext(FilePreviewContext);
  if (!context) throw new Error('useFilePreview must be used inside FilePreviewProvider');
  return context;
}
