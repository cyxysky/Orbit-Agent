import { mediaModelsForConfig, modelSelectionValue, modelsForProvider, parseMediaModelSelection } from '@/lib/model-selection';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { modelProviderDefinition, isModelProvider } from '@/config/settings';
import type { ModelProvider } from '@/server/ai/schemas/runtime.schema';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { store } from '@/server/db/store';
import { ApiRequestError, apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { idempotencyFingerprint, runIdempotentJson } from '@/server/http/idempotency';
import { readModelSettingsState } from '@/server/settings/settings-snapshot';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const selectionSchema = z.object({
  model: z.string().trim().min(1).max(1_000),
  provider: z.custom<ModelProvider>((value) => typeof value === 'string' && isModelProvider(value)),
}).strict();

export async function GET(request: NextRequest) {
  return apiJson(request, await readModelSettingsState());
}

export async function POST(request: NextRequest) {
  try {
    const selection = await parseJsonRequest(request, selectionSchema, { maxBytes: 8 * 1024 });
    const userId = requestApplicationUserId(request);
    return runIdempotentJson(request, {
      fingerprint: idempotencyFingerprint(selection),
      scope: 'settings.model_selection',
      userId,
    }, async () => {
      const saved = await store.getModelConfig();
      const media = parseMediaModelSelection(selection.model);
      if (media) {
        const id = modelSelectionValue(selection.provider, selection.model);
        const valid = mediaModelsForConfig(saved).models.some((model) => model.id === id && model.enabled && model.kind === media.kind);
        if (!valid) throw new ApiRequestError('所选模型不存在或尚未启用。', { status: 400 });
        await store.saveModelConfig({
          provider: saved?.provider || 'openrouter',
          providers: saved?.providers || {},
          mediaSelections: { ...saved?.mediaSelections, [media.kind]: { provider: selection.provider, model: media.id } },
        });
        await store.applyRuntimeEnv();
        return apiJson(request, { ok: true, ...await readModelSettingsState() });
      }
      const definition = modelProviderDefinition(selection.provider);
      const currentProvider = saved?.providers?.[selection.provider];
      if (currentProvider?.enabled !== true) {
        throw new ApiRequestError('该模型服务商尚未启用。', { code: 'model_provider_disabled', status: 400 });
      }
      const valid = modelsForProvider(saved, selection.provider).includes(selection.model);
      if (!valid) throw new ApiRequestError('所选模型不存在或尚未启用。', { status: 400 });
      await store.saveModelConfig({
        provider: selection.provider,
        mediaSelections: saved?.mediaSelections,
        providers: {
          ...(saved?.providers || {}),
          [selection.provider]: {
            ...currentProvider,
            enabled: true,
            baseURL: currentProvider?.baseURL ?? definition.defaultBaseURL ?? '',
            selectedModel: selection.model,
          },
        },
      });
      await store.applyRuntimeEnv();
      return apiJson(request, { ok: true, ...await readModelSettingsState() });
    });
  } catch (error) {
    return apiError(request, error, { fallback: '保存模型选择失败' });
  }
}
