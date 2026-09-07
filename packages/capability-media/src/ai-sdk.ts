import { createDownload, generateImage, generateSpeech, experimental_generateVideo as generateVideo, type ImageModel } from 'ai';
import { z } from 'zod';
import type { CapabilityExecutionContext } from '@webpilot/capability-sdk';
import type { MediaArtifact } from './index.js';
import type { MediaGenerationInput, MediaGenerationOperations } from './generation.js';
import { mediaModelDriver, resolveMediaModel, type MediaModelConfig, type MediaModelConfiguration, type MediaModelKind } from './models.js';

export type MediaGenerationFile = { data: Uint8Array; mediaType: string };
export type AiSdkMediaOperationsOptions = {
  configuration: MediaModelConfiguration;
  /** Explicit host selections take precedence over modelRef supplied by an agent. */
  selectedModels?: Partial<Record<MediaModelKind, string>>;
  readSource(ref: string, context: CapabilityExecutionContext): Promise<Uint8Array>;
  publishArtifact(file: MediaGenerationFile & { kind: MediaModelKind; modelRef: string }, context: CapabilityExecutionContext): Promise<MediaArtifact>;
  fetch?: typeof globalThis.fetch;
};

function parameters(model: MediaModelConfig) {
  return Object.fromEntries(model.parameters.filter((item) => item.key).map(({ key, value }) => {
    try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
  }));
}

function routeUrl(url: URL, model: MediaModelConfig, method: string) {
  const driver = mediaModelDriver(model.driver);
  const base = new URL((model.baseURL || driver.baseURL).replace(/\/+$/, '') + '/');
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return url;
  const relative = '/' + url.pathname.slice(base.pathname.length);
  for (const route of driver.models[model.kind]?.routes || []) {
    if (method !== (route.key === 'status' ? 'GET' : 'POST')) continue;
    const replacement = model.paths[route.key];
    if (!replacement || replacement === route.path) continue;
    const variables: string[] = [];
    const pattern = route.path.split(/(\{\w+\})/).map((part) => {
      if (part.startsWith('{')) { variables.push(part); return part === '{operation}' ? '(.+)' : '([^/]+)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    const match = relative.match(new RegExp(`^${pattern}$`));
    if (!match) continue;
    let path = replacement;
    variables.forEach((variable, index) => { path = path.replaceAll(variable, match[index + 1]); });
    const routed = new URL(url);
    routed.pathname = base.pathname.replace(/\/$/, '') + path;
    return routed;
  }
  return url;
}

async function boundedBytes(response: Response, signal: AbortSignal, maxBytes = 50 * 1024 * 1024) {
  if (!response.ok) throw new Error(`Media download failed (HTTP ${response.status}).`);
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Media response exceeds the download limit.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Media response is empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw new Error('Media response exceeds the download limit.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Each provider owns its wire protocol; path overrides only change routing. */
function modelFetch(model: MediaModelConfig, fetcher: typeof globalThis.fetch, signal: AbortSignal): typeof globalThis.fetch {
  return async (input, init) => {
    const original = new URL(input instanceof Request ? input.url : String(input));
    const routed = routeUrl(original, model, (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase());
    const response = await fetcher(input instanceof Request ? new Request(routed, input) : routed, { ...init, signal });
    if (!response.ok || model.driver !== 'openai-compatible' || model.kind !== 'image') return response;
    // Images-compatible APIs may return either base64 or a URL. Normalize the
    // documented Images response before the SDK's base64-only response parser.
    const payload = z.object({ data: z.array(z.object({ b64_json: z.string().optional(), url: z.string().optional() })) }).parse(
      JSON.parse(new TextDecoder().decode(await boundedBytes(response, signal, 100 * 1024 * 1024))),
    );
    for (const item of payload.data) {
      if (item.b64_json || !item.url) continue;
      const url = new URL(item.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid generated image URL.');
      // Never forward the model API key to a provider's CDN.
      const bytes = await boundedBytes(await fetcher(url, { signal }), signal);
      item.b64_json = Buffer.from(bytes).toString('base64');
    }
    return Response.json(payload, { status: response.status });
  };
}

// Older settings used an OpenAI-compatible driver with MiniMax's native path.
// Recognize only MiniMax hosts and that exact endpoint; custom gateways can
// select the explicit MiniMax driver without changing their connection settings.
function effectiveMediaModel(model: MediaModelConfig): MediaModelConfig {
  if (model.driver !== 'openai-compatible' || model.kind !== 'image' || !model.baseURL) return model;
  const host = new URL(model.baseURL).hostname;
  return ['api.minimax.cn', 'api.minimaxi.com', 'api.minimax.io'].includes(host)
    && model.paths.generate === '/image_generation' ? { ...model, driver: 'minimax' } : model;
}

function minimaxImageModel(model: MediaModelConfig, fetcher: typeof globalThis.fetch): ImageModel {
  return {
    specificationVersion: 'v4', provider: 'minimax.image', modelId: model.model, maxImagesPerCall: 9,
    async doGenerate({ prompt, n, size, aspectRatio, seed, files, mask, abortSignal, providerOptions }) {
      if (mask) throw new Error('MiniMax image generation does not support masks.');
      const signal = abortSignal || AbortSignal.timeout(model.timeoutMs);
      const [width, height] = size ? size.split('x').map(Number) : [];
      const route = files?.length ? model.paths.edit : model.paths.generate;
      const url = (model.baseURL || mediaModelDriver('minimax').baseURL).replace(/\/+$/, '') + (route || '/image_generation');
      const response = await fetcher(url, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${model.apiKey || ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_format: 'base64', ...providerOptions.minimax,
          model: model.model, prompt, n,
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
          ...(size ? { width, height } : {}),
          ...(seed !== undefined ? { seed } : {}),
          ...(files?.length ? { subject_reference: files.map((file) => ({
            type: 'character',
            image_file: file.type === 'url' ? file.url : `data:${file.mediaType};base64,${typeof file.data === 'string' ? file.data : Buffer.from(file.data).toString('base64')}`,
          })) } : {}),
        }),
      });
      const payload = z.object({
        base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }).optional(),
        data: z.object({ image_base64: z.array(z.string()).optional(), image_urls: z.array(z.string()).optional() }).nullish(),
      }).parse(JSON.parse(new TextDecoder().decode(await boundedBytes(response, signal, 100 * 1024 * 1024))));
      if (payload.base_resp && payload.base_resp.status_code !== 0) {
        throw new Error(`MiniMax image generation failed (${payload.base_resp.status_code}): ${payload.base_resp.status_msg || 'Unknown error'}`);
      }
      const images: Uint8Array[] = (payload.data?.image_base64 || []).filter(Boolean).map((data) => Buffer.from(data, 'base64'));
      if (!images.length) {
        for (const ref of payload.data?.image_urls || []) {
          const imageUrl = new URL(ref);
          if (!['https:', 'http:'].includes(imageUrl.protocol) || imageUrl.username || imageUrl.password) throw new Error('Invalid generated image URL.');
          // CDN downloads must never receive the model API key.
          images.push(await boundedBytes(await fetcher(imageUrl, { signal }), signal));
        }
      }
      return { images, warnings: [], response: { timestamp: new Date(), modelId: model.model, headers: Object.fromEntries(response.headers) } };
    },
  };
}

async function loadModels(model: MediaModelConfig, fetch: typeof globalThis.fetch) {
  const settings = { apiKey: model.apiKey || '', baseURL: (model.baseURL || mediaModelDriver(model.driver).baseURL).replace(/\/+$/, ''), fetch };
  switch (model.driver) {
    case 'minimax': return { image: () => minimaxImageModel(model, fetch) };
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const provider = createOpenAI(settings);
      return { image: () => provider.image(model.model), speech: () => provider.speech(model.model) };
    }
    case 'openai-compatible': {
      if (model.kind === 'speech') {
        const { createOpenAI } = await import('@ai-sdk/openai');
        return { speech: () => createOpenAI(settings).speech(model.model) };
      }
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      return { image: () => createOpenAICompatible({ ...settings, name: 'compatible' }).imageModel(model.model) };
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const provider = createGoogleGenerativeAI(settings);
      return { image: () => provider.image(model.model), video: () => provider.video(model.model), speech: () => provider.speech(model.model) };
    }
    case 'xai': {
      const { createXai } = await import('@ai-sdk/xai');
      const provider = createXai(settings);
      return { image: () => provider.image(model.model), video: () => provider.video(model.model), speech: () => provider.speech() };
    }
    case 'alibaba': {
      const { createAlibaba } = await import('@ai-sdk/alibaba');
      return { video: () => createAlibaba({ ...settings, videoBaseURL: settings.baseURL }).video(model.model) };
    }
  }
}

export function createAiSdkMediaGenerationOperations(options: AiSdkMediaOperationsOptions): MediaGenerationOperations {
  async function generate(kind: MediaModelKind, request: MediaGenerationInput, context: CapabilityExecutionContext) {
    context.abortSignal?.throwIfAborted();
    const model = effectiveMediaModel(resolveMediaModel(options.configuration, kind, options.selectedModels?.[kind] || request.modelRef));
    const signal = AbortSignal.any([AbortSignal.timeout(model.timeoutMs), ...(context.abortSignal ? [context.abortSignal] : [])]);
    const execution = { ...context, abortSignal: signal };
    await context.reportProgress?.({ phase: 'generating', message: `Generating ${kind} with ${model.name}.` });
    const models = await loadModels(model, modelFetch(model, options.fetch || globalThis.fetch, signal));
    const namespace = model.driver === 'openai-compatible' ? kind === 'speech' ? 'openai' : 'compatible' : model.driver;
    const providerOptions = { [namespace]: parameters(model) };
    const size = request.size || model.size || undefined;
    const aspectRatio = request.aspectRatio || model.aspectRatio || undefined;
    const sources = await Promise.all((request.sourceRefs || []).map((ref) => options.readSource(ref, execution)));
    let files: MediaGenerationFile[];
    if (kind === 'image' && models.image) {
      const result = await generateImage({
        model: models.image(),
        prompt: sources.length ? { text: request.prompt, images: sources, mask: request.maskRef ? await options.readSource(request.maskRef, execution) : undefined } : request.prompt,
        n: request.count || 1, size: size as `${number}x${number}` | undefined,
        aspectRatio: aspectRatio as `${number}:${number}` | undefined,
        providerOptions, abortSignal: signal, maxRetries: 0,
      });
      files = result.images.map((image) => ({ data: image.uint8Array, mediaType: image.mediaType }));
    } else if (kind === 'video' && models.video) {
      const result = await generateVideo({
        model: models.video(), prompt: sources.length ? { text: request.prompt, image: sources[0] } : request.prompt,
        n: request.count || 1, resolution: size as `${number}x${number}` | undefined,
        aspectRatio: aspectRatio as `${number}:${number}` | undefined,
        duration: request.duration ?? model.duration, providerOptions, abortSignal: signal, maxRetries: 0,
        poll: { intervalMs: 5_000, timeoutMs: model.timeoutMs },
        download: createDownload({ maxBytes: 512 * 1024 * 1024 }),
      });
      files = result.videos.map((video) => ({ data: video.uint8Array, mediaType: video.mediaType }));
    } else if (kind === 'speech' && models.speech) {
      const result = await generateSpeech({
        model: models.speech(), text: request.prompt, voice: request.voice || model.voice || undefined,
        outputFormat: request.outputFormat || model.outputFormat || undefined, language: request.language,
        providerOptions, abortSignal: signal, maxRetries: 0,
      });
      files = [{ data: result.audio.uint8Array, mediaType: result.audio.mediaType }];
    } else { throw new Error(`Driver ${model.driver} does not support ${kind} generation.`); }
    const artifacts: MediaArtifact[] = [];
    await context.reportProgress?.({ phase: 'publishing', message: `Saving ${files.length} generated media artifact(s).` });
    for (const file of files) {
      signal.throwIfAborted();
      artifacts.push(await options.publishArtifact({ ...file, kind, modelRef: model.id }, execution));
    }
    return artifacts;
  }
  return {
    async listModels() {
      return options.configuration.models.filter((model) => model.enabled).map((model) => ({
        id: model.id, kind: model.kind, name: model.name, model: model.model,
        default: (options.configuration.defaults[model.kind] || options.configuration.models.find((item) => item.kind === model.kind && item.enabled)?.id) === model.id,
      }));
    },
    generateImage: (request, context) => generate('image', request, context),
    generateVideo: (request, context) => generate('video', request, context),
    generateSpeech: (request, context) => generate('speech', request, context),
  };
}
