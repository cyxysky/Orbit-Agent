import { runtimeConfiguration, runtimeSetting, withRuntimeConfiguration } from '@/server/settings/runtime-configuration';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { aiFetch } from './ai-fetch';
import { withAiReasoningSettings } from './ai-sdk-runtime';
import { currentReasoningEffort, withReasoningEffort } from './reasoning-scope';
import type { ReasoningEffortSetting } from '@/lib/reasoning-effort';
import { resolveCodexCliPath } from './codex-cli';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { generateText } from 'ai';
import { isOpenAICompatibleProvider, normalizeMiniMaxOpenAIBaseURL, openAICompatibleProviderIndex } from '@/config/settings';
import { ensureAiSdkTelemetryRegistered } from '@/server/ai/ai-sdk-telemetry';
import { filterSensitiveData } from '@/server/capabilities/sensitive-data';
import { normalizeToolInputSchemas } from '@/server/ai/tool-input-schema';
import { normalizeRuntimeCacheUsage } from '@/server/ai/agents/runtime-prompt-cache';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { hostExecutionEnabled } from '@/server/runtime/self-bootstrap-policy';
import { appDataRoot } from '@/server/storage/paths';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { prepareCodexIdentityHome } from './codex-identity';


ensureAiSdkTelemetryRegistered();

type GenerateTextModel = Parameters<typeof generateText>[0]['model'];
type LoadedLanguageModel = LanguageModelV4;
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type AiProvider =
  | 'ai-gateway'
  | 'alibaba'
  | 'anthropic'
  | 'azure-openai'
  | 'bedrock'
  | 'cerebras'
  | 'codex'
  | 'cohere'
  | 'deepinfra'
  | 'deepseek'
  | 'fireworks'
  | 'google'
  | 'groq'
  | 'huggingface'
  | 'llama-cpp'
  | 'lmstudio'
  | 'minimax'
  | 'mistral'
  | 'ollama'
  | 'openai'
  | 'openai-compatible'
  | 'openai-compatible-2'
  | 'openai-compatible-3'
  | `openai-compatible-${number}`
  | 'openrouter'
  | 'perplexity'
  | 'togetherai'
  | 'vercel'
  | 'xai';
type ApprovalMode = 'never' | 'on-request';
type SandboxMode = 'danger-full-access' | 'read-only' | 'workspace-write';
export type ModelSettingsOverride = {
  sessionId?: string;
  provider?: string;
  model?: string;
  supportsImageInput?: boolean;
  maxContextTokens?: number;
  reasoningEffort?: ReasoningEffortSetting;
};

const modelSettingsStorage = ((globalThis as typeof globalThis & {
  __webPilotModelSettingsStorage?: AsyncLocalStorage<ModelSettingsOverride>;
}).__webPilotModelSettingsStorage ??= new AsyncLocalStorage<ModelSettingsOverride>());


function optionalConfigurationValue(name: string) {
  return runtimeSetting(name)?.trim() || undefined;
}

function miniMaxOpenAIBaseURL() {
  return normalizeMiniMaxOpenAIBaseURL(
    optionalConfigurationValue('MINIMAX_BASE_URL'),
  );
}

const protectedOpenAICompatibleRequestFields = new Set([
  'model',
  'messages',
  'stream',
  'tools',
  'tool_choice',
]);

function extraOpenAICompatibleRequestParameters(settingKey: string) {
  const raw = String(runtimeSetting(settingKey) || '').trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => !protectedOpenAICompatibleRequestFields.has(key)));
  } catch {
    return {};
  }
}

function mergeExtraOpenAICompatibleRequestParameters(
  body: Record<string, unknown>,
  parameters: Record<string, unknown>,
) {
  return { ...body, ...parameters };
}

function lazyLanguageModel(
  provider: string,
  modelId: string,
  loader: (sessionId: string) => Promise<LoadedLanguageModel>,
): GenerateTextModel {
  // Capture before lazy loading, which may run outside the settings scope.
  const sessionId = modelSettingsStorage.getStore()?.sessionId || randomUUID();
  const reasoningEffort = currentReasoningEffort();
  const configuration = runtimeConfiguration();
  let resolvedModel: Promise<LoadedLanguageModel> | undefined;
  const loadModel = () => (resolvedModel ??= withRuntimeConfiguration(configuration, () => loader(sessionId)));
  return {
    specificationVersion: 'v4',
    provider,
    modelId,
    supportedUrls: {},
    doGenerate: async (options) => {
      const model = await loadModel();
      const prepared = normalizeToolInputSchemas(await filterSensitiveData(withAiReasoningSettings(options, model.provider, reasoningEffort)));
      const result = await model.doGenerate(prepared);
      return { ...result, usage: normalizeRuntimeCacheUsage(result.usage) };
    },
    doStream: async (options) => {
      const model = await loadModel();
      const prepared = normalizeToolInputSchemas(await filterSensitiveData(withAiReasoningSettings(options, model.provider, reasoningEffort)));
      const result = await model.doStream(prepared);
      return { ...result, stream: result.stream.pipeThrough(new TransformStream({
        transform(part, controller) {
          controller.enqueue(part.type === 'finish'
            ? { ...part, usage: normalizeRuntimeCacheUsage(part.usage) } : part);
        },
      })) };
    },
  } satisfies GenerateTextModel;
}

function openCodeHeaders(baseURL: string | undefined, sessionId: string) {
  if (!baseURL) return undefined;
  try {
    const { hostname } = new URL(baseURL);
    if (hostname !== 'opencode.ai' && !hostname.endsWith('.opencode.ai')) return undefined;
  } catch {
    return undefined;
  }
  return { 'x-opencode-session': sessionId, 'User-Agent': 'webpilot/1.0' };
}

function openAiCompatibleModel(
  provider: 'llama-cpp' | 'lmstudio' | 'ollama' | 'openai-compatible' | `openai-compatible-${number}`,
  modelId: string,
  baseUrlEnvironmentName: string,
  defaultBaseURL: string,
  apiKeyEnvironmentName: string,
  extraRequestParametersEnvironmentName: string,
) {
  return lazyLanguageModel(provider, modelId, async (sessionId) => {
    const baseURL = optionalConfigurationValue(baseUrlEnvironmentName) || defaultBaseURL;
    if (!baseURL) {
      throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `${provider} has no Base URL. Configure the complete OpenAI-compatible /v1 endpoint in model settings.`);
    }
    const extraRequestParameters = extraOpenAICompatibleRequestParameters(extraRequestParametersEnvironmentName);
    if (/minimax/i.test(`${modelId} ${baseURL}`)) {
      const { createMiniMaxOpenAIV4 } = await import('@/server/ai/providers/minimax-openai-v4-provider');
      return createMiniMaxOpenAIV4({
        fetch: aiFetch,
        apiKey: optionalConfigurationValue(apiKeyEnvironmentName) || '',
        baseURL,
        headers: openCodeHeaders(baseURL, sessionId),
        extraRequestParameters,
      })(modelId);
    }
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    return createOpenAICompatible({
      fetch: aiFetch,
      name: provider,
      baseURL,
      headers: openCodeHeaders(baseURL, sessionId),
      apiKey: optionalConfigurationValue(apiKeyEnvironmentName),
      transformRequestBody: (body) => mergeExtraOpenAICompatibleRequestParameters(body, extraRequestParameters),
    })(modelId) as unknown as LoadedLanguageModel;
  });
}

export function withModelSettings<T>(settings: ModelSettingsOverride, callback: () => T): T {
  const sessionId = settings.sessionId?.trim() || modelSettingsStorage.getStore()?.sessionId || randomUUID();
  return modelSettingsStorage.run({ ...settings, sessionId }, () => withReasoningEffort(settings.reasoningEffort, callback));
}

export function getModel(): GenerateTextModel {
  const { provider, model } = getModelSettings();
  if (provider === 'ai-gateway') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('AI_GATEWAY_BASE_URL');
    const { createGateway } = await import('@ai-sdk/gateway');
    return createGateway({
      fetch: aiFetch,
      apiKey: runtimeSetting("AI_GATEWAY_API_KEY") || runtimeSetting('VERCEL_AI_GATEWAY_API_KEY') || '',
      baseURL,
    })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'alibaba') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('ALIBABA_BASE_URL');
    const { createAlibaba } = await import('@ai-sdk/alibaba');
    return createAlibaba({ fetch: aiFetch, apiKey: runtimeSetting("ALIBABA_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'anthropic') return lazyLanguageModel(provider, model, async (sessionId) => {
    const baseURL = optionalConfigurationValue('ANTHROPIC_BASE_URL');
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    return createAnthropic({ fetch: aiFetch, apiKey: runtimeSetting("ANTHROPIC_API_KEY") || '', baseURL, headers: openCodeHeaders(baseURL, sessionId) })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'bedrock') return lazyLanguageModel(provider, model, async () => {
    const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock');
    return createAmazonBedrock({
      fetch: aiFetch,
      apiKey: runtimeSetting("AWS_BEARER_TOKEN_BEDROCK") || undefined,
      region: runtimeSetting("AWS_REGION") || 'us-east-1',
    })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'cerebras') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('CEREBRAS_BASE_URL');
    const { createCerebras } = await import('@ai-sdk/cerebras');
    return createCerebras({ fetch: aiFetch, apiKey: runtimeSetting("CEREBRAS_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'cohere') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('COHERE_BASE_URL');
    const { createCohere } = await import('@ai-sdk/cohere');
    return createCohere({ fetch: aiFetch, apiKey: runtimeSetting("COHERE_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'codex') return getCodexModel(model);
  if (provider === 'deepseek') return lazyLanguageModel(provider, model, async (sessionId) => {
    const baseURL = optionalConfigurationValue('DEEPSEEK_BASE_URL');
    const { createDeepSeek } = await import('@ai-sdk/deepseek');
    return createDeepSeek({ fetch: aiFetch, apiKey: runtimeSetting("DEEPSEEK_API_KEY") || '', baseURL, headers: openCodeHeaders(baseURL, sessionId) })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'deepinfra') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('DEEPINFRA_BASE_URL');
    const { createDeepInfra } = await import('@ai-sdk/deepinfra');
    return createDeepInfra({ fetch: aiFetch, apiKey: runtimeSetting("DEEPINFRA_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'fireworks') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('FIREWORKS_BASE_URL');
    const { createFireworks } = await import('@ai-sdk/fireworks');
    return createFireworks({ fetch: aiFetch, apiKey: runtimeSetting("FIREWORKS_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'google') return lazyLanguageModel(provider, model, async () => {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    return createGoogleGenerativeAI({
      fetch: aiFetch,
      apiKey: runtimeSetting("GOOGLE_GENERATIVE_AI_API_KEY") || runtimeSetting('GOOGLE_API_KEY') || '',
    })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'groq') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('GROQ_BASE_URL');
    const { createGroq } = await import('@ai-sdk/groq');
    return createGroq({ fetch: aiFetch, apiKey: runtimeSetting("GROQ_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'huggingface') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('HUGGINGFACE_BASE_URL');
    const { createHuggingFace } = await import('@ai-sdk/huggingface');
    return createHuggingFace({ fetch: aiFetch, apiKey: runtimeSetting("HUGGINGFACE_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'lmstudio') return openAiCompatibleModel(provider, model, 'LMSTUDIO_BASE_URL', 'http://localhost:1234/v1', 'LMSTUDIO_API_KEY', 'LMSTUDIO_EXTRA_REQUEST_PARAMETERS');
  if (provider === 'llama-cpp') return openAiCompatibleModel(provider, model, 'LLAMA_CPP_BASE_URL', 'http://localhost:8080/v1', 'LLAMA_CPP_API_KEY', 'LLAMA_CPP_EXTRA_REQUEST_PARAMETERS');
  if (provider === 'ollama') return openAiCompatibleModel(provider, model, 'OLLAMA_BASE_URL', 'http://localhost:11434/v1', 'OLLAMA_API_KEY', 'OLLAMA_EXTRA_REQUEST_PARAMETERS');
  if (isOpenAICompatibleProvider(provider)) {
    const openAICompatibleIndex = openAICompatibleProviderIndex(provider) || 1;
    const environmentPrefix = openAICompatibleIndex === 1
      ? 'OPENAI_COMPATIBLE'
      : `OPENAI_COMPATIBLE_${openAICompatibleIndex}`;
    return openAiCompatibleModel(
      provider,
      model,
      `${environmentPrefix}_BASE_URL`,
      '',
      `${environmentPrefix}_API_KEY`,
      `${environmentPrefix}_EXTRA_REQUEST_PARAMETERS`,
    );
  }
  if (provider === 'minimax') return lazyLanguageModel(provider, model, async (sessionId) => {
    const baseURL = miniMaxOpenAIBaseURL();
    const { createMiniMaxOpenAIV4 } = await import('@/server/ai/providers/minimax-openai-v4-provider');
    return createMiniMaxOpenAIV4({
      fetch: aiFetch,
      apiKey: runtimeSetting("MINIMAX_API_KEY") || '',
      baseURL: baseURL || 'https://api.minimax.io/v1',
      headers: openCodeHeaders(baseURL, sessionId),
      extraRequestParameters: extraOpenAICompatibleRequestParameters('MINIMAX_EXTRA_REQUEST_PARAMETERS'),
    })(model);
  });
  if (provider === 'openai') return lazyLanguageModel(provider, model, async (sessionId) => {
    const baseURL = optionalConfigurationValue('OPENAI_BASE_URL');
    const { createOpenAI } = await import('@ai-sdk/openai');
    return createOpenAI({ fetch: aiFetch, apiKey: runtimeSetting("OPENAI_API_KEY") || '', baseURL, headers: openCodeHeaders(baseURL, sessionId) })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'azure-openai') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('AZURE_OPENAI_BASE_URL') || 'http://mirrors.shterm.com:4000';
    const { createAzure } = await import('@ai-sdk/azure');
    return createAzure({ fetch: aiFetch, baseURL, apiKey: runtimeSetting("AZURE_OPENAI_API_KEY") || '-' }).chat(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'mistral') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('MISTRAL_BASE_URL');
    const { createMistral } = await import('@ai-sdk/mistral');
    return createMistral({ fetch: aiFetch, apiKey: runtimeSetting("MISTRAL_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'perplexity') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('PERPLEXITY_BASE_URL');
    const { createPerplexity } = await import('@ai-sdk/perplexity');
    return createPerplexity({ fetch: aiFetch, apiKey: runtimeSetting("PERPLEXITY_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'togetherai') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('TOGETHERAI_BASE_URL');
    const { createTogetherAI } = await import('@ai-sdk/togetherai');
    return createTogetherAI({ fetch: aiFetch, apiKey: runtimeSetting("TOGETHERAI_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'vercel') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('VERCEL_BASE_URL');
    const { createVercel } = await import('@ai-sdk/vercel');
    return createVercel({ fetch: aiFetch, apiKey: runtimeSetting("VERCEL_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  if (provider === 'xai') return lazyLanguageModel(provider, model, async () => {
    const baseURL = optionalConfigurationValue('XAI_BASE_URL');
    const { createXai } = await import('@ai-sdk/xai');
    return createXai({ fetch: aiFetch, apiKey: runtimeSetting("XAI_API_KEY") || '', baseURL })(model) as unknown as LoadedLanguageModel;
  });
  return lazyLanguageModel('openrouter', model, async () => {
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
    return createOpenRouter({ fetch: aiFetch, apiKey: runtimeSetting("OPENROUTER_API_KEY") || '' }).chat(model) as unknown as LoadedLanguageModel;
  });
}

export function getModelSettings() {
  const override = modelSettingsStorage.getStore();
  const provider = normalizeProvider(override?.provider || runtimeSetting('AI_PROVIDER'));
  const defaults: Partial<Record<AiProvider, string>> = {
    'ai-gateway': 'openai/gpt-5.5',
    alibaba: 'qwen-plus',
    anthropic: 'claude-sonnet-4-5',
    'azure-openai': 'deepseek-v4-pro',
    bedrock: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    cerebras: 'llama3.1-8b',
    codex: 'gpt-5.5',
    cohere: 'command-a-03-2025',
    deepinfra: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    deepseek: 'deepseek-v4-flash',
    fireworks: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    google: 'gemini-3-flash-preview',
    groq: 'llama-3.3-70b-versatile',
    huggingface: 'meta-llama/Llama-3.1-8B-Instruct',
    'llama-cpp': 'local-model',
    lmstudio: 'qwen3-vl-2b-instruct',
    minimax: 'minimax-m3',
    mistral: 'mistral-large-latest',
    ollama: 'llama3.1',
    openai: 'gpt-5.5',
    'openai-compatible': 'custom-model',
    'openai-compatible-2': 'custom-model',
    'openai-compatible-3': 'custom-model',
    openrouter: 'qwen/qwen3.6-27b',
    perplexity: 'sonar',
    togetherai: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    vercel: 'v0-1.5-md',
    xai: 'grok-4',
  };
  return {
    provider,
    model: override?.model || runtimeSetting('AI_MODEL') || defaults[provider] || 'custom-model',
    supportsImageInput: override?.supportsImageInput === true,
    maxContextTokens: override?.maxContextTokens,
  };
}

function getCodexModel(model: string): GenerateTextModel {
  const projectRoot = process.cwd();
  const codexPath = resolveCodexCliPath(runtimeSetting('CODEX_PATH'), projectRoot);
  const hostExecution = hostExecutionEnabled();
  const cwd = hostExecution ? runtimeSetting('CODEX_CWD') || projectRoot : path.join(appDataRoot(), 'codex', 'model-workspace');
  const approvalMode = hostExecution ? parseApprovalMode(runtimeSetting('CODEX_APPROVAL_MODE')) || 'on-request' : 'on-request';
  const sandboxMode = hostExecution ? parseSandboxMode(runtimeSetting('CODEX_SANDBOX_MODE')) || 'workspace-write' : 'read-only';
  const effort = parseReasoningEffort(currentReasoningEffort()) || 'medium';
  const verbose = runtimeSetting("CODEX_VERBOSE") === 'true';
  const configOverrides = hostExecution ? undefined : {
    'features.shell_tool': false,
    'features.unified_exec': false,
    'features.computer_use': false,
    'features.apps': false,
    'features.multi_agent': false,
    web_search: 'disabled',
  };

  return lazyLanguageModel('codex', model, async () => {
    await mkdir(cwd, { recursive: true });
    const environment = hostExecution ? undefined : { CODEX_HOME: await prepareCodexIdentityHome('auxiliary-model', true) };
    const provider = await import('ai-sdk-provider-codex-cli');
    return (
      runtimeSetting('CODEX_TRANSPORT') === 'exec' || runtimeSetting('CODEX_PROVIDER_MODE') === 'exec'
      ? provider.createCodexCli({
          defaultSettings: {
            codexPath,
            cwd,
            env: environment,
            approvalMode,
            sandboxMode,
            reasoningEffort: effort,
            verbose,
            skipGitRepoCheck: runtimeSetting("CODEX_SKIP_GIT_REPO_CHECK") !== 'false',
            allowNpx: hostExecution && runtimeSetting('CODEX_ALLOW_NPX') === 'true',
            configOverrides,
          },
        })(model) as unknown as LoadedLanguageModel
      : provider.createCodexAppServer({
          defaultSettings: {
            codexPath,
            cwd,
            env: environment,
            approvalPolicy: approvalMode,
            sandboxPolicy: sandboxMode,
            effort,
            verbose,
            minCodexVersion: '0.144.0',
            threadMode: 'stateless',
            configOverrides,
          },
        })(model) as unknown as LoadedLanguageModel
    );
  });
}

function normalizeProvider(value: string | undefined): AiProvider {
  const provider = String(value || 'openrouter').trim().toLowerCase();
  if (provider === 'ai-gateway' || provider === 'gateway' || provider === 'vercel-ai-gateway') return 'ai-gateway';
  if (provider === 'alibaba' || provider === 'aliyun' || provider === 'dashscope') return 'alibaba';
  if (provider === 'anthropic' || provider === 'claude') return 'anthropic';
  if (provider === 'azure' || provider === 'azure-openai') return 'azure-openai';
  if (provider === 'bedrock' || provider === 'amazon-bedrock' || provider === 'aws-bedrock') return 'bedrock';
  if (provider === 'cerebras') return 'cerebras';
  if (provider === 'codex' || provider === 'codex-cli') return 'codex';
  if (provider === 'cohere') return 'cohere';
  if (provider === 'deepinfra') return 'deepinfra';
  if (provider === 'deepseek') return 'deepseek';
  if (provider === 'fireworks' || provider === 'fireworks-ai') return 'fireworks';
  if (provider === 'gemini' || provider === 'gemini-cli' || provider === 'google') return 'google';
  if (provider === 'groq') return 'groq';
  if (provider === 'huggingface' || provider === 'hugging-face') return 'huggingface';
  if (provider === 'llama-cpp' || provider === 'llamacpp' || provider === 'llama.cpp') return 'llama-cpp';
  if (provider === 'lmstudio' || provider === 'lm-studio' || provider === 'local') return 'lmstudio';
  if (provider === 'minimax') return 'minimax';
  if (provider === 'mistral' || provider === 'mistral-ai') return 'mistral';
  if (provider === 'ollama') return 'ollama';
  if (provider === 'openai') return 'openai';
  if (provider === 'openai-compatible' || provider === 'openai-compatible-1' || provider === 'openai-compatible-api' || provider === 'custom-openai' || provider === 'custom-openai-1') return 'openai-compatible';
  const compatibleMatch = provider.match(/^(?:openai-compatible|custom-openai)-(\d+)$/);
  if (compatibleMatch) {
    const index = Number.parseInt(compatibleMatch[1], 10);
    if (Number.isSafeInteger(index) && index >= 2) return `openai-compatible-${index}`;
  }
  if (provider === 'perplexity') return 'perplexity';
  if (provider === 'together' || provider === 'togetherai' || provider === 'together-ai') return 'togetherai';
  if (provider === 'vercel' || provider === 'v0') return 'vercel';
  if (provider === 'xai' || provider === 'x-ai') return 'xai';
  return 'openrouter';
}

function parseApprovalMode(value: string | undefined): ApprovalMode | undefined {
  if (value === 'never' || value === 'on-request') return value;
  return undefined;
}

function parseSandboxMode(value: string | undefined): SandboxMode | undefined {
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') return value;
  return undefined;
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  if (value === 'max') return 'xhigh';
  if (value === 'none' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  return undefined;
}
