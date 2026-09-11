import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ImageModel } from 'ai';
import { z } from 'zod';
import type { MediaModelConfig } from './models.ts';

export type CodexImageOptions = { codexPath?: string };

const completedImage = z.object({
  method: z.literal('item/completed'),
  params: z.object({ item: z.object({
    type: z.literal('imageGeneration'), id: z.string(), status: z.string(),
    result: z.string(), savedPath: z.string().optional(),
  }) }),
});
const maxImageBytes = 50 * 1024 * 1024;

function isImage(bytes: Uint8Array) {
  const data = Buffer.from(bytes);
  return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    || (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP');
}

async function imageBytes(item: z.infer<typeof completedImage>['params']['item'], directory: string, signal: AbortSignal) {
  const base64 = item.result.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  if (base64 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    if (base64.length > Math.ceil(maxImageBytes / 3) * 4) throw new Error('Codex image exceeds 50 MB.');
    const bytes = Buffer.from(base64, 'base64');
    if (isImage(bytes)) return bytes;
  }
  if (item.savedPath) {
    const file = await realpath(path.resolve(directory, item.savedPath));
    // Native imageGeneration items can point into CODEX_HOME/generated_images.
    const roots = await Promise.all([directory, path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images')]
      .map((root) => realpath(root).catch(() => undefined)));
    const inside = roots.some((root) => {
      if (!root) return false;
      const relative = path.relative(root, file);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if (!inside) throw new Error('Codex image output is outside its generation directories.');
    if ((await stat(file)).size > maxImageBytes) throw new Error('Codex image exceeds 50 MB.');
    const bytes = await readFile(file, { signal });
    if (!isImage(bytes)) throw new Error('Codex output is not a PNG, JPEG, or WebP image.');
    return bytes;
  }
  throw new Error('Codex returned no valid image data.');
}

/** Expose Codex's native image tool through the shared AI SDK image contract. */
export function createCodexImageModel(model: MediaModelConfig, options: CodexImageOptions = {}): ImageModel {
  return {
    specificationVersion: 'v4', provider: 'codex.image', modelId: model.model, maxImagesPerCall: 1,
    async doGenerate({ prompt, size, aspectRatio, files, mask, abortSignal }) {
      // Codex's native tool has reference-image editing but no mask parameter.
      if (mask) throw new Error('Codex CLI 图片生成不支持蒙版，请选择支持蒙版的图片模型。');
      const signal = abortSignal || AbortSignal.timeout(model.timeoutMs);
      signal.throwIfAborted();
      const { createCodexAppServer } = await import('ai-sdk-provider-codex-cli');
      const directory = await mkdtemp(path.join(os.tmpdir(), 'webpilot-codex-image-'));
      const provider = createCodexAppServer({ defaultSettings: {
        codexPath: options.codexPath, cwd: directory,
        approvalPolicy: 'never', sandboxPolicy: 'workspace-write',
        threadMode: 'stateless', minCodexVersion: '0.142.0',
        requestTimeoutMs: Math.min(model.timeoutMs, 30_000), logger: false,
        baseInstructions: 'You generate and edit images. Use the native image generation tool to produce exactly one image per request. Use attached images as references. Do not use shell commands, code, browser, MCP, or other agents. Save generated images in the current working directory. If image generation is unavailable or fails, explain the failure and stop. Never fabricate an image or substitute text for it.',
        configOverrides: {
          'features.image_generation': true,
          'features.shell_tool': false,
          'features.multi_agent': false,
          'features.apps': false,
          web_search: 'disabled',
        },
      } });
      const closeOnAbort = () => { void provider.close().catch(() => {}); };
      signal.addEventListener('abort', closeOnAbort, { once: true });
      let failed = false;
      try {
        signal.throwIfAborted();
        let modelId = model.model;
        if (modelId === 'default') {
          const available = await provider.listModels();
          const selected = available.defaultModel || available.models.find((item) => item.isDefault);
          modelId = selected?.model || selected?.id || '';
          if (!modelId) throw new Error('Codex CLI 未提供默认模型。请检查本机 Codex 登录状态。');
        }
        signal.throwIfAborted();
        const instruction = [prompt || '', size ? `Requested image dimensions: ${size}.` : '', aspectRatio ? `Requested aspect ratio: ${aspectRatio}.` : ''].filter(Boolean).join('\n');
        const result = await provider(modelId).doStream({
          prompt: [{ role: 'user', content: [
            { type: 'text', text: instruction },
            ...(files || []).map((file) => ({
              type: 'file' as const,
              mediaType: file.type === 'url' ? 'image/png' : file.mediaType,
              data: file.type === 'url' ? { type: 'url' as const, url: new URL(file.url) } : { type: 'data' as const, data: file.data },
            })),
          ] }],
          includeRawChunks: true, abortSignal: signal,
        });
        const reader = result.stream.getReader();
        const images = new Map<string, Uint8Array>();
        let explanation = '';
        try {
          while (true) {
            signal.throwIfAborted();
            const next = await reader.read();
            if (next.done) break;
            const part = next.value;
            if (part.type === 'error') throw part.error;
            if (part.type === 'text-delta') explanation = (explanation + part.delta).slice(-2_000);
            if (part.type !== 'raw') continue;
            const parsed = completedImage.safeParse(part.rawValue);
            if (!parsed.success) continue;
            const item = parsed.data.params.item;
            if (item.status !== 'completed') throw new Error(`Codex image generation ${item.status}.`);
            if (!images.has(item.id)) images.set(item.id, await imageBytes(item, directory, signal));
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        signal.throwIfAborted();
        if (!images.size) throw new Error(`Codex CLI 未返回生成图片。请确认本机已登录且账号支持图片生成。${explanation ? `\n${explanation}` : ''}`);
        if (images.size !== 1) throw new Error(`Codex CLI returned ${images.size} images for a single-image request.`);
        return { images: [...images.values()], warnings: [], response: { timestamp: new Date(), modelId, headers: undefined } };
      } catch (error) {
        failed = true;
        if (signal.aborted) throw signal.reason;
        throw error;
      } finally {
        signal.removeEventListener('abort', closeOnAbort);
        try {
          try { await provider.close(); } finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
        } catch (error) { if (!failed) throw error; }
      }
    },
  };
}
