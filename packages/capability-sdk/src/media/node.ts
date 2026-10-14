import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readManagedRuntime } from '../runtime.ts';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import { runCapabilityProcess } from '../node.ts';
import { createMediaCapability, mediaToolInput, type MediaArtifact, type MediaOperations } from './index.ts';
import type { CapabilityExecutionContext, CapabilityRunContext } from '../index.ts';
import { createRemotionVideoComposer } from './remotion-renderer.ts';

function run(executable: string, args: string[], timeoutMs: number, context: CapabilityExecutionContext) {
  return runCapabilityProcess({ executable, args, timeoutMs, signal: context.abortSignal, maxOutputChars: 100_000 });
}

function probeDurationSeconds(probe: unknown): number | undefined {
  const match = typeof probe === 'string' ? probe.match(/Duration:\s*(\d+):(\d+):([\d.]+)/) : undefined;
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    : Number((probe as { format?: { duration?: unknown } } | undefined)?.format?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}
export function createFfmpegMediaOperations(input: {
  ffmpegPath?: string; ffprobePath?: string;
  resolveSource(sourceRef: string, context: CapabilityExecutionContext): Promise<string>;
  publishArtifact(filePath: string, context: CapabilityExecutionContext): Promise<MediaArtifact>;
  timeoutMs?: number; ocr?: MediaOperations['ocr']; transcribe?: MediaOperations['transcribe'];
}): MediaOperations {
  const ffmpegPath = input.ffmpegPath || process.env.FFMPEG_PATH || readManagedRuntime()?.ffmpeg || ffmpegStatic || '';
  const operations: MediaOperations = {
    videoRenderer: 'ffmpeg',
    videoCompositionCapabilities: { motions: ['none'], captions: false, renderTimeoutMs: input.timeoutMs || 120_000 },
    async composeVideo(request, context) {
      // Validate direct SDK calls as well as tool invocations before allocating work.
      mediaToolInput.parse({ action: 'composeVideo', reason: 'Compose image scenes', ...request });
      if (request.scenes.some(scene => scene.caption || scene.motion && scene.motion !== 'none')) {
        throw new Error('The FFmpeg composer does not support captions or camera motion. Use a provider advertising those features, such as createRemotionMediaOperations; no video was rendered.');
      }
      context.abortSignal?.throwIfAborted();
      const [width, height] = (request.size || '1280x720').split('x').map(Number);
      const directory = await mkdtemp(path.join(os.tmpdir(), 'webpilot-video-'));
      const deadline = Date.now() + (input.timeoutMs || 120_000);
      const remaining = () => {
        context.abortSignal?.throwIfAborted();
        const milliseconds = deadline - Date.now();
        if (milliseconds <= 0) throw new Error('Video composition timed out. Use fewer scenes, shorter durations or a smaller size.');
        return milliseconds;
      };
      try {
        const clips: string[] = [];
        let totalFrames = 0;
        for (let index = 0; index < request.scenes.length; index++) {
          remaining();
          const scene = request.scenes[index];
          const source = await input.resolveSource(scene.sourceRef, context);
          const sceneArgs = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
          let hasAudio = false;
          if (scene.kind === 'video') {
            const headers = await run(ffmpegPath, ['-hide_banner', '-nostdin', '-i', source, '-t', '0', '-f', 'null', '-'], remaining(), context);
            hasAudio = /Audio:/.test(headers.stderr) && scene.muted !== true;
            const match = headers.stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
            const sourceDuration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : undefined;
            if (sourceDuration !== undefined && (scene.trimStart || 0) + scene.duration > sourceDuration + 0.05) throw new Error(`Scene ${index + 1} extends beyond its source video. Reduce the trim start or duration.`);
            sceneArgs.push('-ss', String(scene.trimStart || 0), '-i', source);
          } else {
            if ((await stat(source)).size > 50 * 1024 * 1024) throw new Error('A scene image must not exceed 50 MB.');
            const image = path.join(directory, `image-${index}.png`);
            await sharp(source, { limitInputPixels: 40_000_000, animated: false }).rotate()
              .resize(width, height, { fit: 'contain', background: '#000000' }).flatten({ background: '#000000' }).png().toFile(image);
            sceneArgs.push('-loop', '1', '-framerate', '30', '-i', image);
          }
          // Intermediate PCM avoids accumulating AAC encoder priming at every cut.
          const clip = `scene-${index}.mov`;
          const frames = Math.max(3, Math.round(scene.duration * 30));
          totalFrames += frames;
          sceneArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0',
            '-t', String(frames / 30), '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,
            '-af', 'apad', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '20',
            '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-threads', '2', path.join(directory, clip));
          await run(ffmpegPath, sceneArgs, remaining(), context);
          clips.push(clip);
          await context.reportProgress?.({ phase: 'composeVideo', message: `已合成分镜 ${index + 1}/${request.scenes.length}`, current: index + 1, total: request.scenes.length });
        }
        const playlist = path.join(directory, 'scenes.txt');
        // Only generated basenames enter the concat file; source paths never become FFmpeg directives.
        await writeFile(playlist, clips.map((name) => `file '${name}'`).join('\n'), { signal: context.abortSignal });
        const output = path.join(directory, 'storyboard.mp4');
        const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '1', '-i', playlist];
        if (request.audioRef) {
          const audioFilters = [request.audioDuration ? `atrim=duration=${request.audioDuration}` : '', 'asetpts=PTS-STARTPTS',
            `volume=${request.audioVolume ?? 1}`, `adelay=${Math.round((request.audioOffset || 0) * 1000)}:all=1`, 'apad'].filter(Boolean).join(',');
          args.push('-ss', String(request.audioTrimStart || 0), '-i', await input.resolveSource(request.audioRef, context), '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'copy', '-c:a', 'aac', '-af', audioFilters);
        } else args.push('-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac');
        args.push('-ar', '48000', '-ac', '2', '-t', String(totalFrames / 30), '-movflags', '+faststart', output);
        await run(ffmpegPath, args, remaining(), context);
        context.abortSignal?.throwIfAborted();
        const artifact = await input.publishArtifact(output, context);
        return [{ ...artifact, mediaType: 'video/mp4', description: `Composed video: ${request.scenes.length} scenes, ${totalFrames / 30}s, ${width}x${height}, 30fps.${request.audioRef ? ' The edited narration replaces original audio and is padded or trimmed to the video duration.' : ' Original clip audio is preserved unless muted.'}` }];
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async inspect(sourceRef, context) {
      context.abortSignal?.throwIfAborted();
      const source = await input.resolveSource(sourceRef, context);
      // Image formats supported by composition (including SVG) need no FFmpeg decoder.
      const image = await sharp(source, { limitInputPixels: 40_000_000, animated: false }).metadata().catch(() => undefined);
      if (image?.width && image.height) {
        return { sourceRef, inspected: true, probe: { format: image.format, width: image.width, height: image.height,
          channels: image.channels, pages: image.pages, hasAlpha: image.hasAlpha, orientation: image.orientation } };
      }
      if (input.ffprobePath) {
        const result = await run(input.ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', source], Math.min(input.timeoutMs || 15_000, 15_000), context);
        const probe = JSON.parse(result.stdout.split(source).join(sourceRef)) as unknown;
        return { sourceRef, inspected: true, probe };
      }
      // Zero output duration reads stream headers without decoding the entire recording.
      const result = await run(ffmpegPath, ['-hide_banner', '-nostdin', '-i', source, '-t', '0', '-f', 'null', '-'],
        Math.min(input.timeoutMs || 15_000, 15_000), context);
      return { sourceRef, inspected: true, probe: result.stderr.split(source).join(sourceRef).slice(0, 20_000) };
    },
    async extractFrames(request, context) {
      mediaToolInput.parse({ action: 'extractFrames', reason: 'Extract source frames', ...request });
      context.abortSignal?.throwIfAborted();
      const deadline = Date.now() + (input.timeoutMs || 120_000);
      const timeout = AbortSignal.timeout(input.timeoutMs || 120_000);
      const execution = { ...context, abortSignal: context.abortSignal ? AbortSignal.any([context.abortSignal, timeout]) : timeout };
      const remaining = () => {
        execution.abortSignal.throwIfAborted();
        const milliseconds = deadline - Date.now();
        if (milliseconds <= 0) throw new Error('Frame extraction timed out.');
        return milliseconds;
      };
      const source = await input.resolveSource(request.sourceRef, execution);
      const inspection = await operations.inspect(request.sourceRef, execution) as { probe?: unknown };
      remaining();
      const imageProbe = inspection.probe as { width?: number; height?: number; pages?: number } | undefined;
      const stillImage = Boolean(imageProbe?.width && imageProbe.height && (imageProbe.pages || 1) === 1);
      const streams = (inspection.probe as { streams?: Array<{ codec_type?: string }> } | undefined)?.streams;
      const hasVideo = typeof inspection.probe === 'string' ? /Stream[^\r\n]*Video:/.test(inspection.probe)
        : Array.isArray(streams) ? streams.some(stream => stream.codec_type === 'video') : undefined;
      if (!stillImage && hasVideo === false) throw new Error('The source has no video stream. Frame extraction requires a video or a still image.');
      const duration = probeDurationSeconds(inspection.probe);
      const start = request.startSeconds || 0;
      if (stillImage && (start > 0 || request.endSeconds !== undefined)) throw new Error('Time ranges require a video source.');
      if (duration !== undefined && start >= duration) throw new Error('Frame extraction starts beyond the source duration.');
      if (duration !== undefined && request.endSeconds !== undefined && request.endSeconds > duration + 0.05) {
        throw new Error('Frame extraction ends beyond the source duration.');
      }
      const end = request.endSeconds ?? duration;
      const interval = request.intervalSeconds ?? (end !== undefined ? (end - start) / request.maxFrames : undefined);
      const directory = await mkdtemp(path.join(os.tmpdir(), 'webpilot-media-'));
      try {
        const pattern = path.join(directory, 'frame-%04d.jpg');
        let timestamps: number[];
        if (stillImage) {
          await sharp(source, { limitInputPixels: 40_000_000, animated: false }).rotate().jpeg().toFile(path.join(directory, 'frame-0001.jpg'));
          timestamps = [0];
        } else {
          // Select real source frames, including the first frame. fps can produce
          // no output for a long interval, and thumbnail(N) only covers the opening N frames.
          const filter = interval !== undefined
            ? `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${interval})',showinfo`
            : `thumbnail=${request.maxFrames},showinfo`;
          const result = await run(ffmpegPath, ['-hide_banner', '-nostdin', '-nostats',
            ...(start > 0 ? ['-ss', String(start)] : []), '-i', source,
            ...(end !== undefined ? ['-t', String(end - start)] : []),
            '-map', '0:v:0', '-an', '-vf', filter, '-fps_mode', 'vfr', '-frames:v', String(request.maxFrames), '-q:v', '2', pattern], remaining(), execution);
          timestamps = [...result.stderr.matchAll(/\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:([-\d.e+]+)/g)]
            .map(match => Math.round((start + Number(match[1])) * 1_000_000) / 1_000_000);
        }
        remaining();
        const files = (await readdir(directory)).filter((name) => name.endsWith('.jpg')).sort().slice(0, request.maxFrames);
        if (!files.length) throw new Error('No video frames were found in the requested source range.');
        if (timestamps.length < files.length || timestamps.slice(0, files.length).some(time => !Number.isFinite(time))) {
          throw new Error('Frame timestamps could not be verified.');
        }
        const artifacts: MediaArtifact[] = [];
        for (const [index, name] of files.entries()) {
          remaining();
          artifacts.push({ ...await input.publishArtifact(path.join(directory, name), execution),
            sourceRef: request.sourceRef, timestampSeconds: timestamps[index], description: `Source frame at ${timestamps[index]} seconds.` });
        }
        remaining();
        return artifacts;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    ocr: input.ocr, transcribe: input.transcribe,
    async health() { return ffmpegPath ? { status: 'healthy' } : { status: 'needs-runtime', message: 'FFmpeg runtime is missing. Run capability-runtime install.' }; },
  };
  return operations;
}
export function createNodeMediaCapability(input: { createOperations(context: CapabilityRunContext): MediaOperations | Promise<MediaOperations> }) { return createMediaCapability(input); }

/** Remotion owns video composition; FFmpeg remains available for inspection and extraction. */
export function createRemotionMediaOperations(input: Parameters<typeof createFfmpegMediaOperations>[0] & { renderTimeoutMs?: number; browserExecutable?: string }): MediaOperations {
  const operations = createFfmpegMediaOperations(input);
  return { ...operations, videoRenderer: 'remotion',
    videoCompositionCapabilities: { motions: ['none', 'zoomIn', 'zoomOut', 'panLeft', 'panRight'], captions: true,
      renderTimeoutMs: input.renderTimeoutMs || 900_000 },
    composeVideo: createRemotionVideoComposer({
    resolveSource: input.resolveSource, publishArtifact: input.publishArtifact, inspect: operations.inspect,
    timeoutMs: input.renderTimeoutMs, browserExecutable: input.browserExecutable,
  }) };
}
