import { z } from 'zod';

export const mediaModelKinds = ['image', 'video', 'speech'] as const;
export type MediaModelKind = typeof mediaModelKinds[number];
export type MediaModelDriver = 'openai' | 'openai-compatible' | 'google' | 'xai' | 'alibaba';
export type MediaModelRoute = { key: string; label: string; path: string };
export type MediaModelDriverDefinition = {
  id: MediaModelDriver;
  label: string;
  baseURL: string;
  models: Partial<Record<MediaModelKind, { placeholder: string; routes: MediaModelRoute[] }>>;
};

const imageRoutes = [
  { key: 'generate', label: '生成路径', path: '/images/generations' },
  { key: 'edit', label: '编辑路径', path: '/images/edits' },
];
const speechRoutes = [{ key: 'generate', label: '生成路径', path: '/audio/speech' }];
export const mediaModelDrivers: readonly MediaModelDriverDefinition[] = [
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', models: {
    image: { placeholder: '填写图片模型 ID', routes: imageRoutes },
    speech: { placeholder: '填写语音模型 ID', routes: speechRoutes },
  } },
  { id: 'openai-compatible', label: 'OpenAI 兼容接口', baseURL: '', models: {
    image: { placeholder: '填写服务商的图片模型 ID', routes: imageRoutes },
    speech: { placeholder: '填写服务商的语音模型 ID', routes: speechRoutes },
  } },
  { id: 'google', label: 'Google Gemini API', baseURL: 'https://generativelanguage.googleapis.com/v1beta', models: {
    image: { placeholder: '填写 Imagen 或 Gemini 图片模型 ID', routes: [
      { key: 'predict', label: 'Imagen 生成路径', path: '/models/{model}:predict' },
      { key: 'generate', label: 'Gemini 生成路径', path: '/models/{model}:generateContent' },
    ] },
    video: { placeholder: '填写 Veo 模型 ID', routes: [
      { key: 'generate', label: '提交路径', path: '/models/{model}:predictLongRunning' },
      { key: 'status', label: '查询路径', path: '/{operation}' },
    ] },
    speech: { placeholder: '填写 Gemini TTS 模型 ID', routes: [
      { key: 'generate', label: '生成路径', path: '/models/{model}:generateContent' },
    ] },
  } },
  { id: 'xai', label: 'xAI', baseURL: 'https://api.x.ai/v1', models: {
    image: { placeholder: '填写 Grok 图片模型 ID', routes: imageRoutes },
    video: { placeholder: '填写 Grok 视频模型 ID', routes: [
      { key: 'generate', label: '提交路径', path: '/videos/generations' },
      { key: 'status', label: '查询路径', path: '/videos/{id}' },
    ] },
    speech: { placeholder: 'xAI TTS（接口不接收模型 ID）', routes: [{ key: 'generate', label: '生成路径', path: '/tts' }] },
  } },
  { id: 'alibaba', label: 'Alibaba Cloud', baseURL: 'https://dashscope-intl.aliyuncs.com', models: {
    video: { placeholder: '填写 Wan 视频模型 ID', routes: [
      { key: 'generate', label: '提交路径', path: '/api/v1/services/aigc/video-generation/video-synthesis' },
      { key: 'status', label: '查询路径', path: '/api/v1/tasks/{id}' },
    ] },
  } },
];

export function mediaModelDriver(id: MediaModelDriver) {
  const driver = mediaModelDrivers.find((item) => item.id === id);
  if (!driver) throw new Error(`Unknown media model driver: ${id}`);
  return driver;
}

const optionalDimension = z.string().trim().regex(/^\d+x\d+$/).or(z.literal('')).default('');
export const mediaModelSchema = z.object({
  id: z.string().trim().min(1).max(100),
  kind: z.enum(mediaModelKinds),
  name: z.string().trim().max(100),
  driver: z.enum(['openai', 'openai-compatible', 'google', 'xai', 'alibaba']),
  model: z.string().trim().max(500),
  enabled: z.boolean(),
  baseURL: z.string().trim().max(4_000).default(''),
  apiKey: z.string().max(10_000).optional(),
  hasApiKey: z.boolean().optional(),
  clearApiKey: z.boolean().optional(),
  paths: z.record(z.string(), z.string().trim().max(2_000)).default({}),
  parameters: z.array(z.object({ key: z.string().trim().max(100), value: z.string().max(16_000) }).strict()).max(50).default([]),
  size: optionalDimension,
  aspectRatio: z.string().trim().regex(/^\d+:\d+$/).or(z.literal('')).default(''),
  duration: z.number().positive().max(600).optional(),
  voice: z.string().trim().max(200).default(''),
  outputFormat: z.string().trim().max(40).default(''),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).default(600_000),
}).strict().superRefine((model, context) => {
  const driver = mediaModelDriver(model.driver);
  const support = driver.models[model.kind];
  const issue = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (!support) issue('driver', '该供应商不支持此模型类型。');
  if (model.enabled && !model.model && !(model.driver === 'xai' && model.kind === 'speech')) issue('model', '请填写模型 ID。');
  if (model.enabled && !model.name) issue('name', '请填写模型名称。');
  if (model.baseURL) {
    try {
      const url = new URL(model.baseURL);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { issue('baseURL', '服务地址必须是 HTTP(S) 地址，不能包含凭据、查询参数或片段。'); }
  }
  for (const [key, value] of Object.entries(model.paths)) {
    const route = support?.routes.find((item) => item.key === key);
    if (!route) { issue('paths', `未知接口路径：${key}`); continue; }
    if (!value) continue;
    if (!value.startsWith('/') || value.startsWith('//') || /[?#\\\s]/.test(value) || value.split('/').some((part) => part === '.' || part === '..')) issue('paths', '接口路径应以 / 开头，并相对于服务地址。');
    const variables: string[] = route.path.match(/\{\w+\}/g) || [];
    if (variables.some((variable) => !value.includes(variable)) || (value.match(/\{\w+\}/g) || []).some((variable) => !variables.includes(variable))) issue('paths', `路径必须保留占位符：${variables.join('、') || '无'}`);
  }
  const keys = model.parameters.map((item) => item.key).filter(Boolean);
  if (keys.length !== new Set(keys).size) issue('parameters', '额外参数名不能重复。');
  const reserved = new Set(['model', 'prompt', 'n', 'image', 'images', 'mask', 'input', 'text', 'stream']);
  if (keys.some((key) => reserved.has(key))) issue('parameters', '模型、输入内容和生成数量由应用管理，不能使用额外参数覆盖。');
});
export type MediaModelConfig = z.infer<typeof mediaModelSchema>;

export const mediaModelConfigurationSchema = z.object({
  models: z.array(mediaModelSchema).max(200),
  defaults: z.object({ image: z.string().optional(), video: z.string().optional(), speech: z.string().optional() }).strict(),
}).strict().superRefine((configuration, context) => {
  if (new Set(configuration.models.map((model) => model.id)).size !== configuration.models.length) context.addIssue({ code: 'custom', path: ['models'], message: '模型配置 ID 不能重复。' });
  for (const kind of mediaModelKinds) {
    const id = configuration.defaults[kind];
    if (id && !configuration.models.some((model) => model.id === id && model.kind === kind && model.enabled)) context.addIssue({ code: 'custom', path: ['defaults', kind], message: '默认模型必须是同类型的已启用模型。' });
  }
});
export type MediaModelConfiguration = z.infer<typeof mediaModelConfigurationSchema>;

export function publicMediaModelConfiguration(configuration?: MediaModelConfiguration): MediaModelConfiguration {
  return {
    models: (configuration?.models || []).map(({ apiKey, clearApiKey: _clear, ...model }) => ({ ...model, apiKey: '', hasApiKey: Boolean(apiKey) })),
    defaults: { ...configuration?.defaults },
  };
}

export function mergeMediaModelConfiguration(input: MediaModelConfiguration, previous?: MediaModelConfiguration): MediaModelConfiguration {
  const parsed = mediaModelConfigurationSchema.parse(input);
  return {
    defaults: parsed.defaults,
    models: parsed.models.map(({ hasApiKey: _has, clearApiKey, ...model }) => ({
      ...model,
      apiKey: clearApiKey ? '' : model.apiKey || previous?.models.find((item) => item.id === model.id)?.apiKey || '',
    })),
  };
}

export function resolveMediaModel(configuration: MediaModelConfiguration, kind: MediaModelKind, id?: string) {
  const available = configuration.models.filter((model) => model.kind === kind && model.enabled);
  const selected = id || configuration.defaults[kind];
  const model = selected ? available.find((item) => item.id === selected) : available[0];
  if (!model) throw new Error(`未配置可用的 ${kind} 生成模型${selected ? `：${selected}` : ''}。请在模型设置中添加并启用。`);
  return model;
}
