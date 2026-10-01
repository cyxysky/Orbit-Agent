'use client';

import { type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, useCallback, useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Download, Globe, Loader2, Plus, RotateCw, X } from 'lucide-react';
import { FloatingWindow } from '../../ui/floating-window.tsx';
import { browserPreviewStyles } from './styles.ts';
const identity = (text: string) => text;
export type BrowserPreviewClient = {
  connect: (signal: AbortSignal) => Promise<{ url: string; transport?: 'image' | 'video' }>;
  uploadFile: (file: File) => Promise<{ mimeType: string; name: string; path: string }>;
  resolveDownloadUrl?: (url: string) => string;
  download?: (input: { fileName: string; url: string }) => Promise<void>;
};

type BrowserPreviewTab = {
  id: string;
  index: number;
  url: string;
  active: boolean;
};

type BrowserPreviewFrame = {
  capturedAt: string;
  contentType: 'image/jpeg' | 'image/png';
  imageUrl: string;
  sequence?: number;
  tabs: BrowserPreviewTab[];
  url: string;
  viewport: { width: number; height: number };
};

type BrowserPreviewServerMetrics = {
  activeCaptures?: number;
  backpressureDrops?: number;
  bitrateKbps?: number;
  captureDurationMs?: number;
  captureDurationMsAverage?: number;
  captureFps?: number;
  height?: number;
  h264Level?: string;
  h264Profile?: string;
  imageFormat?: 'jpeg' | 'png';
  imageQuality?: number;
  maxConcurrentCaptures?: number;
  mimeType?: string;
  pendingClientFrames?: number;
  sendFps?: number;
  targetFps?: number;
  transport?: 'image' | 'video';
  width?: number;
};

type BrowserPreviewDisplayMetrics = BrowserPreviewServerMetrics & {
  displayedFps: number;
  receivedFps: number;
};

const BROWSER_PREVIEW_VIDEO_MIME_TYPE = 'video/mp4; codecs="avc1.42C029"';

function previewTabLabel(address: string, emptyLabel: string) {
  if (!address || address === 'about:blank') return emptyLabel;
  try {
    const url = new URL(address);
    const route = (url.hash.startsWith('#/') ? url.hash.slice(1) : url.pathname).split('?')[0];
    const leaf = route.split('/').filter(Boolean).pop();
    const host = url.hostname || url.protocol.replace(/:$/, '');
    return leaf ? `${decodeURIComponent(leaf)} · ${host}` : host;
  } catch { return address; }
}

type BrowserPreviewInput =
  | { kind: 'browserControl'; action: 'navigate' | 'open' | 'close' | 'back' | 'forward' | 'reload'; url?: string; tabId?: string }
  | { kind: 'clipboard'; action: 'copy' | 'cut' }
  | { kind: 'tab'; tabId: string }
  | { kind: 'move'; xRatio: number; yRatio: number }
  | { kind: 'click'; xRatio: number; yRatio: number; button: 'left' | 'right' | 'middle'; clickCount: number }
  | { kind: 'drag'; xRatio: number; yRatio: number; toXRatio: number; toYRatio: number; button: 'left' | 'right' | 'middle' }
  | { kind: 'scroll'; xRatio: number; yRatio: number; deltaX: number; deltaY: number }
  | { kind: 'key'; key: string }
  | { kind: 'text'; text: string }
  | { kind: 'select'; xRatio: number; yRatio: number; value: string }
  | { controlKind: 'datalist' | 'picker'; kind: 'controlValue'; value: string; xRatio: number; yRatio: number }
  | { controlId: string; files: Array<{ mimeType: string; name: string; path: string }>; kind: 'files' }
  | { accept: boolean; dialogId: string; kind: 'dialog'; promptText?: string };

type BrowserPreviewNativeControlPosition = {
  label: string;
  openUpwards: boolean;
  targetXRatio: number;
  targetYRatio: number;
  topRatio: number;
  widthRatio: number;
  xRatio: number;
  yRatio: number;
};

type BrowserPreviewNativeControl = BrowserPreviewNativeControlPosition & ({
  kind: 'select';
  options: Array<{
    disabled: boolean;
    group?: string;
    label: string;
    selected: boolean;
    value: string;
  }>;
  selectedValue: string;
} | {
  kind: 'datalist';
  options: Array<{ label: string; value: string }>;
  value: string;
} | {
  inputType: 'color' | 'date' | 'datetime-local' | 'month' | 'time' | 'week';
  kind: 'picker';
  max?: string;
  min?: string;
  step?: string;
  value: string;
} | {
  accept: string;
  capture?: string;
  controlId: string;
  kind: 'file';
  multiple: boolean;
});

type BrowserPreviewDialog = {
  defaultValue: string;
  dialogType: 'alert' | 'beforeunload' | 'confirm' | 'prompt';
  id: string;
  message: string;
};

type BrowserPreviewDownload = {
  bytes?: number;
  delivery?: 'pending' | 'started';
  error?: string;
  fileName: string;
  id: string;
  status: 'preparing' | 'ready';
  url?: string;
};

export function BrowserPreviewWindow({ onClose, client, translate: t = identity }: { onClose: () => void; client: BrowserPreviewClient; translate?: (text: string) => string }) {
  const streamRef = useRef<WebSocket | null>(null);
  const reconnectEnabledRef = useRef(true);
  const frameGenerationRef = useRef(0);
  const lastDisplayedAtRef = useRef(Date.now());
  const previewInputReadyRef = useRef(false);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  const previewFileInputRef = useRef<HTMLInputElement | null>(null);
  const handledPreviewDownloadIdsRef = useRef(new Set<string>());
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const videoChunkQueueRef = useRef<Uint8Array<ArrayBuffer>[]>([]);
  const videoQueuedBytesRef = useRef(0);
  const videoObjectUrlRef = useRef('');
  const forceImageTransportRef = useRef(false);
  const pumpVideoChunksRef = useRef<() => void>(() => undefined);
  const pendingFrameRef = useRef<BrowserPreviewFrame | null>(null);
  const frameObjectUrlRef = useRef('');
  const staleFrameObjectUrlRef = useRef('');
  const decodingFrameObjectUrlRef = useRef('');
  const frameDecodeActiveRef = useRef(false);
  const framePipelineDisposedRef = useRef(false);
  const frameCountersRef = useRef({
    displayed: 0,
    received: 0,
    sampledAt: Date.now(),
    sampledDisplayed: 0,
    sampledReceived: 0,
  });
  const frameStateRef = useRef<Pick<BrowserPreviewFrame, 'tabs' | 'url' | 'viewport'>>({
    tabs: [],
    url: '',
    viewport: { height: 720, width: 1280 },
  });
  const pendingMoveRef = useRef<Extract<BrowserPreviewInput, { kind: 'move' }> | null>(null);
  const pointerGestureRef = useRef<{
    button: 'left' | 'middle';
    clickCount: number;
    current: { xRatio: number; yRatio: number };
    dragged: boolean;
    pointerId: number;
    start: { xRatio: number; yRatio: number };
    startClientX: number;
    startClientY: number;
  } | null>(null);
  const moveFlushTimerRef = useRef<number | undefined>(undefined);
  const pendingScrollRef = useRef<Extract<BrowserPreviewInput, { kind: 'scroll' }> | null>(null);
  const scrollFlushTimerRef = useRef<number | undefined>(undefined);
  const [frame, setFrame] = useState<BrowserPreviewFrame | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState('');
  const [videoDisplayReady, setVideoDisplayReady] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting' | 'unavailable'>('connecting');
  const [streamError, setStreamError] = useState('');
  const [inputError, setInputError] = useState('');
  const [previewMetrics, setPreviewMetrics] = useState<BrowserPreviewDisplayMetrics | null>(null);
  const [nativeControl, setNativeControl] = useState<BrowserPreviewNativeControl | null>(null);
  const [nativeControlPosition, setNativeControlPosition] = useState<CSSProperties | null>(null);
  const [nativeControlBusy, setNativeControlBusy] = useState(false);
  const [nativePickerValue, setNativePickerValue] = useState('');
  const nativeDialogTitleId = useId();
  const [nativeDialog, setNativeDialog] = useState<BrowserPreviewDialog | null>(null);
  const [nativeDialogPrompt, setNativeDialogPrompt] = useState('');
  const [previewDownload, setPreviewDownload] = useState<BrowserPreviewDownload | null>(null);
  const videoPipelineErrorRef = useRef<(message: string) => void>(() => undefined);
  const previewViewportWidth = frame?.viewport.width;
  const previewViewportHeight = frame?.viewport.height;

  useLayoutEffect(() => {
    const stage = previewStageRef.current;
    if (!nativeControl || !previewViewportWidth || !previewViewportHeight || !stage) {
      setNativeControlPosition(null);
      return undefined;
    }
    const updatePosition = () => {
      const stageRect = stage.getBoundingClientRect();
      if (!stageRect.width || !stageRect.height) return;
      const sourceRatio = Math.max(1, previewViewportWidth) / Math.max(1, previewViewportHeight);
      const stageRatio = stageRect.width / stageRect.height;
      const contentWidth = stageRatio > sourceRatio ? stageRect.height * sourceRatio : stageRect.width;
      const contentHeight = stageRatio > sourceRatio ? stageRect.height : stageRect.width / sourceRatio;
      const contentLeft = (stageRect.width - contentWidth) / 2;
      const contentTop = (stageRect.height - contentHeight) / 2;
      const menuWidth = Math.min(
        Math.max(nativeControl.widthRatio * contentWidth, Math.min(220, contentWidth - 16)),
        Math.max(0, contentWidth - 16),
      );
      const desiredLeft = contentLeft + nativeControl.xRatio * contentWidth;
      const left = Math.min(
        Math.max(contentLeft + 8, desiredLeft),
        Math.max(contentLeft + 8, contentLeft + contentWidth - menuWidth - 8),
      );
      setNativeControlPosition({
        left,
        width: menuWidth,
        ...(nativeControl.openUpwards
          ? { bottom: stageRect.height - (contentTop + nativeControl.topRatio * contentHeight) }
          : { top: contentTop + nativeControl.yRatio * contentHeight }),
      });
    };
    updatePosition();
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(stage);
    return () => resizeObserver.disconnect();
  }, [nativeControl, previewViewportHeight, previewViewportWidth]);

  useEffect(() => {
    setNativePickerValue(nativeControl?.kind === 'picker' ? nativeControl.value : '');
    setNativeControlBusy(false);
  }, [nativeControl]);

  useEffect(() => {
    if (nativeControl?.kind !== 'file') return undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      try {
        previewFileInputRef.current?.click();
      } catch (error) {
        setNativeControl(null);
        setInputError(error instanceof Error ? error.message : '无法打开系统文件选择器');
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [nativeControl]);

  const disposeVideoPipeline = useCallback((updateState = true) => {
    const sourceBuffer = sourceBufferRef.current;
    sourceBufferRef.current = null;
    videoChunkQueueRef.current = [];
    videoQueuedBytesRef.current = 0;
    if (sourceBuffer?.updating) {
      try { sourceBuffer.abort(); } catch { /* MediaSource may already be closed. */ }
    }
    const mediaSource = mediaSourceRef.current;
    mediaSourceRef.current = null;
    if (mediaSource?.readyState === 'open') {
      try { mediaSource.endOfStream(); } catch { /* Decoder teardown is best-effort. */ }
    }
    if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
    videoObjectUrlRef.current = '';
    if (updateState) {
      setVideoObjectUrl('');
      setVideoDisplayReady(false);
    }
  }, []);

  const pumpVideoChunks = useCallback(() => {
    const sourceBuffer = sourceBufferRef.current;
    if (!sourceBuffer || sourceBuffer.updating) return;
    // Catch up before appending the backlog accumulated in a background tab.
    const video = previewVideoRef.current;
    if (video && sourceBuffer.buffered.length) {
      const lastRange = sourceBuffer.buffered.length - 1;
      const start = sourceBuffer.buffered.start(lastRange);
      const end = sourceBuffer.buffered.end(lastRange);
      if (video.currentTime < start || end - video.currentTime > 0.6) video.currentTime = Math.max(start, end - 0.12);
      if (video.paused) void video.play().catch(() => undefined);
      if (end - sourceBuffer.buffered.start(0) > 4) {
        const removeBefore = Math.min(video.currentTime - 1, end - 1.5);
        if (removeBefore > sourceBuffer.buffered.start(0) + 0.5) {
          try { sourceBuffer.remove(0, removeBefore); return; } catch { /* Retry after the next append. */ }
        }
      }
    }
    const next = videoChunkQueueRef.current.shift();
    if (next) {
      videoQueuedBytesRef.current -= next.byteLength;
      try {
        sourceBuffer.appendBuffer(next);
      } catch (error) {
        videoPipelineErrorRef.current(error instanceof Error ? error.message : '视频缓冲区写入失败');
      }
      return;
    }
  }, []);
  pumpVideoChunksRef.current = pumpVideoChunks;

  const beginVideoPipeline = useCallback((contentType: string, initialization: Uint8Array<ArrayBuffer>) => {
    disposeVideoPipeline();
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(contentType)) return false;
    setVideoDisplayReady(false);
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    mediaSourceRef.current = mediaSource;
    videoObjectUrlRef.current = objectUrl;
    videoChunkQueueRef.current = [initialization];
    videoQueuedBytesRef.current = initialization.byteLength;
    mediaSource.addEventListener('sourceopen', () => {
      if (mediaSourceRef.current !== mediaSource) return;
      try {
        const sourceBuffer = mediaSource.addSourceBuffer(contentType);
        sourceBuffer.mode = 'segments';
        sourceBufferRef.current = sourceBuffer;
        sourceBuffer.addEventListener('updateend', () => {
          if (sourceBufferRef.current === sourceBuffer) pumpVideoChunksRef.current();
        });
        sourceBuffer.addEventListener('error', () => {
          if (sourceBufferRef.current === sourceBuffer) videoPipelineErrorRef.current('H.264 视频解码失败');
        });
        pumpVideoChunksRef.current();
      } catch (error) {
        videoPipelineErrorRef.current(error instanceof Error ? error.message : '无法创建 H.264 视频缓冲区');
      }
    }, { once: true });
    setVideoObjectUrl(objectUrl);
    return true;
  }, [disposeVideoPipeline]);

  const enqueueVideoChunk = useCallback((chunk: Uint8Array<ArrayBuffer>) => {
    if (!mediaSourceRef.current) return;
    if (videoChunkQueueRef.current.length >= 64 || videoQueuedBytesRef.current + chunk.byteLength > 8 * 1024 * 1024) {
      videoPipelineErrorRef.current('视频缓冲积压过多，正在回退到图片预览');
      return;
    }
    videoChunkQueueRef.current.push(chunk);
    videoQueuedBytesRef.current += chunk.byteLength;
    pumpVideoChunksRef.current();
  }, []);

  const fallbackToImagePreview = useCallback((message: string) => {
    forceImageTransportRef.current = true;
    disposeVideoPipeline();
    setStreamError(message);
    const stream = streamRef.current;
    if (stream?.readyState === WebSocket.OPEN || stream?.readyState === WebSocket.CONNECTING) stream.close();
  }, [disposeVideoPipeline]);
  videoPipelineErrorRef.current = fallbackToImagePreview;

  const deliverPreviewDownload = useCallback(async (
    download: BrowserPreviewDownload,
    options: { repeat?: boolean; userInitiated?: boolean } = {},
  ) => {
    if (!download.url) return;
    // Chromium blocks repeated downloads started from asynchronous WebSocket
    // callbacks. On the web, wait for the user to click the notice button so
    // anchor.click() runs inside a real user-activation handler.
    if (!client.download && !options.userInitiated) return;
    if (!options.repeat && handledPreviewDownloadIdsRef.current.has(download.id)) return;
    handledPreviewDownloadIdsRef.current.add(download.id);
    try {
      const url = (client.resolveDownloadUrl || identity)(download.url);
      if (client.download) {
        await client.download({ fileName: download.fileName, url });
      } else {
        const anchor = document.createElement('a');
        anchor.download = download.fileName;
        anchor.href = url;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      setPreviewDownload((current) => current?.id === download.id
        ? { ...current, delivery: 'started' }
        : current);
    } catch (error) {
      handledPreviewDownloadIdsRef.current.delete(download.id);
      setInputError(error instanceof Error ? error.message : '下载文件失败');
    }
  }, [client]);

  useEffect(() => {
    if (!previewDownload) return undefined;
    const timeoutMs = previewDownload.delivery === 'started'
      ? 4_000
      : previewDownload.status === 'ready' ? 15_000 : 20_000;
    const timer = window.setTimeout(() => {
      setPreviewDownload((current) => current?.id === previewDownload.id ? null : current);
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [previewDownload]);

  const clearPreviewFrames = useCallback((preserveDisplayed = false) => {
    previewInputReadyRef.current = false;
    frameGenerationRef.current += 1;
    // Keep a still of the last decoded video during reconnect/decoder changes.
    const video = previewVideoRef.current;
    if (preserveDisplayed && video && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(video, 0, 0);
          const imageUrl = canvas.toDataURL('image/jpeg', 0.9);
          setFrame({ ...frameStateRef.current, imageUrl, contentType: 'image/jpeg', capturedAt: new Date().toISOString() });
        }
      } catch { /* Retain the last image frame when video capture is unavailable. */ }
    }
    for (const url of [preserveDisplayed ? undefined : frameObjectUrlRef.current, staleFrameObjectUrlRef.current, decodingFrameObjectUrlRef.current, pendingFrameRef.current?.imageUrl]) {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    if (!preserveDisplayed) frameObjectUrlRef.current = '';
    staleFrameObjectUrlRef.current = '';
    decodingFrameObjectUrlRef.current = '';
    pendingFrameRef.current = null;
    frameDecodeActiveRef.current = false;
    lastDisplayedAtRef.current = Date.now();
    if (!preserveDisplayed) setFrame(null);
  }, []);

  const commitPendingPreviewFrame = useCallback(async function commitPendingPreviewFrame() {
    if (framePipelineDisposedRef.current || frameDecodeActiveRef.current) return;
    const nextFrame = pendingFrameRef.current;
    if (!nextFrame) return;
    pendingFrameRef.current = null;
    frameDecodeActiveRef.current = true;
    const generation = frameGenerationRef.current;
    decodingFrameObjectUrlRef.current = nextFrame.imageUrl;
    let committed = false;
    try {
      const decodedImage = new Image();
      decodedImage.decoding = 'async';
      decodedImage.src = nextFrame.imageUrl;
      await decodedImage.decode();
      if (framePipelineDisposedRef.current || generation !== frameGenerationRef.current) return;

      if (staleFrameObjectUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(staleFrameObjectUrlRef.current);
      }
      staleFrameObjectUrlRef.current = frameObjectUrlRef.current;
      frameObjectUrlRef.current = nextFrame.imageUrl;
      decodingFrameObjectUrlRef.current = '';
      committed = true;
      frameCountersRef.current.displayed += 1;
      lastDisplayedAtRef.current = Date.now();
      previewInputReadyRef.current = true;
      setFrame(nextFrame);
      setStatus('live');
      setStreamError('');
    } catch {
      // A newer frame remains queued and will be decoded below.
    } finally {
      if (!committed && nextFrame.imageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(nextFrame.imageUrl);
      }
      if (decodingFrameObjectUrlRef.current === nextFrame.imageUrl) {
        decodingFrameObjectUrlRef.current = '';
      }
      if (generation === frameGenerationRef.current) {
        frameDecodeActiveRef.current = false;
        if (!framePipelineDisposedRef.current && pendingFrameRef.current) void commitPendingPreviewFrame();
      }
    }
  }, []);

  const queuePreviewFrame = useCallback((nextFrame: BrowserPreviewFrame) => {
    if (framePipelineDisposedRef.current) {
      if (nextFrame.imageUrl.startsWith('blob:')) URL.revokeObjectURL(nextFrame.imageUrl);
      return;
    }
    const previousPending = pendingFrameRef.current?.imageUrl;
    if (previousPending?.startsWith('blob:')) URL.revokeObjectURL(previousPending);
    pendingFrameRef.current = nextFrame;
    void commitPendingPreviewFrame();
  }, [commitPendingPreviewFrame]);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;
    let connectionId = 0;
    let requestController: AbortController | undefined;
    let lastMessageAt = Date.now();
    let lastMediaAt = 0;
    let playbackResumedAt = 0;
    reconnectEnabledRef.current = true;
    clearPreviewFrames();
    const disconnect = () => {
      previewInputReadyRef.current = false;
      connectionId += 1;
      requestController?.abort();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      const stream = streamRef.current;
      streamRef.current = null;
      if (stream) {
        stream.onopen = stream.onmessage = stream.onerror = stream.onclose = null;
        stream.close();
      }
    };
    const scheduleReconnect = (delay = 0) => {
      disconnect();
      if (disposed || !reconnectEnabledRef.current) return;
      setStatus('reconnecting');
      if (document.visibilityState === 'visible') reconnectTimer = window.setTimeout(() => void connect(), delay);
    };
    const connect = async () => {
      disconnect();
      if (disposed || !reconnectEnabledRef.current || document.visibilityState !== 'visible') return;
      const attempt = connectionId;
      const isCurrent = () => !disposed && attempt === connectionId;
      requestController = new AbortController();
      lastMessageAt = lastDisplayedAtRef.current = Date.now();
      lastMediaAt = 0;
      clearPreviewFrames(true);
      disposeVideoPipeline();
      try {
        const data = await client.connect(AbortSignal.any([requestController.signal, AbortSignal.timeout(10_000)]));
        if (!isCurrent()) return;
        const videoSupported = typeof MediaSource !== 'undefined'
          && MediaSource.isTypeSupported(BROWSER_PREVIEW_VIDEO_MIME_TYPE);
        const requestedTransport = data.transport === 'image' || forceImageTransportRef.current || !videoSupported
          ? 'image'
          : 'video';
        const url = new URL(data.url);
        url.searchParams.set('transport', requestedTransport);
        const stream = new WebSocket(url);
        stream.binaryType = 'arraybuffer';
        streamRef.current = stream;
        stream.onopen = () => {
          if (!isCurrent()) return;
          lastMessageAt = Date.now();
          const counters = frameCountersRef.current;
          counters.sampledAt = Date.now();
          counters.sampledDisplayed = counters.displayed;
          counters.sampledReceived = counters.received;
          frameStateRef.current = { tabs: [], url: '', viewport: { height: 720, width: 1280 } };
          setPreviewMetrics(null);
          setStatus('connecting');
          setStreamError('');
        };
        stream.onmessage = (event) => {
          if (!isCurrent()) return;
          lastMessageAt = Date.now();
          try {
            if (event.data instanceof ArrayBuffer) {
              lastMediaAt = Date.now();
              const bytes = new Uint8Array(event.data);
              if (bytes.byteLength < 4) throw new Error('Invalid binary frame');
              const metadataLength = new DataView(event.data).getUint32(0, false);
              if (metadataLength <= 0 || metadataLength + 4 > bytes.byteLength) throw new Error('Invalid binary metadata');
              const metadata = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metadataLength))) as {
                capturedAt?: string;
                contentType?: string;
                sequence?: number;
                type?: 'frame' | 'videoChunk' | 'videoInit';
              };
              const payload = bytes.subarray(4 + metadataLength);
              if (metadata.type === 'videoInit') {
                if (!metadata.contentType || !beginVideoPipeline(metadata.contentType, payload)) {
                  fallbackToImagePreview('当前客户端不支持该 H.264 视频流，正在回退到图片预览');
                }
                return;
              }
              if (metadata.type === 'videoChunk') {
                frameCountersRef.current.received += 1;
                enqueueVideoChunk(payload);
                return;
              }
              if (metadata.type !== 'frame' || (metadata.contentType !== 'image/jpeg' && metadata.contentType !== 'image/png')) {
                throw new Error('Unknown binary preview payload');
              }
              frameCountersRef.current.received += 1;
              const imageUrl = URL.createObjectURL(new Blob(
                [payload],
                { type: metadata.contentType },
              ));
              queuePreviewFrame({
                ...frameStateRef.current,
                capturedAt: metadata.capturedAt || new Date().toISOString(),
                contentType: metadata.contentType,
                imageUrl,
                sequence: metadata.sequence,
              });
              return;
            }
            const message = JSON.parse(String(event.data)) as BrowserPreviewFrame & {
              error?: string;
              height?: number;
              metrics?: BrowserPreviewServerMetrics;
              control?: BrowserPreviewNativeControl;
              dialog?: BrowserPreviewDialog;
              dialogId?: string;
              download?: Omit<BrowserPreviewDownload, 'status'>;
              transport?: 'image' | 'video';
              type?: string;
              text?: string;
              width?: number;
            };
            if (message.type === 'tabsChanged' && Array.isArray(message.tabs)) {
              setNativeControl(null);
              frameStateRef.current = { ...frameStateRef.current, tabs: message.tabs };
              setFrame((current) => current ? { ...current, tabs: message.tabs } : current);
            } else if (message.type === 'navigationChanged' && typeof message.url === 'string') {
              setNativeControl(null);
              frameStateRef.current = { ...frameStateRef.current, url: message.url };
              setFrame((current) => current ? { ...current, url: message.url } : current);
            } else if (message.type === 'viewportChanged' && message.viewport) {
              frameStateRef.current = { ...frameStateRef.current, viewport: message.viewport };
              setFrame((current) => current ? { ...current, viewport: message.viewport } : current);
            } else if (message.type === 'frameHeartbeat' && message.metrics) {
              const counters = frameCountersRef.current;
              const sampledAt = Date.now();
              const sampleSeconds = Math.max(0.001, (sampledAt - counters.sampledAt) / 1_000);
              setPreviewMetrics({
                ...message.metrics,
                displayedFps: (counters.displayed - counters.sampledDisplayed) / sampleSeconds,
                receivedFps: (counters.received - counters.sampledReceived) / sampleSeconds,
              });
              counters.sampledAt = sampledAt;
              counters.sampledDisplayed = counters.displayed;
              counters.sampledReceived = counters.received;
            } else if (message.type === 'transportChanged' && message.transport) {
              if (message.transport === 'image') {
                forceImageTransportRef.current = true;
                disposeVideoPipeline();
                if (message.error) setStreamError(message.error);
              }
            } else if (message.type === 'activeTabChanged') {
              setNativeControl(null);
              clearPreviewFrames(true);
              disposeVideoPipeline();
              setStatus('reconnecting');
            } else if (message.type === 'nativeControlOpened' && message.control) {
              setNativeControl(message.control);
            } else if (message.type === 'nativeControlClosed') {
              setNativeControl(null);
              setNativeControlBusy(false);
            } else if (message.type === 'nativeDialogOpened' && message.dialog) {
              setNativeDialog(message.dialog);
              setNativeDialogPrompt(message.dialog.defaultValue || '');
            } else if (message.type === 'nativeDialogClosed') {
              setNativeDialog((current) => current?.id === message.dialogId ? null : current);
            } else if (message.type === 'browserDownloadStarted' && message.download) {
              setPreviewDownload({ ...message.download, status: 'preparing' });
            } else if (message.type === 'browserDownloadReady' && message.download?.url) {
              const readyDownload: BrowserPreviewDownload = { ...message.download, delivery: 'pending', status: 'ready' };
              setPreviewDownload(readyDownload);
              void deliverPreviewDownload(readyDownload);
            } else if (message.type === 'browserDownloadFailed' && message.download) {
              setPreviewDownload(null);
              setInputError(message.download.error || '测试浏览器文件下载失败');
            } else if (message.type === 'ready') {
              reconnectEnabledRef.current = true;
              if (previewInputReadyRef.current) setStatus('live');
              setStreamError('');
            } else if (message.type === 'clipboard' && message.text) {
              void Promise.resolve().then(() => navigator.clipboard.writeText(message.text!)).catch(() => {
                setInputError('无法写入本地剪贴板，请允许此页面访问剪贴板后重试');
              });
            } else if (message.type === 'inputError') {
              setNativeControlBusy(false);
              setInputError(message.error || '实时界面操作失败');
            } else if (message.type === 'unavailable') {
              reconnectEnabledRef.current = false;
              setStatus('unavailable');
              setStreamError(message.error || '当前会话没有运行中的测试浏览器');
            } else if (message.type === 'error') {
              setStreamError(message.error || '实时界面连接失败');
            }
          } catch {
            setStreamError('实时画面数据无效');
          }
        };
        stream.onerror = () => { if (isCurrent()) setStreamError(current => current || '实时界面连接中断，正在重连'); };
        stream.onclose = () => { if (isCurrent()) scheduleReconnect(600); };
      } catch (error) {
        if (!isCurrent()) return;
        setStreamError(error instanceof Error ? error.message : '实时界面连接失败');
        scheduleReconnect(600);
      }
    };
    const checkPlayback = () => {
      if (document.visibilityState !== 'visible' || !reconnectEnabledRef.current) return;
      const now = Date.now();
      pumpVideoChunksRef.current();
      const displayIdleMs = now - Math.max(lastDisplayedAtRef.current, playbackResumedAt);
      const displayStalled = lastMediaAt > lastDisplayedAtRef.current && displayIdleMs > 6_000;
      const awaitingFirstFrame = !previewInputReadyRef.current && displayIdleMs > 15_000;
      // A static page can have healthy heartbeats without producing new frames.
      // Reconnect only for lost liveness or media that actually failed to display.
      if (now - lastMessageAt > 8_000 || displayStalled || awaitingFirstFrame) scheduleReconnect();
    };
    const resume = () => {
      if (document.visibilityState !== 'visible' || !reconnectEnabledRef.current) return;
      // Give a suspended decoder time to catch up before judging its playback.
      playbackResumedAt = Date.now();
      const stream = streamRef.current;
      if (!stream || stream.readyState === WebSocket.CLOSED) scheduleReconnect();
      else checkPlayback();
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'visible') { resume(); return; }
      // Removing this viewer lets the server stop capture/encoding when there
      // are no visible viewers. Do not accumulate video in a suspended decoder.
      disconnect();
      clearPreviewFrames(true);
      disposeVideoPipeline();
      if (reconnectEnabledRef.current) setStatus('reconnecting');
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    window.addEventListener('focus', checkPlayback);
    const watchdog = window.setInterval(checkPlayback, 2_000);
    void connect();
    return () => {
      disposed = true;
      disconnect();
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', checkPlayback);
      window.clearInterval(watchdog);
    };
  }, [beginVideoPipeline, clearPreviewFrames, deliverPreviewDownload, disposeVideoPipeline, enqueueVideoChunk, fallbackToImagePreview, queuePreviewFrame, client]);

  useEffect(() => {
    // React Strict Mode mounts effects again after a simulated cleanup. Reset
    // this flag on every setup so the remounted preview continues accepting frames.
    framePipelineDisposedRef.current = false;
    return () => {
      framePipelineDisposedRef.current = true;
      frameGenerationRef.current += 1;
      frameDecodeActiveRef.current = false;
      if (frameObjectUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(frameObjectUrlRef.current);
      if (staleFrameObjectUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(staleFrameObjectUrlRef.current);
      if (decodingFrameObjectUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(decodingFrameObjectUrlRef.current);
      const pendingUrl = pendingFrameRef.current?.imageUrl;
      if (pendingUrl?.startsWith('blob:')) URL.revokeObjectURL(pendingUrl);
      frameObjectUrlRef.current = '';
      staleFrameObjectUrlRef.current = '';
      decodingFrameObjectUrlRef.current = '';
      pendingFrameRef.current = null;
      pendingMoveRef.current = null;
      pointerGestureRef.current = null;
      if (moveFlushTimerRef.current !== undefined) window.clearTimeout(moveFlushTimerRef.current);
      if (scrollFlushTimerRef.current !== undefined) window.clearTimeout(scrollFlushTimerRef.current);
      disposeVideoPipeline(false);
    };
  }, [disposeVideoPipeline]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!videoObjectUrl || !video) return undefined;
    let stopped = false;
    let callbackId = 0;
    let presentedFrames = 0;
    const markLive = () => {
      if (stopped) return;
      setStatus('live');
      setStreamError('');
    };
    const frameCallback = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (stopped) return;
      // Count frames presented by the compositor, not callbacks serviced by
      // React's main thread; callbacks can be delayed while the chat renders.
      frameCountersRef.current.displayed += Math.max(0, metadata.presentedFrames - presentedFrames);
      presentedFrames = metadata.presentedFrames;
      lastDisplayedAtRef.current = Date.now();
      previewInputReadyRef.current = true;
      markLive();
      callbackId = video.requestVideoFrameCallback(frameCallback);
    };
    video.addEventListener('playing', markLive);
    callbackId = video.requestVideoFrameCallback(frameCallback);
    void video.play().catch(() => undefined);
    return () => {
      stopped = true;
      video.removeEventListener('playing', markLive);
      if (callbackId) video.cancelVideoFrameCallback(callbackId);
    };
  }, [videoObjectUrl]);

  const postInput = useCallback((input: BrowserPreviewInput, reportError: boolean) => {
    const stream = streamRef.current;
    if (!stream || stream.readyState !== WebSocket.OPEN || (!previewInputReadyRef.current && input.kind !== 'tab' && input.kind !== 'browserControl')) {
      if (reportError) setInputError('实时界面正在重连，请稍后重试');
      return false;
    }
    stream.send(JSON.stringify({ event: input, type: 'input' }));
    return true;
  }, []);

  const sendInput = useCallback((input: BrowserPreviewInput) => {
    setInputError('');
    return postInput(input, true);
  }, [postInput]);

  const browserControl = useCallback((action: Extract<BrowserPreviewInput, { kind: 'browserControl' }>['action'], tabId?: string) => {
    setNativeControl(null);
    if (sendInput({ kind: 'browserControl', action, tabId })) {
      setAddressDraft(action === 'open' ? '' : null);
      if (action === 'open') window.requestAnimationFrame(() => addressInputRef.current?.focus());
      else previewStageRef.current?.focus();
    }
  }, [sendInput]);

  const navigateAddress = useCallback(() => {
    const raw = (addressDraft ?? frameStateRef.current.url).trim();
    if (!raw) return;
    try {
      const url = new URL(raw === 'about:blank' || /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!['http:', 'https:'].includes(url.protocol) && url.href !== 'about:blank') throw new Error('unsupported');
      if (sendInput({ kind: 'browserControl', action: 'navigate', url: url.href })) {
        setAddressDraft(null);
        addressInputRef.current?.blur();
        previewStageRef.current?.focus();
      }
    } catch { setInputError('请输入有效的 HTTP 或 HTTPS 地址'); }
  }, [addressDraft, sendInput]);

  const relativePoint = useCallback((clientX: number, clientY: number, element: HTMLElement, clamp = false) => {
    if (!frame?.imageUrl && !videoDisplayReady) return undefined;
    if (!frame) return undefined;
    const mediaRect = previewVideoRef.current?.getBoundingClientRect()
      || previewImageRef.current?.getBoundingClientRect()
      || element.getBoundingClientRect();
    if (!mediaRect.width || !mediaRect.height) return undefined;
    const sourceWidth = Math.max(1, frame.viewport.width);
    const sourceHeight = Math.max(1, frame.viewport.height);
    const sourceRatio = sourceWidth / sourceHeight;
    const mediaRatio = mediaRect.width / mediaRect.height;
    const contentWidth = mediaRatio > sourceRatio ? mediaRect.height * sourceRatio : mediaRect.width;
    const contentHeight = mediaRatio > sourceRatio ? mediaRect.height : mediaRect.width / sourceRatio;
    const rect = {
      bottom: mediaRect.top + (mediaRect.height + contentHeight) / 2,
      height: contentHeight,
      left: mediaRect.left + (mediaRect.width - contentWidth) / 2,
      right: mediaRect.left + (mediaRect.width + contentWidth) / 2,
      top: mediaRect.top + (mediaRect.height - contentHeight) / 2,
      width: contentWidth,
    };
    if (!clamp && (
      clientX < rect.left
      || clientX > rect.right
      || clientY < rect.top
      || clientY > rect.bottom
    )) return undefined;
    return {
      xRatio: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      yRatio: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }, [frame, videoDisplayReady]);

  const beginPreviewPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const point = relativePoint(event.clientX, event.clientY, event.currentTarget);
    if (!point) return;
    setNativeControl(null);
    event.currentTarget.focus();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerGestureRef.current = {
      button: event.button === 1 ? 'middle' : 'left',
      clickCount: Math.min(2, Math.max(1, event.detail || 1)),
      current: point,
      dragged: false,
      pointerId: event.pointerId,
      start: point,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
  }, [relativePoint]);

  const movePreviewPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture && event.pointerType === 'touch') return;
    const point = relativePoint(event.clientX, event.clientY, event.currentTarget, Boolean(gesture));
    if (!point) return;
    if (gesture && gesture.pointerId === event.pointerId) {
      gesture.current = point;
      if (Math.hypot(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY) >= 4) {
        gesture.dragged = true;
      }
      return;
    }
    pendingMoveRef.current = { kind: 'move', ...point };
    if (moveFlushTimerRef.current !== undefined) return;
    moveFlushTimerRef.current = window.setTimeout(() => {
      moveFlushTimerRef.current = undefined;
      const input = pendingMoveRef.current;
      pendingMoveRef.current = null;
      if (input) postInput(input, false);
    }, 16);
  }, [postInput, relativePoint]);

  const endPreviewPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = relativePoint(event.clientX, event.clientY, event.currentTarget, true) || gesture.current;
    pointerGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    if (gesture.dragged) {
      sendInput({
        kind: 'drag',
        ...gesture.start,
        toXRatio: point.xRatio,
        toYRatio: point.yRatio,
        button: gesture.button,
      });
      return;
    }
    sendInput({
      kind: 'click',
      ...point,
      button: gesture.button,
      clickCount: gesture.clickCount,
    });
  }, [relativePoint, sendInput]);

  const cancelPreviewPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerGestureRef.current?.pointerId !== event.pointerId) return;
    pointerGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  const openPreviewContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const point = relativePoint(event.clientX, event.clientY, event.currentTarget);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.focus();
    sendInput({ kind: 'click', ...point, button: 'right', clickCount: 1 });
  }, [relativePoint, sendInput]);

  const scrollPreview = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const point = relativePoint(event.clientX, event.clientY, event.currentTarget);
    if (!point) return;
    event.preventDefault();
    const current = pendingScrollRef.current;
    pendingScrollRef.current = {
      kind: 'scroll',
      ...point,
      deltaX: (current?.deltaX || 0) + event.deltaX,
      deltaY: (current?.deltaY || 0) + event.deltaY,
    };
    if (scrollFlushTimerRef.current !== undefined) return;
    scrollFlushTimerRef.current = window.setTimeout(() => {
      scrollFlushTimerRef.current = undefined;
      const input = pendingScrollRef.current;
      pendingScrollRef.current = null;
      if (input) sendInput(input);
    }, 16);
  }, [relativePoint, sendInput]);

  const pressPreviewKey = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') return;
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
    const command = event.ctrlKey || event.metaKey;
    const letter = event.key.toLowerCase();
    // Let the local browser dispatch paste, then relay its clipboard text once.
    if ((command && letter === 'v') || (event.shiftKey && event.key === 'Insert')) {
      event.stopPropagation();
      return;
    }
    if (command && ['c', 'x'].includes(letter)) {
      event.preventDefault(); event.stopPropagation();
      sendInput({ kind: 'clipboard', action: letter === 'x' ? 'cut' : 'copy' });
      return;
    }
    if (command && letter === 'l') {
      event.preventDefault(); event.stopPropagation();
      addressInputRef.current?.focus(); addressInputRef.current?.select();
      return;
    }
    if ((command && ['t', 'w', 'r'].includes(letter)) || event.key === 'F5'
      || (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key))) {
      event.preventDefault(); event.stopPropagation();
      const action = event.altKey ? (event.key === 'ArrowLeft' ? 'back' : 'forward')
        : letter === 't' ? 'open' : letter === 'w' ? 'close' : 'reload';
      browserControl(action, action === 'close' ? frameStateRef.current.tabs.find(tab => tab.active)?.id : undefined);
      return;
    }
    if (nativeControl && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setNativeControl(null);
      return;
    }
    const modifierShortcut = event.ctrlKey || event.metaKey || event.altKey;
    let key = event.key;
    if (modifierShortcut) {
      const parts = [
        event.ctrlKey ? 'Control' : '',
        event.metaKey ? 'Meta' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
        key,
      ].filter(Boolean);
      key = parts.join('+');
    } else if (event.shiftKey && key.length > 1) {
      key = `Shift+${key}`;
    } else if (key === ' ') {
      key = 'Space';
    }
    event.preventDefault();
    event.stopPropagation();
    sendInput({ kind: 'key', key });
  }, [browserControl, nativeControl, sendInput]);

  const pastePreviewText = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const text = event.clipboardData.getData('text');
    if (!text) return;
    event.preventDefault();
    sendInput({ kind: 'text', text });
  }, [sendInput]);

  const switchPreviewTab = useCallback((tabId: string) => {
    if (frameStateRef.current.tabs.some(tab => tab.id === tabId && tab.active)) return;
    setNativeControl(null);
    if (sendInput({ kind: 'tab', tabId })) {
      clearPreviewFrames(true);
      disposeVideoPipeline();
      setStatus('reconnecting');
    }
  }, [clearPreviewFrames, disposeVideoPipeline, sendInput]);

  const selectPreviewNativeOption = useCallback((value: string) => {
    if (!nativeControl || (nativeControl.kind !== 'select' && nativeControl.kind !== 'datalist')) return;
    setNativeControl(null);
    if (nativeControl.kind === 'select') {
      sendInput({
        kind: 'select',
        value,
        xRatio: nativeControl.targetXRatio,
        yRatio: nativeControl.targetYRatio,
      });
      return;
    }
    sendInput({
      controlKind: 'datalist',
      kind: 'controlValue',
      value,
      xRatio: nativeControl.targetXRatio,
      yRatio: nativeControl.targetYRatio,
    });
  }, [nativeControl, sendInput]);

  const applyPreviewNativePicker = useCallback(() => {
    if (nativeControl?.kind !== 'picker') return;
    setNativeControl(null);
    sendInput({
      controlKind: 'picker',
      kind: 'controlValue',
      value: nativePickerValue,
      xRatio: nativeControl.targetXRatio,
      yRatio: nativeControl.targetYRatio,
    });
  }, [nativeControl, nativePickerValue, sendInput]);

  const uploadPreviewNativeFiles = useCallback(async (files: FileList | null) => {
    if (nativeControl?.kind !== 'file' || !files?.length || nativeControlBusy) return;
    const selected = Array.from(files).slice(0, nativeControl.multiple ? 8 : 1);
    setNativeControlBusy(true);
    setInputError('');
    try {
      const uploaded: Array<{ mimeType: string; name: string; path: string }> = [];
      for (const file of selected) {
        uploaded.push(await client.uploadFile(file));
      }
      if (!uploaded.every((file) => file.path)) throw new Error('文件上传结果无效');
      if (!sendInput({ controlId: nativeControl.controlId, files: uploaded, kind: 'files' })) {
        setNativeControlBusy(false);
      }
    } catch (error) {
      setNativeControlBusy(false);
      setInputError(error instanceof Error ? error.message : '文件上传失败');
    } finally {
      if (previewFileInputRef.current) previewFileInputRef.current.value = '';
    }
  }, [nativeControl, nativeControlBusy, sendInput, client]);

  const respondPreviewNativeDialog = useCallback((accept: boolean) => {
    if (!nativeDialog) return;
    sendInput({
      accept,
      dialogId: nativeDialog.id,
      kind: 'dialog',
      ...(nativeDialog.dialogType === 'prompt' ? { promptText: nativeDialogPrompt } : {}),
    });
  }, [nativeDialog, nativeDialogPrompt, sendInput]);

  const statusLabelSource = status === 'live'
    ? '实时'
    : status === 'reconnecting'
      ? '正在重连'
      : status === 'unavailable'
        ? '浏览器未运行'
        : '正在连接';
  const statusLabel = t(statusLabelSource);
  const previewMetricsLabel = status === 'unavailable' ? t('未运行')
    : status !== 'live' ? statusLabel : previewMetrics ? `${previewMetrics.displayedFps.toFixed(1)} FPS` : '';
  const hasPreviewVisual = videoDisplayReady || Boolean(frame?.imageUrl);

  return (
    <FloatingWindow title={t('实时界面')} className="cap-browser-preview-modal" onClose={onClose}>
      <style>{browserPreviewStyles}</style>
      <div className="cap-browser-preview-chrome">
        <div className="cap-browser-preview-tabs" aria-label={t('浏览器标签页')}>
          <div className="cap-browser-preview-tab-list">
            {!frame?.tabs.length ? <span className="cap-browser-preview-empty-tab"><Globe size={13} aria-hidden="true" />{t('尚未打开网页')}</span> : null}
            {(frame?.tabs || []).map((tab) => (
              <div className={`cap-browser-preview-tab${tab.active ? ' active' : ''}`} key={tab.id}>
                <button aria-pressed={tab.active} className="cap-browser-preview-tab-select"
                  onClick={() => void switchPreviewTab(tab.id)} title={tab.url} type="button">
                  <Globe size={13} />
                  <span>{previewTabLabel(tab.url, t('新标签页'))}</span>
                </button>
                <button className="cap-browser-preview-tab-close" aria-label={t('关闭标签页')}
                  title={t('关闭标签页')} onClick={() => browserControl('close', tab.id)} type="button"><X size={13} /></button>
              </div>
            ))}
          </div>
          <button className="cap-browser-preview-icon-button" aria-label={t('新增标签页')} title={t('新增标签页')}
            onClick={() => browserControl('open')} type="button"><Plus size={16} /></button>
        </div>

        <header className="cap-browser-preview-header">
          <div className="cap-browser-preview-navigation">
            <button className="cap-browser-preview-icon-button" aria-label={t('后退')} title={t('后退')}
              disabled={status !== 'live'}
              onClick={() => browserControl('back')} type="button"><ArrowLeft size={16} /></button>
            <button className="cap-browser-preview-icon-button" aria-label={t('前进')} title={t('前进')}
              disabled={status !== 'live'}
              onClick={() => browserControl('forward')} type="button"><ArrowRight size={16} /></button>
            <button className="cap-browser-preview-icon-button" aria-label={t('刷新')} title={t('刷新')}
              disabled={status !== 'live'}
              onClick={() => browserControl('reload')} type="button"><RotateCw size={15} /></button>
          </div>
          <form className="cap-browser-preview-address" onSubmit={event => { event.preventDefault(); navigateAddress(); }}>
              <Globe aria-hidden="true" size={14} />
              <input aria-label={t('网页地址')} autoComplete="off" spellCheck={false} ref={addressInputRef}
                className="cap-browser-preview-url" placeholder={t('输入网址，按 Enter 打开')}
                value={addressDraft ?? frame?.url ?? ''} onChange={event => setAddressDraft(event.target.value)}
                onFocus={event => { setAddressDraft(event.target.value); event.target.select(); }}
                onBlur={() => setAddressDraft(null)}
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.key === 'Escape') { setAddressDraft(null); event.currentTarget.blur(); previewStageRef.current?.focus(); }
                }} />
              <kbd className="cap-browser-preview-address-hint" aria-hidden="true">↵</kbd>
          </form>
          <span className="cap-browser-preview-metrics" data-status={status} title={statusLabel} role="status">
            {status === 'connecting' || status === 'reconnecting'
              ? <Loader2 className="cap-browser-preview-connection-spinner" size={11} aria-hidden="true" />
              : <i aria-hidden="true" />}
            <span>{previewMetricsLabel || statusLabel}</span>
          </span>

        </header>
      </div>

        <div className="cap-browser-preview-body">
          <div
            aria-label={t('可操作的浏览器实时画面')}
            className={hasPreviewVisual ? 'cap-browser-preview-stage has-frame' : 'cap-browser-preview-stage'}
            onContextMenu={openPreviewContextMenu}
            onKeyDown={pressPreviewKey}
            onPaste={pastePreviewText}
            onPointerCancel={cancelPreviewPointer}
            onPointerDown={beginPreviewPointer}
            onPointerMove={movePreviewPointer}
            onPointerUp={endPreviewPointer}
            onWheel={scrollPreview}
            ref={previewStageRef}
            role="application"
            tabIndex={0}
          >
            {frame?.imageUrl && !videoDisplayReady ? (
              <img
                alt={t('浏览器实时画面')}
                draggable={false}
                height={frame.viewport.height}
                ref={previewImageRef}
                src={frame.imageUrl}
                width={frame.viewport.width}
              />
            ) : null}
            {videoObjectUrl ? (
              <video
                autoPlay
                className={videoDisplayReady ? 'is-ready' : 'is-loading'}
                disablePictureInPicture
                height={frame?.viewport.height || 720}
                muted
                onLoadedData={() => {
                  setVideoDisplayReady(true);
                  setStatus('live');
                  setStreamError('');
                }}
                playsInline
                ref={previewVideoRef}
                src={videoObjectUrl}
                width={frame?.viewport.width || 1280}
              />
            ) : null}
            {nativeControl?.kind === 'file' ? (
              <input
                accept={nativeControl.accept || undefined}
                capture={nativeControl.capture === 'environment' || nativeControl.capture === 'user'
                  ? nativeControl.capture
                  : nativeControl.capture ? true : undefined}
                className="cap-browser-preview-native-file-input"
                multiple={nativeControl.multiple}
                onChange={(event) => void uploadPreviewNativeFiles(event.target.files)}
                ref={previewFileInputRef}
                type="file"
              />
            ) : null}
            {nativeControl && nativeControl.kind !== 'file' && nativeControlPosition ? (
              <div
                aria-label={nativeControl.label}
                className={`cap-browser-preview-native-select is-${nativeControl.kind}`}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                role={nativeControl.kind === 'select' || nativeControl.kind === 'datalist' ? 'listbox' : 'dialog'}
                style={nativeControlPosition}
              >
                {nativeControl.kind === 'select' || nativeControl.kind === 'datalist' ? (
                  nativeControl.options.map((option, index) => {
                    const selected = nativeControl.kind === 'select'
                      ? option.value === nativeControl.selectedValue
                      : option.value === nativeControl.value;
                    const disabled = 'disabled' in option ? option.disabled : false;
                    const group = 'group' in option ? option.group : undefined;
                    return (
                      <button
                        aria-selected={selected}
                        className={selected ? 'is-selected' : undefined}
                        disabled={disabled}
                        key={`${option.value}:${index}`}
                        onClick={() => selectPreviewNativeOption(option.value)}
                        role="option"
                        type="button"
                      >
                        <span>{option.label}</span>
                        {group ? <small>{group}</small> : null}
                        {selected ? <Check size={15} /> : null}
                      </button>
                    );
                  })
                ) : null}
                {nativeControl.kind === 'picker' ? (
                  <div className="cap-browser-preview-native-control-form">
                    <strong>{nativeControl.label}</strong>
                    <input
                      autoFocus
                      max={nativeControl.max}
                      min={nativeControl.min}
                      onChange={(event) => setNativePickerValue(event.target.value)}
                      step={nativeControl.step}
                      type={nativeControl.inputType}
                      value={nativePickerValue}
                    />
                    <div className="cap-browser-preview-native-control-actions">
                      <button onClick={() => setNativeControl(null)} type="button">{t('取消')}</button>
                      <button className="is-primary" onClick={applyPreviewNativePicker} type="button">{t('应用')}</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {nativeDialog ? (
              <div
                className="cap-browser-preview-native-dialog-backdrop"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    respondPreviewNativeDialog(false);
                  }
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <section aria-labelledby={nativeDialogTitleId} aria-modal="true" role="dialog">
                  <strong id={nativeDialogTitleId}>
                    {nativeDialog.dialogType === 'prompt' ? t('请输入内容') : t('浏览器提示')}
                  </strong>
                  <p>{nativeDialog.message}</p>
                  {nativeDialog.dialogType === 'prompt' ? (
                    <input
                      autoFocus
                      onChange={(event) => setNativeDialogPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') respondPreviewNativeDialog(true);
                      }}
                      value={nativeDialogPrompt}
                    />
                  ) : null}
                  <div className="cap-browser-preview-native-dialog-actions">
                    {nativeDialog.dialogType !== 'alert' ? (
                      <button onClick={() => respondPreviewNativeDialog(false)} type="button">
                        {nativeDialog.dialogType === 'beforeunload' ? t('留在此页') : t('取消')}
                      </button>
                    ) : null}
                    <button className="is-primary" onClick={() => respondPreviewNativeDialog(true)} type="button">
                      {nativeDialog.dialogType === 'beforeunload' ? t('离开页面') : t('确定')}
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
            {!hasPreviewVisual ? (
              <div className="cap-browser-preview-empty">
                <Loader2 className="spin" size={22} />
                <strong>{streamError ? t(streamError) : t('正在等待浏览器画面')}</strong>
                <span>{t('输入网址或点击“新增标签页”启动浏览器，也可以让 AI 打开网页。')}</span>
              </div>
            ) : null}
          </div>
          {streamError && hasPreviewVisual ? <div className="cap-browser-preview-alert">{t(streamError)}</div> : null}
          {inputError ? <div className="cap-browser-preview-alert">{t(inputError)}</div> : null}
          {previewDownload ? (
            <div className="cap-browser-preview-download-notice" role="status">
              {previewDownload.status === 'preparing' ? <Loader2 className="spin" size={14} /> : <Download size={14} />}
              <span>{t(previewDownload.status === 'preparing'
                ? '正在识别下载文件'
                : previewDownload.delivery === 'started' ? '已开始下载' : '检测到下载文件')}：{previewDownload.fileName}</span>
              {previewDownload.status === 'ready' ? (
                <button
                  onClick={() => void deliverPreviewDownload(previewDownload, { repeat: true, userInitiated: true })}
                  type="button"
                >{t(previewDownload.delivery === 'started' ? '重新下载' : '下载到本机')}</button>
              ) : null}
              <button
                aria-label={t("关闭下载提示")}
                className="cap-browser-preview-download-dismiss"
                onClick={() => setPreviewDownload(null)}
                type="button"
              ><X size={13} /></button>
            </div>
          ) : null}
        </div>

    </FloatingWindow>
  );
}

