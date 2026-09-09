'use client';

import { memo } from 'react';
import { FileViewer } from '@open-file-viewer/react';
import {
  archivePlugin,
  assetPlugin,
  audioPlugin,
  cadPlugin,
  drawingPlugin,
  emailPlugin,
  epubPlugin,
  fallbackPlugin,
  gisPlugin,
  imagePlugin,
  model3dPlugin,
  officePlugin,
  ofdPlugin,
  pdfPlugin,
  textPlugin,
  videoPlugin,
  xmindPlugin,
  xpsPlugin,
  type PreviewLocale,
  type PreviewSource,
  type PreviewTheme,
  type PreviewFile,
  type PreviewPlugin,
} from '@open-file-viewer/core';

const pdfWorkerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

function presentationPreviewUrl(file: PreviewFile) {
  if (!/^(?:\.)?(?:pptx?|pptm|ppsx?|odp)$/i.test(file.extension)) return undefined;
  const source = typeof file.source === 'string' ? file.source : file.url;
  if (!source) return undefined;
  const url = new URL(source, window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.includes('/api/artifacts/')) return undefined;
  url.searchParams.delete('download');
  url.searchParams.set('preview', 'pdf');
  return url;
}

const nativePdfPreview = pdfPlugin({ workerSrc: pdfWorkerSrc, useSystemFonts: true });
const nativePresentationPreview: PreviewPlugin = {
  name: 'native-presentation',
  match: (file) => Boolean(presentationPreviewUrl(file)),
  render: (context) => {
    const url = presentationPreviewUrl(context.file)!;
    // Delegate only the displayed content. The host toolbar keeps the source
    // file, so downloading still returns the original editable presentation.
    return nativePdfPreview.render({
      ...context,
      file: {
        source: url.href, url: url.href,
        name: context.file.name.replace(/\.[^.]+$/, '.pdf'),
        extension: 'pdf', mimeType: 'application/pdf',
      },
    });
  },
};

const previewPlugins = [
  imagePlugin(),
  videoPlugin(),
  audioPlugin(),
  textPlugin(),
  pdfPlugin({
    workerSrc: pdfWorkerSrc,
    useSystemFonts: true,
  }),
  // The generic PPT renderer drops point styles and invents legend colors.
  nativePresentationPreview,
  officePlugin({
    pdf: {
      workerSrc: pdfWorkerSrc,
      useSystemFonts: true,
    },
  }),
  ofdPlugin(),
  epubPlugin(),
  xpsPlugin(),
  archivePlugin(),
  emailPlugin(),
  drawingPlugin(),
  xmindPlugin(),
  cadPlugin(),
  model3dPlugin(),
  gisPlugin(),
  assetPlugin(),
  fallbackPlugin(),
];

export const OpenFileViewerSurface = memo(function OpenFileViewerSurface({
  fileName,
  locale,
  mimeType,
  onError,
  source,
  theme,
}: {
  fileName: string;
  locale: PreviewLocale;
  mimeType?: string;
  onError: (error: Error) => void;
  source: PreviewSource;
  theme: PreviewTheme;
}) {
  return (
    <FileViewer
      fallback="inline"
      file={source}
      fileName={fileName}
      fit="contain"
      height="100%"
      locale={locale}
      mimeType={mimeType}
      onError={onError}
      plugins={previewPlugins}
      theme={theme}
      toolbar
      width="100%"
    />
  );
});
