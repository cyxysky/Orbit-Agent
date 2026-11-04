import {
  defaultModelForProvider,
  defaultModelProviderSettings,
  isModelProvider,
  modelListForProvider,
  modelProviderDefinitionsForConfig,
  normalizeMiniMaxOpenAIBaseURL,
  removeCustomModelProviders,
  type OpenAICompatibleModelProvider,
} from '@/config/settings';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import type {
  ModelConfigRecord,
  ModelProvider,
  ModelProviderSettings,
  RuntimeSettingRecord,
  SkillContent,
  SkillRecord,
} from '@/server/ai/schemas/runtime.schema';
import { normalizedModelCapabilities } from '@/lib/model-capabilities';
import { configureRuntimeModelContexts } from '@/server/ai/agents/runtime-context-budget';
import {
  DEFAULT_SENSITIVE_DATA_EVALUATION_CASES,
  normalizeSensitiveDataEvaluationCases,
  type SensitiveDataEvaluationCase,
} from '@/lib/sensitive-data-evaluation';
import {
  deleteSkillRecord,
  readConfigRecord,
  readRuntimeMeta,
  readSkillById,
  readSkillsByIds,
  readSkills,
  writeModelConfigRecord,
  patchRuntimeSettingsRecords,
  writeRuntimeMeta,
  writeSkillRecord,
  writeSkillRecords,
  writeSkillRecordsQueued,
} from '@/server/storage/database-record-store';
import { publishRuntimeConfiguration } from '@/server/settings/runtime-configuration';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


type ConfigStoreData = {
  runtimeSettings: RuntimeSettingRecord[];
  modelConfig?: ModelConfigRecord;
};

const sensitiveDataEvaluationCasesMetaKey = 'sensitive-data-evaluation-cases';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

function normalizeExtraRequestParameters(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? JSON.stringify(parsed)
      : '';
  } catch {
    return '';
  }
}

function normalizeStoredModelConfig(input?: ModelConfigRecord): ModelConfigRecord | undefined {
  if (!input) return undefined;
  const provider = isModelProvider(input.provider)
    ? input.provider
    : 'openrouter';
  const providers: Partial<Record<ModelProvider, ModelProviderSettings>> = {};
  for (const definition of modelProviderDefinitionsForConfig(input.providers)) {
    const current = input.providers?.[definition.value];
    const models = modelListForProvider(definition, current);
    const model = defaultModelForProvider(definition, current);
    const baseURL = definition.value === 'minimax'
      ? normalizeMiniMaxOpenAIBaseURL(current?.baseURL)
      : current?.baseURL;
    providers[definition.value] = {
      ...defaultModelProviderSettings(definition.value),
      ...current,
      enabled: current?.enabled === true,
      defaultModel: model,
      model,
      models,
      modelCapabilities: normalizedModelCapabilities(definition.value, models, current?.modelCapabilities),
      baseURL: baseURL ?? definition.defaultBaseURL ?? '',
      extraRequestParameters: normalizeExtraRequestParameters(current?.extraRequestParameters),
    };
  }
  const providerOrder = modelProviderDefinitionsForConfig(providers, input.providerOrder).map(({ value }) => value);
  return { provider, providers, providerOrder, mediaSelections: input.mediaSelections, updatedAt: input.updatedAt || now() };
}

function normalizeSkillItems(items: string[] | undefined, limit: number) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items || []) {
    const value = item.trim();
    const key = value.toLowerCase().replace(/\s+/g, ' ');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function normalizeSkillContent(content?: Partial<SkillContent>): SkillContent {
  return {
    details: String(content?.details || '').trim(),
    ...(content?.resources ? { resources: content.resources.map((resource) => ({ name: resource.name.trim(), content: resource.content })) } : {}),
  };
}

function normalizeSkillRecord(record: SkillRecord): SkillRecord {
  return {
    id: record.id,
    userId: normalizeApplicationUserId(record.userId),
    shared: record.shared === true,
    title: record.title,
    description: record.description,
    triggerPhrases: normalizeSkillItems(record.triggerPhrases, 8),
    content: normalizeSkillContent(record.content),
    sourceSessionId: record.sourceSessionId,
    status: record.status || 'ready',
    version: record.version || 1,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

type UpsertSkillInput = {
  id?: string;
  title: string;
  description: string;
  triggerPhrases?: string[];
  content: SkillContent;
  sourceSessionId?: string;
  status?: SkillRecord['status'];
  shared?: boolean;
  userId?: string | number;
};

function buildSkillRecord(input: UpsertSkillInput, existing: SkillRecord | undefined, userId: string, timestamp: string) {
  return normalizeSkillRecord({
    id: existing?.id || id('skl'),
    userId,
    shared: input.shared ?? existing?.shared ?? false,
    title: input.title.trim() || existing?.title || 'Runtime Skill',
    description: input.description.trim() || existing?.description || '',
    triggerPhrases: input.triggerPhrases || existing?.triggerPhrases || [],
    content: normalizeSkillContent(input.content),
    sourceSessionId: input.sourceSessionId || existing?.sourceSessionId,
    status: input.status || existing?.status || 'ready',
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  });
}

async function readConfigData(): Promise<ConfigStoreData> {
  const stored = await readConfigRecord() as Partial<ConfigStoreData>;
  return {
    runtimeSettings: stored.runtimeSettings || [],
    modelConfig: stored.modelConfig,
  };
}

let configurationRefresh: Promise<unknown> = Promise.resolve();
function publishSavedConfiguration() {
  const operation = configurationRefresh.then(async () => {
    const data = await readConfigData();
    const models = normalizeStoredModelConfig(data.modelConfig);
    configureRuntimeModelContexts(models?.providers);
    publishRuntimeConfiguration(data.runtimeSettings, models);
    return data.runtimeSettings;
  });
  configurationRefresh = operation.catch(() => undefined);
  return operation;
}

export const store = {
  async listSkills(
    query?: string,
    userId?: string | number,
    limit?: number,
    cursor: { beforeId?: string; beforeUpdatedAt?: string } = {},
  ) {
    return (await readSkills(normalizeApplicationUserId(userId), { ...cursor, query, limit }))
      .map(normalizeSkillRecord);
  },
  async getSkill(skillId: string, userId?: string | number) {
    const skill = await readSkillById(skillId, normalizeApplicationUserId(userId));
    return skill ? normalizeSkillRecord(skill) : undefined;
  },
  async getSkills(skillIds: string[] = [], userId?: string | number) {
    const byId = new Map((await readSkillsByIds(skillIds, normalizeApplicationUserId(userId)))
      .map(normalizeSkillRecord)
      .map((skill) => [skill.id, skill]));
    return skillIds.map((skillId) => byId.get(skillId)).filter((item): item is SkillRecord => Boolean(item));
  },
  async upsertSkill(input: UpsertSkillInput) {
    const userId = normalizeApplicationUserId(input.userId);
    const timestamp = now();
    const storedExisting = input.id ? await readSkillById(input.id) : undefined;
    if (storedExisting && normalizeApplicationUserId(storedExisting.userId) !== userId) {
      throw new CodedError(ERROR_CODES.STORAGE_OPERATION_FAILED, 'Only the Skill creator can edit this shared Skill.');
    }
    const existing = storedExisting ? normalizeSkillRecord(storedExisting) : undefined;
    const skill = buildSkillRecord(input, existing, userId, timestamp);
    await writeSkillRecord(skill, userId);
    return skill;
  },
  async upsertSkillsBatch(inputs: UpsertSkillInput[], options: { queued?: boolean } = {}) {
    const existingById = new Map((await readSkills()).map((skill) => [skill.id, normalizeSkillRecord(skill)]));
    const records = inputs.map((input) => {
      const userId = normalizeApplicationUserId(input.userId);
      const existing = input.id ? existingById.get(input.id) : undefined;
      if (existing && normalizeApplicationUserId(existing.userId) !== userId) {
        throw new CodedError(ERROR_CODES.STORAGE_OPERATION_FAILED, 'Only the Skill creator can edit this shared Skill.');
      }
      const skill = buildSkillRecord(input, existing, userId, now());
      existingById.set(skill.id, skill);
      return { skill, userId };
    });
    if (options.queued) {
      await writeSkillRecordsQueued(records);
      return records.map((item) => item.skill);
    }
    await writeSkillRecords(records);
    return records.map((item) => item.skill);
  },
  async deleteSkill(skillId: string, userId?: string | number) {
    return deleteSkillRecord(skillId, normalizeApplicationUserId(userId));
  },
  async listRuntimeSettings() {
    return (await readConfigData()).runtimeSettings;
  },
  async listSensitiveDataEvaluationCases() {
    const serialized = await readRuntimeMeta(sensitiveDataEvaluationCasesMetaKey);
    if (!serialized) return normalizeSensitiveDataEvaluationCases(DEFAULT_SENSITIVE_DATA_EVALUATION_CASES);
    try {
      const storedCases = normalizeSensitiveDataEvaluationCases(JSON.parse(serialized));
      if (storedCases.some((item) => item.id === 'default-person-name-1')) {
        return normalizeSensitiveDataEvaluationCases(DEFAULT_SENSITIVE_DATA_EVALUATION_CASES);
      }
      return storedCases.length
        ? storedCases
        : normalizeSensitiveDataEvaluationCases(DEFAULT_SENSITIVE_DATA_EVALUATION_CASES);
    } catch {
      return normalizeSensitiveDataEvaluationCases(DEFAULT_SENSITIVE_DATA_EVALUATION_CASES);
    }
  },
  async saveSensitiveDataEvaluationCases(cases: SensitiveDataEvaluationCase[]) {
    const sensitiveDataEvaluationCases = normalizeSensitiveDataEvaluationCases(cases);
    await writeRuntimeMeta(sensitiveDataEvaluationCasesMetaKey, JSON.stringify(sensitiveDataEvaluationCases));
    return sensitiveDataEvaluationCases;
  },
  async getModelConfig() {
    return normalizeStoredModelConfig((await readConfigData()).modelConfig);
  },
  async saveModelConfig(input: Pick<ModelConfigRecord, 'provider' | 'providers' | 'providerOrder' | 'mediaSelections'>, removedProviders: readonly OpenAICompatibleModelProvider[] = []) {
    const data = await readConfigData();
    const existing = normalizeStoredModelConfig(data.modelConfig);
    const providers: Partial<Record<ModelProvider, ModelProviderSettings>> = {};
    const { providerMediaSettingsSchema, mediaModelSelectionsSchema } = await import('@cjfclonedeep/capability-sdk/media/model-settings');
    const timestamp = now();
    const providerInputs = {
      ...existing?.providers,
      ...input.providers,
    };
    for (const provider of removedProviders) delete providerInputs[provider];
    const providerDefinitions = modelProviderDefinitionsForConfig(providerInputs);
    for (const definition of providerDefinitions) {
      const provider = definition.value;
      const current = input.providers[provider];
      const previous = existing?.providers[provider];
      const merged = { ...previous, ...current };
      const models = modelListForProvider(definition, merged);
      const model = defaultModelForProvider(definition, { ...merged, models });
      const baseURL = current?.baseURL ?? previous?.baseURL ?? definition.defaultBaseURL ?? '';
      providers[provider] = {
        ...defaultModelProviderSettings(provider),
        ...merged,
        media: providerMediaSettingsSchema.parse(current?.media ?? previous?.media ?? {}),
        enabled: current?.enabled ?? previous?.enabled ?? false,
        defaultModel: model,
        model,
        models,
        modelCapabilities: normalizedModelCapabilities(provider, models, merged.modelCapabilities),
        apiKey: current?.apiKey ?? previous?.apiKey ?? '',
        baseURL: provider === 'minimax'
          ? normalizeMiniMaxOpenAIBaseURL(baseURL) || ''
          : baseURL,
        extraRequestParameters: normalizeExtraRequestParameters(current?.extraRequestParameters ?? previous?.extraRequestParameters),
        updatedAt: current ? timestamp : previous?.updatedAt,
      };
    }
    const providerOrder = modelProviderDefinitionsForConfig(providers, input.providerOrder ?? existing?.providerOrder).map(({ value }) => value);
    const config = removeCustomModelProviders({ provider: input.provider, providers, providerOrder, mediaSelections: mediaModelSelectionsSchema.parse(input.mediaSelections ?? existing?.mediaSelections ?? {}), updatedAt: timestamp }, removedProviders);
    await writeModelConfigRecord(config);
    await publishSavedConfiguration();
    return config;
  },
  async saveRuntimeSettings(items: Array<Pick<RuntimeSettingRecord, 'key' | 'value' | 'enabled' | 'secret'>>) {
    const runtimeSettings = items.filter((item) => item.key.trim()).map((item) => ({
      key: item.key.trim(),
      value: item.value,
      enabled: item.enabled,
      secret: item.secret,
      updatedAt: now(),
    }));
    const saved = await patchRuntimeSettingsRecords(runtimeSettings);
    await publishSavedConfiguration();
    return saved;
  },
  async refreshRuntimeSettings() {
    const { importLegacyConfigurationOnce } = await import('@/server/settings/legacy-configuration-migration');
    await importLegacyConfigurationOnce();
    return publishSavedConfiguration();
  },
};
