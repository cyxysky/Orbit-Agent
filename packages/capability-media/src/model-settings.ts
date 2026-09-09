import { z } from 'zod';
import { mediaModelDrivers, mediaModelSchema, type MediaModelKind, type MediaModelConfiguration } from './models.ts';

export const mediaModelTypeDefinitions = [
  { id: 'image', label: '图片生成' },
  { id: 'video', label: '视频生成' },
  { id: 'speech', label: '声音生成' },
] as const;

const fields = mediaModelSchema.shape;
const typeSettingsSchema = z.object({
  models: z.array(z.string().trim().max(500)).max(200).default([]),
  defaultModel: z.string().trim().max(500).default(''),
  driver: fields.driver,
  baseURL: fields.baseURL,
  paths: fields.paths,
  parameters: fields.parameters,
  size: fields.size,
  aspectRatio: fields.aspectRatio,
  duration: fields.duration,
  voice: fields.voice,
  outputFormat: fields.outputFormat,
  timeoutMs: fields.timeoutMs,
}).strict();

export type MediaTypeSettings = z.infer<typeof typeSettingsSchema>;
export type ProviderMediaSettings = Partial<Record<MediaModelKind, MediaTypeSettings>>;

function schemaForKind(kind: MediaModelKind) {
  return typeSettingsSchema.transform((settings) => normalizeMediaTypeSettings(settings)).superRefine((settings, context) => {
    const { models, defaultModel: _default, ...connection } = settings;
    const result = mediaModelSchema.safeParse({ ...connection, id: 'configuration', name: 'configuration', kind, model: models[0] || '', enabled: models.length > 0 });
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });
}

export const providerMediaSettingsSchema = z.object({
  image: schemaForKind('image').optional(),
  video: schemaForKind('video').optional(),
  speech: schemaForKind('speech').optional(),
}).strict();

export function createMediaTypeSettings(provider: string, kind: MediaModelKind, settings?: MediaTypeSettings): MediaTypeSettings {
  const drivers = mediaModelDrivers.filter((driver) => driver.models[kind]);
  const driver = drivers.find((item) => item.id === provider) || drivers.find((item) => item.id === 'openai-compatible') || drivers[0];
  return { ...typeSettingsSchema.parse({ driver: driver.id }), ...settings };
}

export function normalizeMediaTypeSettings(settings: MediaTypeSettings): MediaTypeSettings {
  const models = Array.from(new Set(settings.models.map((model) => model.trim()).filter(Boolean)));
  return { ...settings, models, defaultModel: models.includes(settings.defaultModel) ? settings.defaultModel : models[0] || '' };
}

export function normalizeProviderMediaSettings(settings?: ProviderMediaSettings): ProviderMediaSettings {
  return Object.fromEntries((['image', 'video', 'speech'] as const).flatMap((kind) => settings?.[kind] ? [[kind, normalizeMediaTypeSettings(settings[kind])]] : []));
}

const selectionSchema = z.object({ provider: z.string().min(1), model: z.string().min(1).max(500) }).strict();
export const mediaModelSelectionsSchema = z.object({ image: selectionSchema.optional(), video: selectionSchema.optional(), speech: selectionSchema.optional() }).strict();
export type MediaModelSelections = z.infer<typeof mediaModelSelectionsSchema>;

export function mediaModelSelectionId(kind: MediaModelKind, id: string) {
  return `media::${kind}::${id}`;
}

export function parseMediaModelSelection(model: unknown): { kind: MediaModelKind; id: string } | undefined {
  const match = typeof model === 'string' ? /^media::(image|video|speech)::(.+)$/.exec(model) : null;
  return match ? { kind: match[1] as MediaModelKind, id: match[2] } : undefined;
}

export function scopedMediaModelRef(provider: string, kind: MediaModelKind, model: string) {
  return `${provider}::model::${encodeURIComponent(mediaModelSelectionId(kind, model))}`;
}

type MediaProvider = { enabled?: boolean; displayName?: string; apiKey?: string; media?: ProviderMediaSettings };
export function resolveMediaTypeSelection(providers: Record<string, MediaProvider | undefined>, kind: MediaModelKind, selected?: MediaModelSelections, preferredProvider?: string) {
  const selection = selected?.[kind];
  if (selection) {
    const settings = providers[selection.provider];
    return settings?.enabled && settings.media?.[kind]?.models.includes(selection.model) ? selection : undefined;
  }
  const available = Object.entries(providers).filter(([, settings]) => settings?.enabled && settings.media?.[kind]?.models.length);
  const entry = available.find(([provider]) => provider === preferredProvider) || available[0];
  if (!entry) return undefined;
  const type = entry[1]!.media![kind]!;
  return { provider: entry[0], model: type.models.includes(type.defaultModel) ? type.defaultModel : type.models[0] };
}

/** Expands type settings into adapter models; language-model settings are never read. */
export function mediaConfigurationForProviders(providers: Record<string, MediaProvider | undefined>, selected?: MediaModelSelections, preferredProvider?: string): MediaModelConfiguration {
  const models: MediaModelConfiguration['models'] = [];
  const defaults: MediaModelConfiguration['defaults'] = {};
  for (const [provider, settings] of Object.entries(providers)) {
    if (!settings?.enabled) continue;
    for (const { id: kind } of mediaModelTypeDefinitions) {
      const type = settings.media?.[kind];
      if (!type) continue;
      const { models: ids, defaultModel: _default, ...connection } = type;
      for (const model of ids) models.push({ ...connection, kind, model, enabled: true, id: scopedMediaModelRef(provider, kind, model), name: model, apiKey: settings.apiKey || '' });
    }
  }
  for (const { id: kind } of mediaModelTypeDefinitions) {
    // Keep an explicitly selected missing model unresolved so generation fails
    // instead of silently charging a different provider/model.
    const selection = selected?.[kind] || resolveMediaTypeSelection(providers, kind, selected, preferredProvider);
    if (selection) defaults[kind] = scopedMediaModelRef(selection.provider, kind, selection.model);
  }
  return { models, defaults };
}

export type MediaSettingField = {
  key: 'size' | 'aspectRatio' | 'duration' | 'voice' | 'outputFormat' | 'timeoutMs';
  label: string;
  description: string;
  kinds: readonly MediaModelKind[];
  group: 'connection' | 'generation';
  type: 'text' | 'number';
  placeholder?: string;
  min?: number;
  max?: number;
  scale?: number;
};

export const mediaSettingFields: readonly MediaSettingField[] = [
  { key: 'timeoutMs', label: '生成超时（秒）', description: '包括请求、视频任务查询和结果下载的总等待时间。', kinds: ['image', 'video', 'speech'], group: 'connection', type: 'number', min: 1, max: 3600, scale: 1000 },
  { key: 'size', label: '默认尺寸', description: '填写宽x高，例如 1024x1024；视频使用分辨率。', kinds: ['image', 'video'], group: 'generation', type: 'text', placeholder: '1024x1024' },
  { key: 'aspectRatio', label: '默认宽高比', description: '例如 16:9；仅适用于支持宽高比的模型。', kinds: ['image', 'video'], group: 'generation', type: 'text', placeholder: '16:9' },
  { key: 'duration', label: '默认时长（秒）', description: '填写模型支持的视频时长。', kinds: ['video'], group: 'generation', type: 'number', min: 1, max: 600 },
  { key: 'voice', label: '默认音色', description: '填写供应商提供的音色 ID。声音生成用于文本转语音。', kinds: ['speech'], group: 'generation', type: 'text' },
  { key: 'outputFormat', label: '音频格式', description: '例如 mp3 或 wav；留空使用供应商默认格式。', kinds: ['speech'], group: 'generation', type: 'text', placeholder: 'mp3' },
];
