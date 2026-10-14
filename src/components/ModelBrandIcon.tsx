'use client';

import { Bot } from 'lucide-react';
import Image from 'next/image';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import type { ModelProvider } from '@/server/ai/schemas/runtime.schema';
import { useI18n } from '@/i18n/I18nProvider';

// Icons are static public assets; compiling the model selector should not
// evaluate every provider PNG through the compiler image loader.
type BrandIcon = {
  dark: string;
  label: string;
  light: string;
};

const brands = {
  anthropic: { dark: withWebPilotBasePath('/model-brands/dark/claude-color.png'), label: 'Anthropic Claude', light: withWebPilotBasePath('/model-brands/light/claude-color.png') },
  azure: { dark: withWebPilotBasePath('/model-brands/dark/azureai-color.png'), label: 'Azure AI', light: withWebPilotBasePath('/model-brands/light/azureai-color.png') },
  bedrock: { dark: withWebPilotBasePath('/model-brands/dark/bedrock-color.png'), label: 'Amazon Bedrock', light: withWebPilotBasePath('/model-brands/light/bedrock-color.png') },
  cerebras: { dark: withWebPilotBasePath('/model-brands/dark/cerebras-color.png'), label: 'Cerebras', light: withWebPilotBasePath('/model-brands/light/cerebras-color.png') },
  cohere: { dark: withWebPilotBasePath('/model-brands/dark/cohere-color.png'), label: 'Cohere', light: withWebPilotBasePath('/model-brands/light/cohere-color.png') },
  deepseek: { dark: withWebPilotBasePath('/model-brands/dark/deepseek-color.png'), label: 'DeepSeek', light: withWebPilotBasePath('/model-brands/light/deepseek-color.png') },
  fireworks: { dark: withWebPilotBasePath('/model-brands/dark/fireworks-color.png'), label: 'Fireworks AI', light: withWebPilotBasePath('/model-brands/light/fireworks-color.png') },
  gemini: { dark: withWebPilotBasePath('/model-brands/dark/gemini-color.png'), label: 'Google Gemini', light: withWebPilotBasePath('/model-brands/light/gemini-color.png') },
  grok: { dark: withWebPilotBasePath('/model-brands/dark/grok.png'), label: 'xAI Grok', light: withWebPilotBasePath('/model-brands/light/grok.png') },
  groq: { dark: withWebPilotBasePath('/model-brands/dark/groq.png'), label: 'Groq', light: withWebPilotBasePath('/model-brands/light/groq.png') },
  huggingface: { dark: withWebPilotBasePath('/model-brands/dark/huggingface-color.png'), label: 'Hugging Face', light: withWebPilotBasePath('/model-brands/light/huggingface-color.png') },
  lmstudio: { dark: withWebPilotBasePath('/model-brands/dark/lmstudio.png'), label: 'LM Studio', light: withWebPilotBasePath('/model-brands/light/lmstudio.png') },
  meta: { dark: withWebPilotBasePath('/model-brands/dark/meta-color.png'), label: 'Meta Llama', light: withWebPilotBasePath('/model-brands/light/meta-color.png') },
  minimax: { dark: withWebPilotBasePath('/model-brands/dark/minimax-color.png'), label: 'MiniMax', light: withWebPilotBasePath('/model-brands/light/minimax-color.png') },
  mistral: { dark: withWebPilotBasePath('/model-brands/dark/mistral-color.png'), label: 'Mistral AI', light: withWebPilotBasePath('/model-brands/light/mistral-color.png') },
  ollama: { dark: withWebPilotBasePath('/model-brands/dark/ollama.png'), label: 'Ollama', light: withWebPilotBasePath('/model-brands/light/ollama.png') },
  openai: { dark: withWebPilotBasePath('/model-brands/dark/openai.png'), label: 'OpenAI', light: withWebPilotBasePath('/model-brands/light/openai.png') },
  openrouter: { dark: withWebPilotBasePath('/model-brands/dark/openrouter.png'), label: 'OpenRouter', light: withWebPilotBasePath('/model-brands/light/openrouter.png') },
  perplexity: { dark: withWebPilotBasePath('/model-brands/dark/perplexity-color.png'), label: 'Perplexity', light: withWebPilotBasePath('/model-brands/light/perplexity-color.png') },
  qwen: { dark: withWebPilotBasePath('/model-brands/dark/qwen-color.png'), label: 'Alibaba Qwen', light: withWebPilotBasePath('/model-brands/light/qwen-color.png') },
  together: { dark: withWebPilotBasePath('/model-brands/dark/together-color.png'), label: 'Together AI', light: withWebPilotBasePath('/model-brands/light/together-color.png') },
  vercel: { dark: withWebPilotBasePath('/model-brands/dark/vercel.png'), label: 'Vercel', light: withWebPilotBasePath('/model-brands/light/vercel.png') },
  zhipu: { dark: withWebPilotBasePath('/model-brands/dark/zhipu-color.png'), label: 'Zhipu GLM', light: withWebPilotBasePath('/model-brands/light/zhipu-color.png') },
} satisfies Record<string, BrandIcon>;

type BrandName = keyof typeof brands;

const modelMatchers: Array<[RegExp, BrandName]> = [
  [/deepseek/i, 'deepseek'],
  [/minimax/i, 'minimax'],
  [/(?:^|[/_.-])(?:gpt|chatgpt|o[134])(?:$|[/_.-])|codex/i, 'openai'],
  [/claude|anthropic/i, 'anthropic'],
  [/gemini|gemma/i, 'gemini'],
  [/qwen|qwq|tongyi/i, 'qwen'],
  [/llama|meta[-_/ ]?llama/i, 'meta'],
  [/mistral|mixtral|codestral/i, 'mistral'],
  [/grok|xai/i, 'grok'],
  [/command[-_ ]?[ar]|cohere/i, 'cohere'],
  [/sonar|perplexity/i, 'perplexity'],
  [/glm|zhipu|chatglm/i, 'zhipu'],
];

const providerBrands: Partial<Record<ModelProvider, BrandName>> = {
  'ai-gateway': 'vercel',
  'alibaba': 'qwen',
  'anthropic': 'anthropic',
  'azure-openai': 'azure',
  'bedrock': 'bedrock',
  'cerebras': 'cerebras',
  'codex': 'openai',
  'cohere': 'cohere',
  'deepseek': 'deepseek',
  'fireworks': 'fireworks',
  'google': 'gemini',
  'groq': 'groq',
  'huggingface': 'huggingface',
  'llama-cpp': 'meta',
  'lmstudio': 'lmstudio',
  'minimax': 'minimax',
  'mistral': 'mistral',
  'ollama': 'ollama',
  'openai': 'openai',
  'openrouter': 'openrouter',
  'perplexity': 'perplexity',
  'togetherai': 'together',
  'vercel': 'vercel',
  'xai': 'grok',
};

export function modelBrandName(model: string, provider: ModelProvider): BrandName | undefined {
  const match = modelMatchers.find(([pattern]) => pattern.test(model.trim()));
  return match?.[1] || providerBrands[provider];
}

export function ModelBrandIcon({ model, provider }: { model: string; provider: ModelProvider }) {
  const { t } = useI18n();
  const brandName = modelBrandName(model, provider);
  const brand = brandName ? brands[brandName] : undefined;
  if (!brand) return <Bot aria-label={t('AI 模型')} size={16} />;
  return (
    <span aria-label={brand.label} className="model-brand-icon-images" role="img">
      <Image alt="" className="model-brand-icon-light" src={brand.light} width={17} height={17} unoptimized />
      <Image alt="" className="model-brand-icon-dark" src={brand.dark} width={17} height={17} unoptimized />
    </span>
  );
}
