import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { bundle } from '@remotion/bundler';
import { makeCancelSignal, openBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { chromium } from 'patchright';
import { mediaToolInput, type MediaArtifact, type MediaOperations } from './index.ts';
import { videoCompositionMetadata } from './video-composition.tsx';
import { readManagedRuntime } from '../runtime.ts';
import type { CapabilityExecutionContext } from '../index.ts';

type Options = {
  resolveSource(sourceRef: string, context: CapabilityExecutionContext): Promise<string>;
  publishArtifact(filePath: string, context: CapabilityExecutionContext): Promise<MediaArtifact>;
  inspect?: MediaOperations['inspect'];
  timeoutMs?: number;
  browserExecutable?: string;
  compositionPath?: string;
};

function compositionPath() {
  const hostRequire = process.getBuiltinModule('module').createRequire(path.join(process.cwd(), 'package.json'));
  const candidates = [
    path.join(process.cwd(), 'packages/capability-sdk/src/media/video-composition.tsx'),
    path.join(process.cwd(), 'dist-backend/packages/capability-sdk/src/media/video-composition.js'),
  ];
  try { candidates.push(hostRequire.resolve('@cjfclonedeep/capability-sdk/media/video-composition')); } catch { /* Source checkout. */ }
  const found = candidates.find(file => existsSync(file));
  if (!found) throw new Error('Remotion composition is missing from the media package.');
  return found;
}

export function createRemotionVideoComposer(options: Options): NonNullable<MediaOperations['composeVideo']> {
  return async (request, context) => {
    mediaToolInput.parse({ ...request, action: 'composeVideo', reason: 'Render video with Remotion' });
    context.abortSignal?.throwIfAborted();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'webpilot-remotion-'));
    const controller = new AbortController();
    const signal = context.abortSignal ? AbortSignal.any([controller.signal, context.abortSignal]) : controller.signal;
    const execution = { ...context, abortSignal: signal };
    const { cancel, cancelSignal } = makeCancelSignal();
    const timeout = setTimeout(() => controller.abort(new Error('Remotion video render timed out. Reduce the resolution or increase the media render timeout.')), options.timeoutMs || 900_000);
    const stop = () => cancel();
    signal.addEventListener('abort', stop, { once: true });
    let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
    const report = async (message: string, current?: number, total?: number) => {
      signal.throwIfAborted();
      await context.reportProgress?.({ phase: 'composeVideo', message, current, total });
    };
    try {
      const publicDir = path.join(directory, 'public');
      await mkdir(publicDir);
      const assets = new Map<string, string>();
      const asset = async (ref: string) => {
        if (assets.has(ref)) return assets.get(ref)!;
        signal.throwIfAborted();
        const source = await options.resolveSource(ref, execution);
        const info = await stat(source);
        if (!info.isFile() || info.size > 512 * 1024 * 1024) throw new Error('A video source must be a file no larger than 512 MB.');
        const extension = path.extname(source).toLowerCase();
        if (!/^\.[a-z0-9]{1,10}$/.test(extension)) throw new Error('Invalid video asset extension.');
        const name = `asset-${assets.size}${extension}`;
        await copyFile(source, path.join(publicDir, name));
        signal.throwIfAborted();
        assets.set(ref, name);
        return name;
      };
      const scenes = [];
      for (const scene of request.scenes) {
        if (scene.kind === 'video' && options.inspect) {
          const result = await options.inspect(scene.sourceRef, execution) as { probe?: unknown };
          const probe = result.probe;
          const match = typeof probe === 'string' ? probe.match(/Duration:\s*(\d+):(\d+):([\d.]+)/) : undefined;
          const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
            : Number((probe as { format?: { duration?: string } } | undefined)?.format?.duration);
          if (Number.isFinite(duration) && (scene.trimStart || 0) + scene.duration > duration + 0.05) throw new Error('A scene extends beyond its source video. Reduce trimStart or duration.');
        }
        scenes.push({ ...scene, sourceRef: await asset(scene.sourceRef) });
        await report(`正在准备 Remotion 素材 ${scenes.length}/${request.scenes.length}`, scenes.length, request.scenes.length);
      }
      const inputProps = { ...request, scenes, ...(request.audioRef ? { audioRef: await asset(request.audioRef) } : {}) };
      const entryPoint = path.join(directory, 'entry.jsx');
      await writeFile(entryPoint, `import React from 'react';
import {registerRoot, Composition, staticFile} from 'remotion';
import {MediaVideoComposition, videoCompositionMetadata} from ${JSON.stringify((options.compositionPath || compositionPath()).split(path.sep).join('/'))};
const props = ${JSON.stringify(inputProps)};
const Video = (input) => React.createElement(MediaVideoComposition, {...input, scenes: input.scenes.map(scene => ({...scene, sourceRef: staticFile(scene.sourceRef)})), audioRef: input.audioRef ? staticFile(input.audioRef) : undefined});
registerRoot(() => React.createElement(Composition, {id: 'MediaVideo', component: Video, ...videoCompositionMetadata(props), defaultProps: props}));
`, { signal });
      await report('正在准备 Remotion 渲染器');
      const hostRequire = process.getBuiltinModule('module').createRequire(path.join(process.cwd(), 'package.json'));
      const serveUrl = await bundle({ entryPoint, outDir: path.join(directory, 'bundle'), publicDir, enableCaching: false,
        webpackOverride: config => ({ ...config, resolve: { ...config.resolve, modules: [path.join(process.cwd(), 'node_modules'), ...(config.resolve?.modules || [])],
          alias: { ...config.resolve?.alias, react: path.dirname(hostRequire.resolve('react/package.json')), 'react-dom': path.dirname(hostRequire.resolve('react-dom/package.json')), remotion: path.dirname(hostRequire.resolve('remotion/package.json')) } } }) });
      signal.throwIfAborted();
      const executable = [options.browserExecutable, process.env.REMOTION_BROWSER_EXECUTABLE, readManagedRuntime()?.chromium, chromium.executablePath()].find(file => file && existsSync(file));
      browser = await openBrowser('chrome', { browserExecutable: executable, logLevel: 'error' });
      const closeOnAbort = () => { void browser?.close({ silent: true }).catch(() => undefined); };
      signal.addEventListener('abort', closeOnAbort, { once: true });
      try {
        signal.throwIfAborted();
        const composition = await selectComposition({ serveUrl, id: 'MediaVideo', inputProps, puppeteerInstance: browser, logLevel: 'error' });
        const output = path.join(directory, 'video.mp4');
        let lastProgress = 0;
        await report('Remotion 正在渲染视频', 0, composition.durationInFrames);
        await renderMedia({ serveUrl, composition, inputProps, outputLocation: output, codec: 'h264', audioCodec: 'aac',
          pixelFormat: 'yuv420p', concurrency: 2, x264Preset: 'veryfast', crf: 20, puppeteerInstance: browser, cancelSignal,
          logLevel: 'error', enforceAudioTrack: true,
          onProgress: progress => {
            if (Date.now() - lastProgress < 1000 || signal.aborted) return;
            lastProgress = Date.now();
            void report(`Remotion 渲染中 ${Math.round(progress.progress * 100)}%`, progress.renderedFrames, composition.durationInFrames).catch(() => undefined);
          } });
        signal.throwIfAborted();
        await report('Remotion 渲染完成，正在保存视频');
        const artifact = await options.publishArtifact(output, execution);
        const metadata = videoCompositionMetadata(request);
        return [{ ...artifact, mediaType: 'video/mp4', description: `Remotion rendered MP4: ${request.scenes.length} scenes, ${metadata.durationInFrames / metadata.fps}s, ${metadata.width}x${metadata.height}, 30fps. ${request.audioRef ? 'Narration synchronized to the timeline.' : 'No narration supplied; original clip audio retained unless muted.'}` }];
      } finally { signal.removeEventListener('abort', closeOnAbort); }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', stop);
      await browser?.close({ silent: true }).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  };
}
