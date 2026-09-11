'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TextArea } from '@heroui/react/textarea';
import { InputGroup } from '@heroui/react/input-group';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, BookOpen, Bot, Brain, Bug, ChartNoAxesCombined, ChevronDown, CircleCheck, ClipboardCheck, CodeXml, Copy, Database, Files, FolderOpen, GitBranch, ImageIcon, KeyRound, Layers, Loader2, Maximize2, MessagesSquare, Monitor, Navigation, Network, Palette, PencilLine, PlayCircle, Plug, Plus, RefreshCw, Save, ScanSearch, Search, Server, ShieldCheck, SlidersHorizontal, Terminal, Trash2, Workflow, X, type LucideIcon } from 'lucide-react';
import { CustomSelect } from '@/components/CustomSelect';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { SkillsManager } from '@/components/SkillsManager';
import {
  defaultModelForProvider,
  isOpenAICompatibleProvider,
  modelListForProvider,
  modelProviderDefinitionsForConfig,
  modelProviderDefinition,
  openAICompatibleProviderIndex,
  runtimeEnvDefinition,
  uniqueModelIds,
  type SettingsTab,
} from '@/config/settings';
import { useI18n } from '@/i18n/I18nProvider';
import { ThemeColorControl } from '@/components/ThemeColorControl';
import { LiquidGlassLoader } from '@/components/LiquidGlassLoader';
import { languageOptions } from '@/i18n/language';
import { waitForMinimumLoading } from '@/lib/minimum-loading';
import type { ModelConfigRecord, ModelProvider, ModelProviderSettings, RuntimeEnvRecord } from '@/server/ai/schemas/runtime.schema';
import { readApiJson } from '@/lib/api-client';
import { LoginAccountModal, type LoginAccountMetadata } from '@/components/LoginAccountModal';
import { DataTransferButtons } from '@/components/DataTransferButtons';
import { ManagementDataTable } from '@/components/ManagementDataTable';
import { ModelBrandIcon } from '@/components/ModelBrandIcon';
import { AppInput } from '@/components/ui/app-input';
import { AppModal } from '@/components/ui/app-modal';
import { ModelCapabilitiesModal } from '@/components/ModelCapabilitiesModal';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import {
  defaultModelCapabilities,
  modelCapabilities,
  normalizedModelCapabilities,
  type ModelCapabilities,
} from '@/lib/model-capabilities';
import {
  environmentSettingsTabs,
  environmentSettingsTabsForUser,
} from '@/components/environment-settings-model';
import {
  duplicateExtraRequestParameterKeys,
  parseExtraRequestParameterPairs,
  serializeExtraRequestParameterPairs,
  type ExtraRequestParameterPair,
} from '@/lib/extra-request-parameters';
import type { SensitiveDataEvaluationCase } from '@/lib/sensitive-data-evaluation';
import { WorkspaceSidebarArchiveRow } from '@/components/WorkspaceSidebarArchive';
import { useWorkspaceBrand } from '@/brand/WorkspaceBrandProvider';
import { ExternalIntegrationSettings } from '@/components/ExternalIntegrationSettings';
import { ModelTypeSettings } from '@/components/ModelTypeSettings';
import { builtInMediaModels, createMediaTypeSettings, normalizeProviderMediaSettings, mediaSettingFields, mediaModelTypeDefinitions, type MediaTypeSettings } from '@webpilot/capability-media/model-settings';
import { mediaModelDrivers, mediaModelDriver, type MediaModelKind, type MediaModelDriver } from '@webpilot/capability-media/models';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

export {
  environmentSettingsTabs,
  environmentSettingsTabsForUser,
  isAdministratorOnlySettingsTab,
} from '@/components/environment-settings-model';

export type EnvRow = Pick<RuntimeEnvRecord, 'key' | 'value' | 'enabled' | 'secret'> & {
  hasValue?: boolean;
  updatedAt?: string;
};

export type ModelConfig = Pick<ModelConfigRecord, 'provider' | 'providers' | 'providerOrder' | 'updatedAt'>;

function SortableProviderRow({ provider, active, label, children, onSelect }: {
  provider: ModelProvider;
  active: boolean;
  label: string;
  children: ReactNode;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: provider });
  return (
    <div
      ref={setNodeRef}
      className={`settings-provider-row${active ? ' active' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: DndCSS.Transform.toString(transform), transition }}
    >
      <button
        {...attributes}
        {...listeners}
        ref={setActivatorNodeRef}
        aria-label={t('拖拽排序：{name}', { name: label })}
        className="settings-provider-drag-handle"
        title={t('拖拽排序')}
        type="button"
      >
        <GripVertical size={16} />
      </button>
      <button
        aria-current={active ? 'true' : undefined}
        className="settings-provider-select"
        data-provider={provider}
        onClick={onSelect}
        type="button"
      >
        {children}
      </button>
    </div>
  );
}

export type EnvironmentSettingsInitialData = {
  envItems: EnvRow[];
  modelConfig: ModelConfig;
};

type PersonalMemoryScope = 'global' | 'domain';
type PersonalMemoryType = 'alias' | 'preference' | 'workflow' | 'domain_fact';
type PersonalMemoryStatus = 'active' | 'disabled';

type PersonalMemoryItem = {
  recall?: 'always' | 'relevant';
  durability?: string;
  id: string;
  userId: string;
  shared: boolean;
  scope: PersonalMemoryScope;
  domain: string;
  type: PersonalMemoryType;
  key: string;
  aliases: string[];
  value: string;
  confidence: number;
  sourceSessionId?: string;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
  status: PersonalMemoryStatus;
};

type PersonalMemoryDraft = {
  recall: 'always' | 'relevant';
  id?: string;
  userId?: string;
  shared: boolean;
  scope: PersonalMemoryScope;
  domain: string;
  type: PersonalMemoryType;
  key: string;
  aliasesText: string;
  value: string;
  status: PersonalMemoryStatus;
};

type PersonalMemoryEditorMode = 'create' | 'edit' | null;

type ExtraRequestParameterDraft = ExtraRequestParameterPair & {
  id: string;
};

type SensitiveDataTestReplacement = {
  original: string;
  placeholder: string;
  label: string;
  start: number;
  end: number;
};

type SensitiveDataTestResult = {
  text: string;
  replacements: SensitiveDataTestReplacement[];
};

type SensitiveDataEvaluationDraft = Omit<SensitiveDataEvaluationCase, 'expectedValues'> & {
  expectedValuesText: string;
};

type SensitiveDataEvaluationCaseResult = {
  id: string;
  passed: boolean;
  text: string;
  replacements: SensitiveDataTestReplacement[];
  detectedValues: string[];
  matchedValues: string[];
  missingValues: string[];
  unexpectedValues: string[];
};

type SensitiveDataEvaluationRun = {
  summary: {
    total: number;
    passed: number;
    failed: number;
    precision: number;
    recall: number;
  };
  results: SensitiveDataEvaluationCaseResult[];
};

type VisibleEnvSetting = {
  item: EnvRow;
  index: number;
  definition: ReturnType<typeof runtimeEnvDefinition>;
};

type SettingsSecondaryNavItem = {
  id: string;
  label: string;
  meta?: string;
};

// Section IDs stay stable when the displayed labels are translated.
const settingsSectionIcons: Record<string, LucideIcon> = {
  'general:appearance': Palette,
  'integration:connector': Plug,
  'integration:communication': MessagesSquare,
  'integration:data': Database,
  'sensitive:test': ScanSearch,
  'sensitive:evaluation': ClipboardCheck,
  '实时预览': PlayCircle,
  '浏览器实例': Monitor,
  '导航与诊断': Navigation,
  '浏览器 Agent': Bot,
  '浏览器调试': Bug,
  'Agent 运行时': Bot,
  '子 Agent': Network,
  '对话运行': MessagesSquare,
  '上下文管理': Layers,
  '个性化记忆': Brain,
  '工作流程': Workflow,
  '代码沙箱': CodeXml,
  '计算机': Monitor,
  '文件能力': Files,
  '数据与文件': Database,
  'Git': GitBranch,
  '知识库': BookOpen,
  '媒体': ImageIcon,
  '图表': ChartNoAxesCombined,
  '地图': Navigation,
  '脱敏策略': ShieldCheck,
  '脱敏模型': Brain,
  '推理服务': Server,
  'Codex CLI': Terminal,
  '调试与追踪': Bug,
};

const customRuntimeSettingKeys = new Set(['AGENT_COMMUNICATION_ALLOW_SEND', 'AGENT_DATA_ALLOW_WRITES']);
const integrationSettingsSections: Record<string, string> = {
  '连接器': 'integration:connector',
  '通信': 'integration:communication',
  '数据': 'integration:data',
};
const browserRuntimeGroups = new Set(['浏览器 Agent']);
const capabilityRuntimeGroups = new Set(['代码沙箱', '计算机', '文件能力', 'Git', '知识库', '媒体', '地图', '数据与文件', ...Object.keys(integrationSettingsSections)]);

function SettingsSecondaryNav({
  activeId,
  items,
  label,
  onChange,
}: {
  activeId: string;
  items: SettingsSecondaryNavItem[];
  label: string;
  onChange: (id: string) => void;
}) {
  return (
    <aside className="settings-secondary-nav">
      <span className="settings-secondary-nav-label">{label}</span>
      <nav aria-label={label}>
        {items.map((item) => {
          const Icon = settingsSectionIcons[item.id] || SlidersHorizontal;
          return (
            <button
              aria-current={activeId === item.id ? 'page' : undefined}
              className={activeId === item.id ? 'active' : undefined}
              key={item.id}
              onClick={() => onChange(item.id)}
              type="button"
            >
              <Icon aria-hidden="true" size={16} />
              <span>{item.label}</span>
              {item.meta ? <small>{item.meta}</small> : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function SettingsGroupCard({
  children,
  className = '',
  description,
  forceOpen = false,
  initiallyOpen = true,
  meta,
  title,
}: {
  children: ReactNode;
  className?: string;
  description?: string;
  forceOpen?: boolean;
  initiallyOpen?: boolean;
  meta?: string;
  title: string;
}) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  useEffect(() => {
    if (forceOpen) setExpanded(true);
  }, [forceOpen]);
  return (
    <div className={`settings-group-card${expanded ? ' is-expanded' : ''}${className ? ` ${className}` : ''}`}>
      <button
        aria-expanded={expanded}
        className="settings-group-card-head"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="settings-group-card-title">
          <h3>{title}</h3>
          {description ? <small>{description}</small> : null}
        </span>
        <span className="settings-group-card-summary">
          {meta ? <small>{meta}</small> : null}
          <ChevronDown aria-hidden="true" size={17} />
        </span>
      </button>
      <div
        aria-hidden={!expanded}
        className="settings-group-card-body-frame"
        inert={expanded ? undefined : true}
      >
        <div className="settings-group-card-body">{children}</div>
      </div>
    </div>
  );
}

function runtimeSettingGroup(tab: SettingsTab, key: string, configuredGroup?: string) {
  if (configuredGroup) return configuredGroup;
  if (tab === 'browser') {
    if (/^BROWSER_(?:PREVIEW|SCREENCAST|OUTPUT)/.test(key)) return '实时预览';
    if (/^(?:ELECTRON_|HEADLESS_|BROWSER_(?:PROFILE|USER_BROWSER|VIEWPORT))/.test(key)) return '浏览器实例';
    return '导航与诊断';
  }
  if (tab === 'sensitive-data') {
    if (/^AI_SENSITIVE_DATA_FILTER_/.test(key)) return '脱敏策略';
    if (/^GLINER_(?:MODEL|PII_MODEL)$/.test(key)) return '脱敏模型';
    return '推理服务';
  }
  if (tab === 'runtime') {
    if (/^(?:SQLITE_|OFFICE_)/.test(key)) return '数据与文件';
    if (/^AI_SUBAGENT_/.test(key)) return '子 Agent';
    if (/^BROWSER_CHAT_/.test(key)) return '对话运行';
    if (/^AI_PERSONAL_MEMORY_/.test(key)) return '个性化记忆';
    if (/^AI_(?:CONTEXT|GLM_CONTEXT|IMAGE_CONTEXT|VISUAL_)/.test(key)) return '上下文管理';
    return 'Agent 运行时';
  }
  return '配置';
}

function groupVisibleEnvSettings(tab: SettingsTab, settings: VisibleEnvSetting[]) {
  const groups = new Map<string, VisibleEnvSetting[]>();
  for (const setting of settings) {
    const title = normalizeSettingsGroupTitle(tab, runtimeSettingGroup(tab, setting.item.key, setting.definition?.group));
    const group = groups.get(title) || [];
    group.push(setting);
    groups.set(title, group);
  }
  return [...groups.entries()].map(([title, items]) => ({ title, items }));
}

function normalizeSettingsGroupTitle(tab: SettingsTab, title: string) {
  if (tab === 'runtime' && title === '工作流程（高级）') return '工作流程';
  return title;
}

function envSettingDisplayTab(setting: VisibleEnvSetting): SettingsTab {
  const sourceTab = setting.definition?.tab;
  const group = runtimeSettingGroup(sourceTab || 'runtime', setting.item.key, setting.definition?.group);
  if (sourceTab === 'runtime' && browserRuntimeGroups.has(group)) return 'browser';
  if (sourceTab === 'runtime' && capabilityRuntimeGroups.has(group)) return 'capabilities';
  if (sourceTab === 'runtime' && group === '个性化记忆') return 'memory';
  return sourceTab || 'runtime';
}

function envSettingSectionId(setting: VisibleEnvSetting) {
  const tab = envSettingDisplayTab(setting);
  const group = normalizeSettingsGroupTitle(tab, runtimeSettingGroup(tab, setting.item.key, setting.definition?.group));
  return integrationSettingsSections[group] || group;
}

function envSettingIsContextuallyVisible(setting: VisibleEnvSetting, values: Map<string, string>) {
  if (setting.item.key === 'BROWSER_SCREENCAST_QUALITY') return values.get('BROWSER_SCREENCAST_FORMAT') === 'jpeg';
  if (setting.item.key.startsWith('BROWSER_PREVIEW_VIDEO_')) return values.get('BROWSER_PREVIEW_TRANSPORT') === 'video';
  if (setting.item.key === 'BROWSER_VIEWPORT_WIDTH' || setting.item.key === 'BROWSER_VIEWPORT_HEIGHT') {
    return values.get('BROWSER_VIEWPORT_MODE') === 'fixed';
  }
  if (setting.item.key === 'GLINER_SERVICE_URL' || setting.item.key === 'GLINER_SERVICE_API_KEY') {
    return values.get('GLINER_RUNTIME_MODE') === 'external';
  }
  return true;
}

function envItemsFingerprint(items: EnvRow[]) {
  return JSON.stringify(items.map(({ key, value, enabled, secret }) => ({ key, value, enabled, secret })));
}

function displayDefaultValue(key: string, value: string, t: (value: string, params?: Record<string, string | number>) => string) {
  if (!value) return t('未设置');
  if (key.endsWith('_MS') && Number.isFinite(Number(value))) {
    const milliseconds = Number(value);
    if (milliseconds >= 60_000 && milliseconds % 60_000 === 0) return t('{count} 分钟', { count: milliseconds / 60_000 });
    if (milliseconds >= 1_000 && milliseconds % 1_000 === 0) return t('{count} 秒', { count: milliseconds / 1_000 });
    return t('{count} 毫秒', { count: milliseconds });
  }
  return value;
}

type SystemBridge = {
  cancelDownload?: (input: { id: string }) => Promise<{ ok: boolean; error?: string }>;
  chooseDownloadDirectory?: (input?: { defaultPath?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  downloadUrl?: (input: { defaultPath?: string; fileName?: string; url: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  getDownloads?: () => Promise<{ ok: boolean; directory?: string; downloads?: Array<{ completedAt?: number; error?: string; fileName?: string; id: string; path?: string; progress?: number; receivedBytes?: number; startedAt?: number; status?: string; totalBytes?: number; updatedAt?: number; url?: string }>; error?: string }>;
  onDownloadProgress?: (listener: (payload: { completedAt?: number; error?: string; fileName?: string; id: string; path?: string; progress?: number; receivedBytes?: number; startedAt?: number; status?: string; totalBytes?: number; updatedAt?: number; url?: string }) => void) => () => void;
  onDownloadRemoved?: (listener: (payload: { id: string }) => void) => () => void;
  openDownload?: (input: { id: string }) => Promise<{ ok: boolean; error?: string }>;
  readDownload?: (input: { id: string }) => Promise<{ ok: boolean; data?: ArrayBuffer; fileName?: string; error?: string }>;
  removeDownload?: (input: { id: string }) => Promise<{ ok: boolean; error?: string }>;
  selectFile?: (input?: { defaultPath?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  selectDirectory: (input?: { defaultPath?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  showDownloadInFolder?: (input: { id: string }) => Promise<{ ok: boolean; error?: string }>;
};

declare global {
  interface Window {
    webPilotSystem?: SystemBridge;
  }
}

const personalMemoryScopeOptions: Array<{ label: string; value: PersonalMemoryScope }> = [
  { label: '全局', value: 'global' },
  { label: '按域名', value: 'domain' },
];

const personalMemoryTypeOptions: Array<{ label: string; value: PersonalMemoryType }> = [
  { label: '短语别名', value: 'alias' },
  { label: '使用偏好', value: 'preference' },
  { label: '工作流程', value: 'workflow' },
  { label: '域名事实', value: 'domain_fact' },
];

function createPersonalMemoryDraft(): PersonalMemoryDraft {
  return {
    recall: 'relevant',
    shared: false,
    scope: 'global',
    domain: '',
    type: 'alias',
    key: '',
    aliasesText: '',
    value: '',
    status: 'active',
  };
}

function personalMemoryDraftFromItem(item: PersonalMemoryItem): PersonalMemoryDraft {
  return {
    recall: item.recall || (item.durability === 'explicit_preference' ? 'always' : 'relevant'),
    id: item.id,
    userId: item.userId,
    shared: item.shared,
    scope: item.scope,
    domain: item.domain || '',
    type: item.type,
    key: item.key,
    aliasesText: (item.aliases || []).join(', '),
    value: item.value,
    status: item.status,
  };
}

function personalMemoryAliasesFromText(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function personalMemoryTypeLabel(type: PersonalMemoryType) {
  return personalMemoryTypeOptions.find((option) => option.value === type)?.label || type;
}

function sortPersonalMemoryItems(items: PersonalMemoryItem[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function personalMemoryItemApiPath(item: Pick<PersonalMemoryItem, 'id'>) {
  return withWebPilotBasePath(`/api/personal-memory/${encodeURIComponent(item.id)}`);
}

function personalMemoryDraftApiPath(draft: PersonalMemoryDraft) {
  if (!draft.id) return withWebPilotBasePath('/api/personal-memory');
  return withWebPilotBasePath(`/api/personal-memory/${encodeURIComponent(draft.id)}`);
}

function reconcileSavedModelDraft(draft: ModelConfig, saved: ModelConfig): ModelConfig {
  const providers = { ...saved.providers };
  for (const provider of Object.keys(providers) as ModelProvider[]) {
    const savedSettings = providers[provider];
    const draftSettings = draft.providers[provider];
    if (!savedSettings) continue;
    providers[provider] = {
      ...savedSettings,
      models: draftSettings?.models ?? savedSettings.models,
      media: draftSettings?.media ?? savedSettings.media,
    };
  }
  return { ...saved, providers };
}

function createModelConfig(input?: Partial<ModelConfig>): ModelConfig {
  const providers: Partial<Record<ModelProvider, ModelProviderSettings>> = {};
  for (const definition of modelProviderDefinitionsForConfig(input?.providers)) {
    const current = input?.providers?.[definition.value];
    const models = modelListForProvider(definition, current);
    const model = defaultModelForProvider(definition, { ...current, models });
    providers[definition.value] = {
      media: normalizeProviderMediaSettings(current?.media),
      selectedModel: current?.selectedModel,
      displayName: current?.displayName || '',
      enabled: current?.enabled === true,
      defaultModel: model,
      model,
      models,
      modelCapabilities: normalizedModelCapabilities(definition.value, models, current?.modelCapabilities),
      apiKey: current?.apiKey || '',
      hasApiKey: Boolean(current?.hasApiKey || current?.apiKey),
      baseURL: current?.baseURL ?? definition.defaultBaseURL ?? '',
      extraRequestParameters: current?.extraRequestParameters || '',
      updatedAt: current?.updatedAt,
    };
  }
  return {
    provider: input?.provider || 'openrouter',
    providers,
    providerOrder: modelProviderDefinitionsForConfig(providers, input?.providerOrder).map(({ value }) => value),
    updatedAt: input?.updatedAt || '',
  };
}

function providerSettings(config: ModelConfig, provider: ModelProvider) {
  const definition = modelProviderDefinition(provider);
  return config.providers[provider] || {
    displayName: '',
    enabled: false,
    defaultModel: definition.defaultModel,
    model: definition.defaultModel,
    models: modelListForProvider(definition),
    modelCapabilities: normalizedModelCapabilities(definition.value, modelListForProvider(definition)),
    apiKey: '',
    baseURL: definition.defaultBaseURL || '',
    extraRequestParameters: '',
  };
}

function extraRequestParameterDrafts(config: ModelConfig) {
  const drafts: Partial<Record<ModelProvider, ExtraRequestParameterDraft[]>> = {};
  for (const definition of modelProviderDefinitionsForConfig(config.providers)) {
    drafts[definition.value] = parseExtraRequestParameterPairs(
      providerSettings(config, definition.value).extraRequestParameters,
    ).map((pair, index) => ({
      ...pair,
      id: `${definition.value}:${index}:${pair.key}`,
    }));
  }
  return drafts;
}

function sensitiveDataEvaluationDrafts(cases: SensitiveDataEvaluationCase[] = []): SensitiveDataEvaluationDraft[] {
  return cases.map((item) => ({
    id: item.id,
    name: item.name,
    text: item.text,
    expectedValuesText: item.expectedValues.join('\n'),
  }));
}

function sensitiveDataEvaluationPayload(cases: SensitiveDataEvaluationDraft[]): SensitiveDataEvaluationCase[] {
  return cases.map((item) => ({
    id: item.id,
    name: item.name.trim(),
    text: item.text,
    expectedValues: [...new Set(item.expectedValuesText
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean))],
  }));
}

function draftModelRows(definition: ReturnType<typeof modelProviderDefinition>, settings: ModelProviderSettings) {
  return Array.isArray(settings.models) && settings.models.length
    ? settings.models
    : uniqueModelIds([settings.defaultModel, settings.model]).filter((model) => !(
      definition.value.startsWith('openai-compatible')
      && model === 'custom-model'
    ));
}

type SensitiveEvaluationTagStatus = 'pending' | 'matched' | 'missing' | 'unexpected';

function canonicalSensitiveValue(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function highlightedSensitiveText(
  text: string,
  values: string[],
): ReactNode[] {
  const matches = values
    .flatMap((value) => {
      const occurrences: Array<{ start: number; end: number; value: string }> = [];
      let cursor = 0;
      while (value && cursor < text.length) {
        const start = text.indexOf(value, cursor);
        if (start < 0) break;
        occurrences.push({ start, end: start + value.length, value });
        cursor = start + value.length;
      }
      return occurrences;
    })
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((match, index, matches) => index === 0 || match.start >= matches[index - 1].end);
  if (!matches.length) return [text];
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) output.push(text.slice(cursor, match.start));
    output.push(
      <mark key={`${match.start}:${match.value}`}>
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

function sensitiveEvaluationTagStatus(
  value: string,
  result?: SensitiveDataEvaluationCaseResult,
): SensitiveEvaluationTagStatus {
  if (!result) return 'pending';
  const key = canonicalSensitiveValue(value);
  if (result.unexpectedValues.some((item) => canonicalSensitiveValue(item) === key)) return 'unexpected';
  if (result.missingValues.some((item) => canonicalSensitiveValue(item) === key)) return 'missing';
  if (result.matchedValues.some((item) => canonicalSensitiveValue(item) === key)) return 'matched';
  return 'pending';
}

function evaluationCaseDisplayName(name: string, index: number, t: (value: string, params?: Record<string, string | number>) => string) {
  return name.trim().replace(/^综合业务场景\s*[·・]\s*/, '') || t('用例 {index}', { index: index + 1 });
}

function isSecret(item: EnvRow) {
  return Boolean(item.secret || runtimeEnvDefinition(item.key)?.secret || /KEY|TOKEN|SECRET|PASSWORD|COOKIE|DATABASE_URL/i.test(item.key));
}

export function EnvironmentSettings({
  activeTab: controlledActiveTab,
  adminSettingsAccessToken = '',
  adminSettingsPasswordRequired = false,
  defaultUserId = '1',
  embedded = false,
  initialData,
  onActiveTabChange,
  onModelSaved,
  onRuntimeEnvSaved,
  onSkillsChanged,
  personalMemoryRefreshToken = '',
  showSectionTitles = true,
  showTabs = true,
  userId,
}: {
  activeTab?: SettingsTab;
  adminSettingsAccessToken?: string;
  adminSettingsPasswordRequired?: boolean;
  defaultUserId?: string;
  embedded?: boolean;
  initialData?: EnvironmentSettingsInitialData;
  onActiveTabChange?: (tab: SettingsTab) => void;
  onModelSaved?: () => void;
  onRuntimeEnvSaved?: () => void;
  onSkillsChanged?: () => void;
  personalMemoryRefreshToken?: string;
  showSectionTitles?: boolean;
  showTabs?: boolean;
  userId?: string;
} = {}) {
  const shouldLoadEnvironmentConfig = !controlledActiveTab
    || !['skills', 'memory', 'accounts'].includes(controlledActiveTab);
  const { language, setLanguage, t } = useI18n();
  const { brandPrefix, brandText, setBrandPrefix, setBrandText } = useWorkspaceBrand();
  const [internalActiveTab, setInternalActiveTab] = useState<SettingsTab>('general');
  const [items, setItems] = useState<EnvRow[]>(() => initialData?.envItems || []);
  const [savedItems, setSavedItems] = useState<EnvRow[]>(() => initialData?.envItems || []);
  const itemsRef = useRef(items);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => createModelConfig(initialData?.modelConfig));
  const [modelDraft, setModelDraft] = useState<ModelConfig>(() => createModelConfig(initialData?.modelConfig));
  const [modelKind, setModelKind] = useState<'language' | MediaModelKind>('language');
  const [modelCapabilitiesEditor, setModelCapabilitiesEditor] = useState<{ provider: ModelProvider; model: string } | null>(null);
  const [selectedModelProvider, setSelectedModelProvider] = useState<ModelProvider>(() => (
    createModelConfig(initialData?.modelConfig).provider
  ));
  const providerListRef = useRef<HTMLDivElement>(null);
  const providerDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [extraRequestParameterRows, setExtraRequestParameterRows] = useState<Partial<Record<ModelProvider, ExtraRequestParameterDraft[]>>>(() => (
    extraRequestParameterDrafts(createModelConfig(initialData?.modelConfig))
  ));
  const extraRequestParameterIdRef = useRef(0);
  const [personalMemoryItems, setPersonalMemoryItems] = useState<PersonalMemoryItem[]>([]);
  const [personalMemoryDraft, setPersonalMemoryDraft] = useState<PersonalMemoryDraft>(() => createPersonalMemoryDraft());
  const [personalMemoryEditorMode, setPersonalMemoryEditorMode] = useState<PersonalMemoryEditorMode>(null);
  const [loginAccounts, setLoginAccounts] = useState<LoginAccountMetadata[]>([]);
  const [loginAccountEditor, setLoginAccountEditor] = useState<LoginAccountMetadata | 'create' | null>(null);
  const [loadingLoginAccounts, setLoadingLoginAccounts] = useState(false);
  const loginAccountsLoadSequenceRef = useRef(0);
  const [deletingLoginAccountId, setDeletingLoginAccountId] = useState('');
  const [deleteLoginAccountTarget, setDeleteLoginAccountTarget] = useState<LoginAccountMetadata | null>(null);
  const [deleteLoginAccountError, setDeleteLoginAccountError] = useState('');
  const [loading, setLoading] = useState(!initialData && shouldLoadEnvironmentConfig && (!adminSettingsPasswordRequired || Boolean(adminSettingsAccessToken)));
  const [savingEnv, setSavingEnv] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [envAutoSaveError, setEnvAutoSaveError] = useState('');
  const [modelAutoSaveError, setModelAutoSaveError] = useState('');
  const envFailedFingerprintRef = useRef('');
  const modelFailedFingerprintRef = useRef('');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [settingsSearchFocused, setSettingsSearchFocused] = useState(false);
  const [highlightedSettingKey, setHighlightedSettingKey] = useState('');
  const [activeSettingsSections, setActiveSettingsSections] = useState<Partial<Record<SettingsTab, string>>>({});
  const [sensitiveDataTestInput, setSensitiveDataTestInput] = useState('');
  const [sensitiveDataTestResult, setSensitiveDataTestResult] = useState<SensitiveDataTestResult | null>(null);
  const [sensitiveDataTestError, setSensitiveDataTestError] = useState('');
  const [testingSensitiveData, setTestingSensitiveData] = useState(false);
  const [sensitiveDataEvaluationCases, setSensitiveDataEvaluationCases] = useState<SensitiveDataEvaluationDraft[]>([]);
  const [savedSensitiveDataEvaluationCases, setSavedSensitiveDataEvaluationCases] = useState<SensitiveDataEvaluationDraft[]>([]);
  const sensitiveDataEvaluationCasesRef = useRef(sensitiveDataEvaluationCases);
  const sensitiveDataEvaluationFailedFingerprintRef = useRef('');
  const [sensitiveDataEvaluationRun, setSensitiveDataEvaluationRun] = useState<SensitiveDataEvaluationRun | null>(null);
  const [selectedSensitiveDataEvaluationCaseId, setSelectedSensitiveDataEvaluationCaseId] = useState('');
  const [sensitiveDataEvaluationSearch, setSensitiveDataEvaluationSearch] = useState('');
  const [sensitiveDataEvaluationExpanded, setSensitiveDataEvaluationExpanded] = useState(false);
  const [sensitiveDataEvaluationNewExpectedValue, setSensitiveDataEvaluationNewExpectedValue] = useState('');
  const [sensitiveDataEvaluationError, setSensitiveDataEvaluationError] = useState('');
  const [sensitiveDataEvaluationLoaded, setSensitiveDataEvaluationLoaded] = useState(false);
  const [loadingSensitiveDataEvaluation, setLoadingSensitiveDataEvaluation] = useState(false);
  const [savingSensitiveDataEvaluation, setSavingSensitiveDataEvaluation] = useState(false);
  const [runningSensitiveDataEvaluation, setRunningSensitiveDataEvaluation] = useState(false);
  const sensitiveDataEvaluationIdRef = useRef(0);
  const [loadingPersonalMemory, setLoadingPersonalMemory] = useState(false);
  const personalMemoryLoadSequenceRef = useRef(0);
  const [savingPersonalMemory, setSavingPersonalMemory] = useState(false);
  const [updatingPersonalMemoryId, setUpdatingPersonalMemoryId] = useState('');
  const [deletingPersonalMemoryId, setDeletingPersonalMemoryId] = useState('');
  const [deletePersonalMemoryTarget, setDeletePersonalMemoryTarget] = useState<PersonalMemoryItem | null>(null);
  const [deletePersonalMemoryError, setDeletePersonalMemoryError] = useState('');
  const [hasDirectoryPicker, setHasDirectoryPicker] = useState(false);
  const normalizedDefaultUserId = defaultUserId.trim() || '1';
  const normalizedUserId = userId?.trim() || normalizedDefaultUserId;
  const visibleSettingsTabs = environmentSettingsTabsForUser(normalizedUserId, normalizedDefaultUserId);
  const requestedActiveTab = controlledActiveTab || internalActiveTab;
  const standaloneManagementTab = !showTabs && ['skills', 'memory', 'accounts'].includes(requestedActiveTab);
  const activeTab = standaloneManagementTab || visibleSettingsTabs.some((tab) => tab.id === requestedActiveTab) ? requestedActiveTab : 'general';
  const adminSettingsAuthorizationHeaders: Record<string, string> = adminSettingsAccessToken
    ? { Authorization: `Bearer ${adminSettingsAccessToken}` }
    : {};
  const selectTab = (tab: SettingsTab) => {
    if (!visibleSettingsTabs.some((item) => item.id === tab)) return;
    (onActiveTabChange || setInternalActiveTab)(tab);
  };
  itemsRef.current = items;
  sensitiveDataEvaluationCasesRef.current = sensitiveDataEvaluationCases;

  function optionLabel(option: { label: string; value: string }) {
    if (option.label === '关闭' && option.value === 'false') return language === 'en' ? 'Off' : '关闭';
    return t(option.label);
  }

  useEffect(() => {
    setHasDirectoryPicker(typeof window !== 'undefined' && Boolean(window.webPilotSystem?.selectDirectory));
    if (!initialData && shouldLoadEnvironmentConfig && (!adminSettingsPasswordRequired || adminSettingsAccessToken)) void load();
    else setLoading(false);
  // The server snapshot is immutable for this component instance; saves update local state directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSettingsAccessToken, adminSettingsPasswordRequired]);

  useEffect(() => {
    if (
      activeTab !== 'sensitive-data'
      || sensitiveDataEvaluationLoaded
      || (adminSettingsPasswordRequired && !adminSettingsAccessToken)
    ) return;
    const controller = new AbortController();
    setLoadingSensitiveDataEvaluation(true);
    setSensitiveDataEvaluationError('');
    void (async () => {
      try {
        const response = await fetch(withWebPilotBasePath('/api/settings/sensitive-data-evaluation'), {
          cache: 'no-store',
          headers: adminSettingsAccessToken ? { Authorization: `Bearer ${adminSettingsAccessToken}` } : {},
          signal: controller.signal,
        });
        const data = await readApiJson<{ cases?: SensitiveDataEvaluationCase[] }>(response, '读取脱敏评测集失败');
        if (controller.signal.aborted) return;
        const drafts = sensitiveDataEvaluationDrafts(data.cases);
        setSensitiveDataEvaluationCases(drafts);
        setSavedSensitiveDataEvaluationCases(drafts);
        setSelectedSensitiveDataEvaluationCaseId((current) => drafts.some((item) => item.id === current) ? current : drafts[0]?.id || '');
        setSensitiveDataEvaluationLoaded(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSensitiveDataEvaluationError(error instanceof Error ? t(error.message) : t('读取脱敏评测集失败'));
      } finally {
        if (!controller.signal.aborted) setLoadingSensitiveDataEvaluation(false);
      }
    })();
    return () => controller.abort();
  // Loading is intentionally keyed to the selected tab and admin access grant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminSettingsAccessToken, adminSettingsPasswordRequired]);

  useEffect(() => {
    if (!highlightedSettingKey) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-setting-key="${CSS.escape(highlightedSettingKey)}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    });
    const timeout = window.setTimeout(() => setHighlightedSettingKey(''), 2400);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [activeTab, highlightedSettingKey]);

  async function load() {
    setLoading(true);
    try {
      const [envResponse, modelResponse] = await Promise.all([
        fetch(withWebPilotBasePath('/api/settings/env'), { cache: 'no-store', headers: adminSettingsAuthorizationHeaders }),
        fetch(withWebPilotBasePath('/api/settings/model'), { cache: 'no-store', headers: adminSettingsAuthorizationHeaders }),
      ]);
      const envData = await readApiJson<{ saved?: EnvRow[] }>(envResponse, t('读取环境配置失败'));
      const modelData = await readApiJson<{ config?: Partial<ModelConfig> }>(modelResponse, t('读取模型配置失败'));
      const nextModel = createModelConfig(modelData.config);
      setItems(envData.saved || []);
      setSavedItems(envData.saved || []);
      setModelConfig(nextModel);
      setModelDraft(nextModel);
      setSelectedModelProvider(nextModel.provider);
      setExtraRequestParameterRows(extraRequestParameterDrafts(nextModel));
    } finally {
      setLoading(false);
    }
  }

  function update(index: number, patch: Partial<EnvRow>) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, enabled: true, ...patch } : item)));
  }

  async function chooseRuntimeDirectory(index: number, item: EnvRow) {
    const bridge = typeof window !== 'undefined' ? window.webPilotSystem : undefined;
    if (!bridge?.selectDirectory) return;
    const result = await bridge.selectDirectory({ defaultPath: item.value || undefined });
    if (result.ok && result.path) {
      update(index, { value: result.path });
    } else if (!result.ok && result.error) {
      window.alert(t(result.error));
    }
  }

  async function saveEnv() {
    const sourceFingerprint = envItemsFingerprint(items);
    setSavingEnv(true);
    setEnvAutoSaveError('');
    try {
      const response = await fetch(withWebPilotBasePath('/api/settings/env'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminSettingsAuthorizationHeaders },
        body: JSON.stringify({ items: items.map((item) => ({ ...item, enabled: true, secret: isSecret(item) })) }),
      });
      const data = await readApiJson<{ saved?: EnvRow[] }>(response, t('保存环境配置失败'));
      const saved = data.saved || [];
      envFailedFingerprintRef.current = '';
      setSavedItems(saved);
      if (envItemsFingerprint(itemsRef.current) === sourceFingerprint) setItems(saved);
      onRuntimeEnvSaved?.();
    } catch (error) {
      envFailedFingerprintRef.current = sourceFingerprint;
      setEnvAutoSaveError(error instanceof Error ? t(error.message) : t('保存环境配置失败'));
      throw error;
    } finally {
      setSavingEnv(false);
    }
  }

  function selectProvider(provider: ModelProvider) {
    setSelectedModelProvider(provider);
  }

  function reorderProviders({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    setModelDraft((current) => {
      const order = modelProviderDefinitionsForConfig(current.providers, current.providerOrder).map(({ value }) => value);
      const from = order.indexOf(active.id as ModelProvider);
      const to = order.indexOf(over.id as ModelProvider);
      if (from < 0 || to < 0) return current;
      return { ...current, providerOrder: arrayMove(order, from, to) };
    });
  }

  function selectDefaultProvider(provider: ModelProvider) {
    setModelDraft((current) => ({
      ...createModelConfig(current),
      provider,
    }));
  }

  function updateActiveProviderSettings(patch: Partial<ModelProviderSettings>) {
    setModelDraft((current) => {
      const next = {
        ...current,
        providers: { ...current.providers },
      };
      const provider = selectedModelProvider;
      return {
        ...next,
        providers: {
          ...next.providers,
          [provider]: {
            ...providerSettings(next, provider),
            ...patch,
          },
        },
      };
    });
  }

  async function runSensitiveDataTest() {
    if (!sensitiveDataTestInput.trim() || testingSensitiveData) return;
    setTestingSensitiveData(true);
    setSensitiveDataTestError('');
    try {
      const response = await fetch(withWebPilotBasePath('/api/settings/sensitive-data-test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminSettingsAuthorizationHeaders },
        body: JSON.stringify({ text: sensitiveDataTestInput }),
      });
      const data = await readApiJson<SensitiveDataTestResult>(response, t('敏感数据过滤测试失败'));
      setSensitiveDataTestResult({
        text: String(data.text || ''),
        replacements: Array.isArray(data.replacements) ? data.replacements : [],
      });
    } catch (error) {
      setSensitiveDataTestResult(null);
      setSensitiveDataTestError(error instanceof Error ? t(error.message) : t('敏感数据过滤测试失败'));
    } finally {
      setTestingSensitiveData(false);
    }
  }

  function addSensitiveDataEvaluationCase() {
    const id = `evaluation:${Date.now()}:${sensitiveDataEvaluationIdRef.current++}`;
    setSensitiveDataEvaluationCases((current) => [...current, {
      id,
      name: '',
      text: '',
      expectedValuesText: '',
    }]);
    setSelectedSensitiveDataEvaluationCaseId(id);
    setSensitiveDataEvaluationRun(null);
    setSensitiveDataEvaluationError('');
  }

  function updateSensitiveDataEvaluationCase(id: string, patch: Partial<SensitiveDataEvaluationDraft>) {
    setSensitiveDataEvaluationCases((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    setSensitiveDataEvaluationRun(null);
    setSensitiveDataEvaluationError('');
  }

  function removeSensitiveDataEvaluationCase(id: string) {
    setSensitiveDataEvaluationCases((current) => {
      const next = current.filter((item) => item.id !== id);
      setSelectedSensitiveDataEvaluationCaseId((selected) => selected === id ? next[0]?.id || '' : selected);
      return next;
    });
    setSensitiveDataEvaluationRun(null);
    setSensitiveDataEvaluationError('');
  }

  function addOpenAICompatibleProvider() {
    const next = createModelConfig(modelDraft);
    const compatibleDefinitions = modelProviderDefinitionsForConfig(next.providers)
      .filter((definition) => isOpenAICompatibleProvider(definition.value));
    const availableDefinition = compatibleDefinitions.find((definition) => {
      const settings = providerSettings(next, definition.value);
      return !settings.enabled
        && !settings.displayName?.trim()
        && !settings.apiKey
        && !settings.hasApiKey
        && !settings.baseURL;
    });
    const sequence = availableDefinition
      ? openAICompatibleProviderIndex(availableDefinition.value) || 1
      : Math.max(0, ...compatibleDefinitions.map((definition) => openAICompatibleProviderIndex(definition.value) || 0)) + 1;
    const provider = availableDefinition?.value
      || `openai-compatible-${sequence}` as ModelProvider;
    setModelDraft({
      ...next,
      providers: {
        ...next.providers,
        [provider]: {
          ...providerSettings(next, provider),
          displayName: t('OpenAI 兼容供应商 {index}', { index: sequence }),
          enabled: true,
        },
      },
    });
    setSelectedModelProvider(provider);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        providerListRef.current
          ?.querySelector<HTMLButtonElement>(`button[data-provider="${provider}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }

  function addSensitiveDataEvaluationExpectedValue(caseId: string) {
    const value = sensitiveDataEvaluationNewExpectedValue.trim();
    if (!value) return;
    const target = sensitiveDataEvaluationCases.find((item) => item.id === caseId);
    if (!target) return;
    const values = target.expectedValuesText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const valueKey = canonicalSensitiveValue(value);
    if (!values.some((item) => canonicalSensitiveValue(item) === valueKey)) values.push(value);
    updateSensitiveDataEvaluationCase(caseId, {
      expectedValuesText: values.join('\n'),
    });
    setSensitiveDataEvaluationNewExpectedValue('');
  }

  function removeSensitiveDataEvaluationExpectedValue(caseId: string, value: string) {
    const target = sensitiveDataEvaluationCases.find((item) => item.id === caseId);
    if (!target) return;
    const values = target.expectedValuesText.split(/\r?\n/).map((item) => item.trim()).filter((item) => item && item !== value);
    updateSensitiveDataEvaluationCase(caseId, { expectedValuesText: values.join('\n') });
  }

  function validSensitiveDataEvaluationPayload() {
    if (sensitiveDataEvaluationCases.some((item) => !item.text.trim())) {
      setSensitiveDataEvaluationError(t('评测用例文本不能为空。'));
      return null;
    }
    return sensitiveDataEvaluationPayload(sensitiveDataEvaluationCases);
  }

  async function saveSensitiveDataEvaluationCases() {
    if (savingSensitiveDataEvaluation) return;
    const cases = validSensitiveDataEvaluationPayload();
    if (!cases) return;
    const sourceFingerprint = JSON.stringify(cases);
    setSavingSensitiveDataEvaluation(true);
    setSensitiveDataEvaluationError('');
    try {
      const response = await fetch(withWebPilotBasePath('/api/settings/sensitive-data-evaluation'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...adminSettingsAuthorizationHeaders },
        body: JSON.stringify({ cases }),
      });
      const data = await readApiJson<{ cases?: SensitiveDataEvaluationCase[] }>(response, t('保存脱敏评测集失败'));
      const drafts = sensitiveDataEvaluationDrafts(data.cases);
      sensitiveDataEvaluationFailedFingerprintRef.current = '';
      setSavedSensitiveDataEvaluationCases(drafts);
      if (JSON.stringify(sensitiveDataEvaluationPayload(sensitiveDataEvaluationCasesRef.current)) === sourceFingerprint) {
        setSensitiveDataEvaluationCases(drafts);
        setSelectedSensitiveDataEvaluationCaseId((current) => drafts.some((item) => item.id === current) ? current : drafts[0]?.id || '');
      }
      setSensitiveDataEvaluationLoaded(true);
    } catch (error) {
      sensitiveDataEvaluationFailedFingerprintRef.current = sourceFingerprint;
      setSensitiveDataEvaluationError(error instanceof Error ? t(error.message) : t('保存脱敏评测集失败'));
    } finally {
      setSavingSensitiveDataEvaluation(false);
    }
  }

  async function runSensitiveDataEvaluation() {
    if (runningSensitiveDataEvaluation) return;
    const cases = validSensitiveDataEvaluationPayload();
    if (!cases) return;
    if (!cases.length) {
      setSensitiveDataEvaluationError(t('请至少添加一个评测用例。'));
      return;
    }
    setRunningSensitiveDataEvaluation(true);
    setSensitiveDataEvaluationError('');
    try {
      const response = await fetch(withWebPilotBasePath('/api/settings/sensitive-data-evaluation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminSettingsAuthorizationHeaders },
        body: JSON.stringify({ cases }),
      });
      const data = await readApiJson<SensitiveDataEvaluationRun>(response, t('运行脱敏评测失败'));
      setSensitiveDataEvaluationRun(data);
    } catch (error) {
      setSensitiveDataEvaluationRun(null);
      setSensitiveDataEvaluationError(error instanceof Error ? t(error.message) : t('运行脱敏评测失败'));
    } finally {
      setRunningSensitiveDataEvaluation(false);
    }
  }

  function commitActiveProviderExtraRequestParameters(rows: ExtraRequestParameterDraft[]) {
    setExtraRequestParameterRows((current) => ({
      ...current,
      [activeProvider]: rows,
    }));
    updateActiveProviderSettings({ extraRequestParameters: serializeExtraRequestParameterPairs(rows) });
  }

  function addActiveProviderExtraRequestParameter() {
    commitActiveProviderExtraRequestParameters([
      ...activeProviderExtraRequestParameterRows,
      {
        id: `${activeProvider}:new:${extraRequestParameterIdRef.current++}`,
        key: '',
        value: '',
      },
    ]);
  }

  function updateActiveProviderExtraRequestParameter(
    id: string,
    patch: Partial<ExtraRequestParameterPair>,
  ) {
    commitActiveProviderExtraRequestParameters(
      activeProviderExtraRequestParameterRows.map((row) => row.id === id ? { ...row, ...patch } : row),
    );
  }

  function removeActiveProviderExtraRequestParameter(id: string) {
    commitActiveProviderExtraRequestParameters(
      activeProviderExtraRequestParameterRows.filter((row) => row.id !== id),
    );
  }

  function setActiveProviderModels(
    models: string[],
    defaultModel?: string,
    modelCapabilitiesInput?: ModelProviderSettings['modelCapabilities'],
  ) {
    setModelDraft((current) => {
      const next = {
        ...current,
        providers: { ...current.providers },
      };
      const provider = selectedModelProvider;
      const currentSettings = providerSettings(next, provider);
      const normalizedModels = models.map((item) => item.trim()).filter(Boolean);
      const requestedModel = defaultModel || currentSettings.defaultModel || currentSettings.model || '';
      const fallbackModel = normalizedModels.includes(requestedModel) ? requestedModel : normalizedModels[0] || '';
      return {
        ...next,
        providers: {
          ...next.providers,
          [provider]: {
            ...currentSettings,
            defaultModel: fallbackModel,
            model: fallbackModel,
            models,
            modelCapabilities: normalizedModelCapabilities(
              provider,
              normalizedModels,
              modelCapabilitiesInput || currentSettings.modelCapabilities,
            ),
          },
        },
      };
    });
  }

  function updateActiveProviderModel(index: number, value: string) {
    const rows = [...draftModelRows(activeProviderOption, activeProviderSettings)];
    const previous = rows[index];
    rows[index] = value;
    const trimmedRows = rows.map((item) => item.trim()).filter(Boolean);
    const currentDefault = activeProviderSettings.defaultModel || activeProviderSettings.model || '';
    const nextDefault = previous === currentDefault || !trimmedRows.includes(currentDefault)
      ? value.trim() || trimmedRows[0] || ''
      : currentDefault;
    const nextCapabilities = { ...(activeProviderSettings.modelCapabilities || {}) };
    const previousCapability = nextCapabilities[previous]
      || defaultModelCapabilities(activeProvider, previous);
    delete nextCapabilities[previous];
    if (value.trim()) nextCapabilities[value.trim()] = previousCapability;
    setActiveProviderModels(rows, nextDefault, nextCapabilities);
  }

  function addActiveProviderModel() {
    setActiveProviderModels([...draftModelRows(activeProviderOption, activeProviderSettings), ''], activeProviderSettings.defaultModel || activeProviderSettings.model);
  }

  function removeActiveProviderModel(index: number) {
    const rows = draftModelRows(activeProviderOption, activeProviderSettings);
    if (!rows.length) return;
    const removed = rows[index];
    const nextRows = rows.filter((_, itemIndex) => itemIndex !== index);
    const remaining = nextRows.map((item) => item.trim()).filter(Boolean);
    const currentDefault = activeProviderSettings.defaultModel || activeProviderSettings.model || '';
    const nextDefault = removed === currentDefault || !remaining.includes(currentDefault)
      ? remaining[0] || ''
      : currentDefault;
    const nextCapabilities = { ...(activeProviderSettings.modelCapabilities || {}) };
    delete nextCapabilities[removed];
    setActiveProviderModels(nextRows, nextDefault, nextCapabilities);
  }

  function saveModelCapabilities(capabilities: ModelCapabilities) {
    if (!modelCapabilitiesEditor) return;
    const { provider, model } = modelCapabilitiesEditor;
    setModelDraft((current) => {
      const settings = providerSettings(current, provider);
      return {
        ...current,
        providers: {
          ...current.providers,
          [provider]: {
            ...settings,
            modelCapabilities: { ...settings.modelCapabilities, [model]: capabilities },
          },
        },
      };
    });
    setModelCapabilitiesEditor(null);
  }

  async function saveModel() {
    for (const definition of modelProviderDefinitionsForConfig(modelDraft.providers)) {
      const duplicates = duplicateExtraRequestParameterKeys(extraRequestParameterRows[definition.value] || []);
      if (duplicates.length) {
        return;
      }
    }
    const draftFingerprint = JSON.stringify(modelDraft);
    const payload = createModelConfig(modelDraft);
    const sourceFingerprint = JSON.stringify(payload);
    setSavingModel(true);
    setModelAutoSaveError('');
    try {
      const response = await fetch(withWebPilotBasePath('/api/settings/model'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminSettingsAuthorizationHeaders },
        body: JSON.stringify(payload),
      });
      const data = await readApiJson<{ config?: Partial<ModelConfig> }>(response, t('保存模型配置失败'));
      const nextModel = createModelConfig(data.config);
      modelFailedFingerprintRef.current = '';
      setModelConfig(nextModel);
      // Compare the actual state, including draft rows, when applying the response.
      // Normalized payload equality cannot detect an empty row added during saving.
      setModelDraft((current) => JSON.stringify(current) === draftFingerprint
        ? reconcileSavedModelDraft(current, nextModel)
        : current);
      onModelSaved?.();
    } catch (error) {
      modelFailedFingerprintRef.current = sourceFingerprint;
      setModelAutoSaveError(error instanceof Error ? t(error.message) : t('保存模型配置失败'));
      throw error;
    } finally {
      setSavingModel(false);
    }
  }

  async function reloadModelConfigAfterImport() {
    const response = await fetch(withWebPilotBasePath('/api/settings/model'), {
      cache: 'no-store',
      headers: adminSettingsAuthorizationHeaders,
    });
    const data = await readApiJson<{ config?: Partial<ModelConfig> }>(response, t('读取模型配置失败'));
    const nextModel = createModelConfig(data.config);
    setModelConfig(nextModel);
    setModelDraft(nextModel);
    setSelectedModelProvider(nextModel.provider);
    setExtraRequestParameterRows(extraRequestParameterDrafts(nextModel));
    onModelSaved?.();
  }

  function updatePersonalMemoryDraft(patch: Partial<PersonalMemoryDraft>) {
    setPersonalMemoryDraft((current) => {
      const next = { ...current, ...patch };
      if (patch.scope === 'global') next.domain = '';
      return next;
    });
  }

  function resetPersonalMemoryDraft() {
    setPersonalMemoryDraft(createPersonalMemoryDraft());
  }

  function openCreatePersonalMemory() {
    setPersonalMemoryDraft(createPersonalMemoryDraft());
    setPersonalMemoryEditorMode('create');
  }

  function openEditPersonalMemory(item: PersonalMemoryItem) {
    if (item.userId !== normalizedUserId) return;
    setPersonalMemoryDraft(personalMemoryDraftFromItem(item));
    setPersonalMemoryEditorMode('edit');
  }

  function closePersonalMemoryEditor() {
    if (savingPersonalMemory) return;
    setPersonalMemoryEditorMode(null);
    resetPersonalMemoryDraft();
  }

  function replacePersonalMemoryItem(item: PersonalMemoryItem) {
    setPersonalMemoryItems((current) => sortPersonalMemoryItems([item, ...current.filter((entry) => entry.id !== item.id)]));
  }

  function replacePersonalMemoryItemInPlace(item: PersonalMemoryItem) {
    setPersonalMemoryItems((current) => current.map((entry) => entry.id === item.id ? item : entry));
  }

  const loadPersonalMemoryItems = useCallback(async () => {
    const loadingSequence = ++personalMemoryLoadSequenceRef.current;
    const loadingStartedAt = Date.now();
    setLoadingPersonalMemory(true);
    try {
      const response = await fetch(withWebPilotBasePath('/api/personal-memory?includeDisabled=true'), { cache: 'no-store' });
      const data = await readApiJson<{ items?: PersonalMemoryItem[] }>(response, t('读取个性化记忆失败'));
      setPersonalMemoryItems(sortPersonalMemoryItems(Array.isArray(data.items) ? data.items : []));
    } finally {
      await waitForMinimumLoading(loadingStartedAt);
      if (personalMemoryLoadSequenceRef.current === loadingSequence) setLoadingPersonalMemory(false);
    }
  }, [t]);

  useLayoutEffect(() => {
    if (activeTab !== 'memory') return;
    void loadPersonalMemoryItems().catch(() => undefined);
  }, [activeTab, loadPersonalMemoryItems, personalMemoryRefreshToken]);

  const loadLoginAccounts = useCallback(async () => {
    const loadingSequence = ++loginAccountsLoadSequenceRef.current;
    const loadingStartedAt = Date.now();
    setLoadingLoginAccounts(true);
    try {
      const response = await fetch(withWebPilotBasePath('/api/login-accounts'), { cache: 'no-store' });
      const data = await readApiJson<{ accounts?: LoginAccountMetadata[] }>(response, t('读取登录账号失败'));
      setLoginAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } finally {
      await waitForMinimumLoading(loadingStartedAt);
      if (loginAccountsLoadSequenceRef.current === loadingSequence) setLoadingLoginAccounts(false);
    }
  }, [t]);

  useLayoutEffect(() => {
    if (activeTab !== 'accounts') return;
    void loadLoginAccounts().catch(() => undefined);
  }, [activeTab, loadLoginAccounts]);

  function replaceLoginAccount(account: LoginAccountMetadata) {
    setLoginAccounts((current) => [account, ...current.filter((item) => item.id !== account.id)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
  }

  function requestDeleteLoginAccount(account: LoginAccountMetadata) {
    if (account.userId !== normalizedUserId) return;
    setDeleteLoginAccountTarget(account);
    setDeleteLoginAccountError('');
  }

  function closeDeleteLoginAccountModal() {
    if (deletingLoginAccountId) return;
    setDeleteLoginAccountTarget(null);
    setDeleteLoginAccountError('');
  }

  async function confirmDeleteLoginAccount() {
    const account = deleteLoginAccountTarget;
    if (!account) return;
    setDeletingLoginAccountId(account.id);
    setDeleteLoginAccountError('');
    try {
      const response = await fetch(withWebPilotBasePath(`/api/login-accounts/${encodeURIComponent(account.id)}`), { method: 'DELETE' });
      await readApiJson(response, t('删除登录账号失败'));
      setLoginAccounts((current) => current.filter((item) => item.id !== account.id));
      setDeleteLoginAccountTarget(null);
    } catch (error) {
      setDeleteLoginAccountError(error instanceof Error ? t(error.message) : t('删除登录账号失败'));
    } finally {
      setDeletingLoginAccountId('');
    }
  }

  function personalMemoryPayload() {
    return {
      recall: personalMemoryDraft.scope === 'global' && personalMemoryDraft.type === 'preference' ? personalMemoryDraft.recall : 'relevant',
      shared: personalMemoryDraft.shared,
      scope: personalMemoryDraft.scope,
      domain: personalMemoryDraft.scope === 'domain' ? personalMemoryDraft.domain.trim() : '',
      type: personalMemoryDraft.type,
      key: personalMemoryDraft.key.trim(),
      aliases: personalMemoryAliasesFromText(personalMemoryDraft.aliasesText),
      value: personalMemoryDraft.value.trim(),
      status: personalMemoryDraft.status,
      confidence: 0.9,
    };
  }

  async function savePersonalMemory() {
    const payload = personalMemoryPayload();
    if (!payload.key || !payload.value) {
      window.alert(t('记忆需要填写短语和说明'));
      return;
    }
    if (payload.scope === 'domain' && !payload.domain) {
      window.alert(t('域名记忆需要填写域名'));
      return;
    }
    setSavingPersonalMemory(true);
    try {
      const response = await fetch(personalMemoryDraftApiPath(personalMemoryDraft), {
        method: personalMemoryDraft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await readApiJson<{ item?: PersonalMemoryItem }>(response, t('保存个性化记忆失败'));
      if (data.item) replacePersonalMemoryItem(data.item);
      setPersonalMemoryEditorMode(null);
      resetPersonalMemoryDraft();
    } finally {
      setSavingPersonalMemory(false);
    }
  }

  async function togglePersonalMemory(item: PersonalMemoryItem) {
    if (item.userId !== normalizedUserId) return;
    setUpdatingPersonalMemoryId(item.id);
    try {
      const response = await fetch(personalMemoryItemApiPath(item), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: item.status === 'active' ? 'disabled' : 'active' }),
      });
      const data = await readApiJson<{ item?: PersonalMemoryItem }>(response, t('更新个性化记忆失败'));
      if (data.item) replacePersonalMemoryItemInPlace(data.item);
    } finally {
      setUpdatingPersonalMemoryId('');
    }
  }

  function requestDeletePersonalMemory(item: PersonalMemoryItem) {
    if (item.userId !== normalizedUserId) return;
    setDeletePersonalMemoryTarget(item);
    setDeletePersonalMemoryError('');
  }

  function closeDeletePersonalMemoryModal() {
    if (deletingPersonalMemoryId) return;
    setDeletePersonalMemoryTarget(null);
    setDeletePersonalMemoryError('');
  }

  async function confirmDeletePersonalMemory() {
    const item = deletePersonalMemoryTarget;
    if (!item) return;
    setDeletingPersonalMemoryId(item.id);
    setDeletePersonalMemoryError('');
    try {
      const response = await fetch(personalMemoryItemApiPath(item), { method: 'DELETE' });
      await readApiJson(response, t('删除个性化记忆失败'));
      setPersonalMemoryItems((current) => current.filter((entry) => entry.id !== item.id));
      if (personalMemoryDraft.id === item.id) closePersonalMemoryEditor();
      setDeletePersonalMemoryTarget(null);
    } catch (error) {
      setDeletePersonalMemoryError(error instanceof Error ? t(error.message) : t('删除个性化记忆失败'));
    } finally {
      setDeletingPersonalMemoryId('');
    }
  }

  function renderSensitiveDataToolPanel(view: 'test' | 'evaluation') {
    const evaluationResults = new Map((sensitiveDataEvaluationRun?.results || []).map((item) => [item.id, item]));
    const selectedEvaluationCase = sensitiveDataEvaluationCases.find((item) => item.id === selectedSensitiveDataEvaluationCaseId)
      || sensitiveDataEvaluationCases[0];
    const selectedEvaluationIndex = selectedEvaluationCase
      ? sensitiveDataEvaluationCases.findIndex((item) => item.id === selectedEvaluationCase.id)
      : -1;
    const selectedEvaluationValues = selectedEvaluationCase
      ? selectedEvaluationCase.expectedValuesText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
      : [];
    const selectedEvaluationResult = selectedEvaluationCase ? evaluationResults.get(selectedEvaluationCase.id) : undefined;
    const selectedEvaluationValueKeys = new Set(selectedEvaluationValues.map(canonicalSensitiveValue));
    const selectedEvaluationDisplayValues = [
      ...selectedEvaluationValues,
      ...(selectedEvaluationResult?.unexpectedValues || []).filter((value) => (
        !selectedEvaluationValueKeys.has(canonicalSensitiveValue(value))
      )),
    ];
    const selectedEvaluationRecall = selectedEvaluationValues.length
      ? Math.round(((selectedEvaluationValues.length - (selectedEvaluationResult?.missingValues.length || 0)) / selectedEvaluationValues.length) * 100)
      : 0;
    const visibleEvaluationCases = sensitiveDataEvaluationCases.filter((item, index) => (
      evaluationCaseDisplayName(item.name, index, t).toLocaleLowerCase().includes(sensitiveDataEvaluationSearch.trim().toLocaleLowerCase())
    ));
    return (
      <div className="settings-sensitive-data-tools">
        {view === 'test' ? <section className="settings-sensitive-data-test">
        <div className="settings-sensitive-data-test-head">
          <div>
            <h3>{t('敏感数据过滤测试')}</h3>
            <span>{t('使用当前已保存的 GLiNER 配置测试文本脱敏；测试不会调用任何 AI 模型，也不会保存输入和结果。')}</span>
          </div>
          <button
            className="ui-button ui-button--primary"
            disabled={testingSensitiveData || !sensitiveDataTestInput.trim()}
            onClick={runSensitiveDataTest}
            type="button"
          >
            {testingSensitiveData ? <Loader2 className="spin" size={15} /> : null}
            {t(testingSensitiveData ? '正在检测' : '开始检测')}
          </button>
        </div>
        <div className="settings-sensitive-data-test-grid">
          <label className="settings-sensitive-data-test-field">
            <strong>{t('待检测文本')}</strong>
            <TextArea
              className="settings-sensitive-data-test-input"
              fullWidth
              placeholder={t('例如：张三的邮箱是 zhangsan@example.com，手机号是 13800138000。')}
              value={sensitiveDataTestInput}
              onChange={(event) => {
                setSensitiveDataTestInput(event.target.value);
                setSensitiveDataTestResult(null);
                setSensitiveDataTestError('');
              }}
            />
          </label>
          <div className="settings-sensitive-data-test-field">
            <strong>{t('脱敏结果')}</strong>
            <pre aria-live="polite" className={`settings-sensitive-data-test-output${sensitiveDataTestResult ? ' has-result' : ''}`}>
              {sensitiveDataTestResult?.text || t('检测完成后在此显示结果。')}
            </pre>
          </div>
        </div>
        {sensitiveDataTestError ? (
          <div className="settings-sensitive-data-test-error" role="alert">{sensitiveDataTestError}</div>
        ) : null}
        {sensitiveDataTestResult ? (
          <div className="settings-sensitive-data-replacements">
            <div className="settings-sensitive-data-replacements-head">
              <strong>{t('替换明细')}</strong>
              <span>{t('{count} 项', { count: sensitiveDataTestResult.replacements.length })}</span>
            </div>
            {sensitiveDataTestResult.replacements.length ? (
              <div className="settings-sensitive-data-replacement-list">
                {sensitiveDataTestResult.replacements.map((replacement, index) => (
                  <div className="settings-sensitive-data-replacement-row" key={`${replacement.start}:${replacement.end}:${index}`}>
                    <code>{replacement.original}</code>
                    <span aria-hidden="true">→</span>
                    <code>{replacement.placeholder}</code>
                    <span className="settings-sensitive-data-label">{replacement.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="settings-sensitive-data-test-empty">{t('未检测到敏感内容。')}</div>
            )}
          </div>
        ) : null}
        </section> : null}
        {view === 'evaluation' ? <section className={`settings-sensitive-data-evaluation-workbench${sensitiveDataEvaluationExpanded ? ' is-expanded' : ''}`}>
          <header className="evaluation-workbench-head">
            <div className="evaluation-workbench-title">
              <h3>{t('脱敏评测集')}</h3>
              <span>{t('配置可复用用例并批量评测。每个预期敏感原文单独占一行，系统按原文精确匹配统计通过率、精确率和召回率。')}</span>
            </div>
            <div className="evaluation-workbench-actions">
              {savingSensitiveDataEvaluation ? <span className="evaluation-autosave-status"><Loader2 className="spin" size={14} />{t('正在自动保存')}</span> : null}
              <button disabled={runningSensitiveDataEvaluation || loadingSensitiveDataEvaluation || !sensitiveDataEvaluationCases.length} onClick={runSensitiveDataEvaluation} type="button">
                {runningSensitiveDataEvaluation ? <Loader2 className="spin" size={16} /> : <PlayCircle size={16} />}
                {t(runningSensitiveDataEvaluation ? '正在评测' : '运行评测')}
              </button>
              <button className="primary" data-slot="evaluation-primary-action" onClick={addSensitiveDataEvaluationCase} type="button">
                <Plus size={17} />
                {t('新增用例')}
              </button>
            </div>
          </header>
          {sensitiveDataEvaluationError ? <div className="settings-sensitive-data-test-error" role="alert">{sensitiveDataEvaluationError}</div> : null}
          {loadingSensitiveDataEvaluation ? (
            <div className="settings-sensitive-data-test-empty"><Loader2 className="spin" size={16} /> {t('正在读取评测集')}</div>
          ) : selectedEvaluationCase ? (
            <div className="evaluation-workbench-shell">
              <aside className="evaluation-case-sidebar">
                <div className="evaluation-case-toolbar">
                  <label className="evaluation-case-search">
                    <Search aria-hidden="true" size={18} />
                    <input onChange={(event) => setSensitiveDataEvaluationSearch(event.target.value)} placeholder={t('搜索用例')} value={sensitiveDataEvaluationSearch} />
                  </label>
                  <button aria-label={t('新增用例')} className="evaluation-case-create" onClick={addSensitiveDataEvaluationCase} type="button"><Plus size={20} /></button>
                </div>
                <div className="evaluation-case-list browser-chat-conversation-history">
                  {visibleEvaluationCases.map((item) => {
                    const index = sensitiveDataEvaluationCases.findIndex((entry) => entry.id === item.id);
                    const result = evaluationResults.get(item.id);
                    const count = item.expectedValuesText.split(/\r?\n/).filter((value) => value.trim()).length;
                    return (
                      <WorkspaceSidebarArchiveRow
                        active={item.id === selectedEvaluationCase.id}
                        ariaLabel={evaluationCaseDisplayName(item.name, index, t)}
                        collapsed={false}
                        collapsedIcon={null}
                        expandedAction={(
                          <button
                            aria-label={t('删除用例')}
                            className="evaluation-case-delete workspace-sidebar-archive-row-delete"
                            onClick={() => removeSensitiveDataEvaluationCase(item.id)}
                            title={t('删除用例')}
                            type="button"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                        expandedIcon={<span className="case-index">{String(index + 1).padStart(2, '0')}</span>}
                        key={item.id}
                        meta={(
                          <span className="evaluation-case-row-meta">
                            {result
                              ? result.passed
                                ? <CircleCheck className="case-pass" size={13} />
                                : <AlertCircle className="case-fail" size={13} />
                              : <span className="case-pending" />}
                            <span className="case-count">{count}</span>
                          </span>
                        )}
                        onOpen={() => setSelectedSensitiveDataEvaluationCaseId(item.id)}
                        title={evaluationCaseDisplayName(item.name, index, t)}
                      />
                    );
                  })}
                </div>
              </aside>
              <section className="evaluation-editor-pane">
                <div className="evaluation-editor-toolbar">
                  <input aria-label={t('用例名称')} className="evaluation-case-name-input" onChange={(event) => updateSensitiveDataEvaluationCase(selectedEvaluationCase.id, { name: event.target.value })} value={evaluationCaseDisplayName(selectedEvaluationCase.name, selectedEvaluationIndex, t)} />
                  <div>
                    <button aria-label={t('复制')} onClick={() => void navigator.clipboard?.writeText(selectedEvaluationCase.text)} type="button"><Copy size={16} /></button>
                    <button aria-label={t('全屏')} onClick={() => setSensitiveDataEvaluationExpanded((current) => !current)} type="button"><Maximize2 size={16} /></button>
                  </div>
                </div>
                <div className="evaluation-text-editor">
                  <div className="evaluation-line-numbers" aria-hidden="true">
                    {Array.from({ length: Math.max(1, selectedEvaluationCase.text.split(/\r?\n/).length) }, (_, index) => <span key={index}>{index + 1}</span>)}
                  </div>
                  <div className="evaluation-editor-content">
                    <pre aria-hidden="true">{highlightedSensitiveText(selectedEvaluationCase.text, selectedEvaluationValues)}</pre>
                    <textarea
                      onChange={(event) => updateSensitiveDataEvaluationCase(selectedEvaluationCase.id, { text: event.target.value })}
                      onScroll={(event) => {
                        const textarea = event.currentTarget;
                        const preview = textarea.previousElementSibling as HTMLElement | null;
                        const lineNumbers = textarea.parentElement?.previousElementSibling as HTMLElement | null;
                        if (preview) {
                          preview.scrollLeft = textarea.scrollLeft;
                          preview.scrollTop = textarea.scrollTop;
                        }
                        if (lineNumbers) lineNumbers.scrollTop = textarea.scrollTop;
                      }}
                      placeholder={t('输入包含合成敏感数据的测试文本。')}
                      spellCheck={false}
                      value={selectedEvaluationCase.text}
                      wrap="off"
                    />
                  </div>
                </div>
              </section>
              <aside className="evaluation-inspector-pane">
                <div className="evaluation-inspector-head"><strong>{t('预期敏感原文')}</strong></div>
                <div className="evaluation-inspector-content">
                    <form className="evaluation-expected-add" onSubmit={(event) => { event.preventDefault(); addSensitiveDataEvaluationExpectedValue(selectedEvaluationCase.id); }}>
                      <input aria-label={t('预期敏感原文')} onChange={(event) => setSensitiveDataEvaluationNewExpectedValue(event.target.value)} placeholder={t('输入预期敏感原文')} value={sensitiveDataEvaluationNewExpectedValue} />
                      <button className="ui-button ui-button--primary" disabled={!sensitiveDataEvaluationNewExpectedValue.trim()} type="submit"><Plus size={15} />{t('添加')}</button>
                    </form>
                    <p className="evaluation-expected-help">{t('预期敏感原文是评测标准答案，用于计算漏检、误报、精确率和召回率。')}</p>
                    <div className="evaluation-inspector-count">{t('共 {count} 项', { count: selectedEvaluationValues.length })}</div>
                    <div className="evaluation-value-chips evaluation-value-list">
                      {selectedEvaluationDisplayValues.map((value) => {
                        const status = sensitiveEvaluationTagStatus(value, selectedEvaluationResult);
                        const statusLabel = status === 'matched'
                          ? '正确'
                          : status === 'missing'
                            ? '漏检'
                            : status === 'unexpected'
                              ? '误报'
                              : '';
                        return (
                          <span className={`is-${status}`} key={value} title={statusLabel ? t(statusLabel) : undefined}>
                            {status === 'matched' ? <CircleCheck aria-hidden="true" size={12} /> : null}
                            {status === 'missing' || status === 'unexpected' ? <AlertCircle aria-hidden="true" size={12} /> : null}
                            {value}
                            {status !== 'unexpected' ? <button aria-label={t('删除 {value}', { value })} onClick={() => removeSensitiveDataEvaluationExpectedValue(selectedEvaluationCase.id, value)} type="button"><X size={12} /></button> : null}
                          </span>
                        );
                      })}
                    </div>
                </div>
              </aside>
              <footer className="evaluation-status-bar" aria-live="polite">
                <span className="detected"><CircleCheck size={15} />{t('正确')} <strong>{selectedEvaluationResult?.matchedValues.length || 0}</strong></span>
                <span className="missing"><AlertCircle size={15} />{t('漏检')} <strong>{selectedEvaluationResult?.missingValues.length || 0}</strong></span>
                <span className="unexpected"><AlertCircle size={15} />{t('误报')} <strong>{selectedEvaluationResult?.unexpectedValues.length || 0}</strong></span>
                <span>{t('召回率')} <strong>{selectedEvaluationResult ? `${selectedEvaluationRecall}%` : '—'}</strong></span>
              </footer>
            </div>
          ) : (
            <div className="settings-sensitive-data-test-empty">{t('暂无评测用例，点击“新增用例”开始配置。')}</div>
          )}
        </section> : null}
      </div>
    );
  }

  function renderRuntimeControl(item: EnvRow, index: number) {
    const definition = runtimeEnvDefinition(item.key);
    if (definition?.control === 'boolean') {
      const checked = item.value === 'true';
      return (
        <button className={`settings-toggle${checked ? ' on' : ''}`} onClick={() => update(index, { value: checked ? 'false' : 'true' })} type="button" aria-pressed={checked}>
          <span />
        </button>
      );
    }

    if (definition?.control === 'select') {
      return (
        <CustomSelect
          className="settings-control"
          value={item.value}
          onChange={(nextValue) => update(index, { value: nextValue })}
          options={(definition.options || []).map((option) => ({
            label: optionLabel(option),
            value: option.value,
          }))}
        />
      );
    }

    if (definition?.control === 'textarea') {
      return (
        <div className="settings-prompt-control">
          <TextArea
            className="settings-textarea-control"
            fullWidth
            placeholder={t('未设置')}
            value={item.value}
            onChange={(event) => update(index, { value: event.target.value })}
          />
        </div>
      );
    }

    if (definition?.picker === 'directory') {
      return (
        <div className="settings-directory-control">
          <AppInput
            placeholder={t('未设置')}
            type="text"
            value={item.value}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <button
            className="ui-button ui-button--neutral"
            disabled={!hasDirectoryPicker}
            onClick={() => chooseRuntimeDirectory(index, item)}
            title={hasDirectoryPicker ? t('选择目录') : t('仅 Electron 桌面端支持目录选择')}
            type="button"
          >
            <FolderOpen size={15} />
            {t('选择')}
          </button>
        </div>
      );
    }

    return (
      <AppInput
        inputMode={definition?.control === 'number' ? 'decimal' : undefined}
        min={definition?.min}
        max={definition?.max}
        placeholder={item.hasValue ? t('已配置，留空表示不修改') : t('未设置')}
        type={definition?.control === 'number' ? 'number' : isSecret(item) ? 'password' : 'text'}
        step={definition?.step}
        value={item.value}
        onChange={(event) => update(index, { value: event.target.value })}
      />
    );
  }

  function renderPersonalMemoryEditorModal() {
    if (!personalMemoryEditorMode) return null;
    const editing = personalMemoryEditorMode === 'edit';
    return (
      <AppModal
        ariaLabelledBy="personal-memory-modal-title"
        dialogClassName="ui-modal ui-modal--form ui-modal--personal-memory"
        dismissable={!savingPersonalMemory}
        keyboardDismissable={!savingPersonalMemory}
        onClose={closePersonalMemoryEditor}
        size="wide"
      >
          <header className="ui-modal-header">
            <div className="ui-modal-heading">
              <h2 className="ui-modal-title" id="personal-memory-modal-title">{t(editing ? '编辑记忆' : '新增记忆')}</h2>
              <p className="ui-modal-subtitle">{editing ? personalMemoryDraft.id : t('保存后即可在后续对话中召回')}</p>
            </div>
            <button aria-label={t('关闭')} className="ui-icon-button ui-modal-close" disabled={savingPersonalMemory} onClick={closePersonalMemoryEditor} type="button">
              <X size={16} />
            </button>
          </header>

          <div className="ui-modal-body personal-memory-form">
            <label className="personal-memory-field">
              <span>{t('范围')}</span>
              <CustomSelect
                className="settings-control"
                value={personalMemoryDraft.scope}
                onChange={(value) => updatePersonalMemoryDraft({ scope: value as PersonalMemoryScope })}
                options={personalMemoryScopeOptions.map((option) => ({ label: t(option.label), value: option.value }))}
              />
            </label>
            <label className="personal-memory-field">
              <span>{t('域名')}</span>
              <AppInput
                disabled={personalMemoryDraft.scope !== 'domain'}
                placeholder="jira.company.local"
                value={personalMemoryDraft.domain}
                onChange={(event) => updatePersonalMemoryDraft({ domain: event.target.value })}
              />
            </label>
            <label className="personal-memory-field">
              <span>{t('类型')}</span>
              <CustomSelect
                className="settings-control"
                value={personalMemoryDraft.type}
                onChange={(value) => updatePersonalMemoryDraft({ type: value as PersonalMemoryType })}
                options={personalMemoryTypeOptions.map((option) => ({ label: t(option.label), value: option.value }))}
              />
            </label>
            <label className="personal-memory-field">
              <span>{t('使用时机')}</span>
              <CustomSelect className="settings-control"
                value={personalMemoryDraft.scope === 'global' && personalMemoryDraft.type === 'preference' ? personalMemoryDraft.recall : 'relevant'}
                onChange={(value) => updatePersonalMemoryDraft({ recall: value as 'always' | 'relevant' })}
                options={personalMemoryDraft.scope === 'global' && personalMemoryDraft.type === 'preference'
                  ? [{ label: t('任务相关时'), value: 'relevant' }, { label: t('优先作为常用偏好'), value: 'always' }]
                  : [{ label: t('任务相关时'), value: 'relevant' }]} />
            </label>
            <div className="personal-memory-field personal-memory-status-field">
              <span>{t('状态')}</span>
              <div className="personal-memory-status-control">
                <button
                  aria-label={personalMemoryDraft.status === 'active' ? t('禁用记忆') : t('启用记忆')}
                  aria-pressed={personalMemoryDraft.status === 'active'}
                  className={`settings-toggle${personalMemoryDraft.status === 'active' ? ' on' : ''}`}
                  disabled={savingPersonalMemory}
                  onClick={() => updatePersonalMemoryDraft({ status: personalMemoryDraft.status === 'active' ? 'disabled' : 'active' })}
                  type="button"
                >
                  <span />
                </button>
                <span className="personal-memory-status-label">{t(personalMemoryDraft.status === 'active' ? '启用' : '禁用')}</span>
              </div>
            </div>
            <label className="personal-memory-field">
              <span>{t('常用短语')}</span>
              <AppInput
                placeholder="jira"
                value={personalMemoryDraft.key}
                onChange={(event) => updatePersonalMemoryDraft({ key: event.target.value })}
              />
            </label>
            <label className="personal-memory-field">
              <span>{t('等价说法')}</span>
              <AppInput
                placeholder={t('逗号或换行分隔')}
                value={personalMemoryDraft.aliasesText}
                onChange={(event) => updatePersonalMemoryDraft({ aliasesText: event.target.value })}
              />
            </label>
            <label className="personal-memory-field wide">
              <span>{t('说明')}</span>
              <TextArea
                fullWidth
                placeholder={t('公司私域 Jira，地址是 ...')}
                value={personalMemoryDraft.value}
                onChange={(event) => updatePersonalMemoryDraft({ value: event.target.value })}
              />
            </label>
            <div className="resource-sharing-field wide">
              <div>
                <strong>{t('所有 ID 共享')}</strong>
                <small>{t('其他 ID 可以使用此记忆，但只有创建 ID {id} 可以编辑或删除', { id: personalMemoryDraft.userId || normalizedUserId })}</small>
              </div>
              <button
                aria-pressed={personalMemoryDraft.shared}
                className={`settings-toggle${personalMemoryDraft.shared ? ' on' : ''}`}
                disabled={savingPersonalMemory}
                onClick={() => updatePersonalMemoryDraft({ shared: !personalMemoryDraft.shared })}
                type="button"
              >
                <span />
              </button>
            </div>
          </div>

          <footer className="ui-modal-footer">
            <button className="ui-button ui-button--neutral" disabled={savingPersonalMemory} onClick={closePersonalMemoryEditor} type="button">
              <X size={15} />
              {t('取消')}
            </button>
            <button className="ui-button ui-button--primary" disabled={savingPersonalMemory} onClick={() => void savePersonalMemory()} type="button">
              {savingPersonalMemory ? <Loader2 className="spin" size={15} /> : editing ? <Save size={15} /> : <Plus size={15} />}
              {t(editing ? '保存记忆' : '新增记忆')}
            </button>
          </footer>
      </AppModal>
    );
  }

  function renderDeletePersonalMemoryModal() {
    if (!deletePersonalMemoryTarget) return null;
    const deleting = deletingPersonalMemoryId === deletePersonalMemoryTarget.id;
    return (
      <ConfirmDeleteModal
        deleting={deleting}
        description={t('确认删除这条记忆？')}
        error={deletePersonalMemoryError}
        id="personal-memory-delete-title"
        itemTitle={deletePersonalMemoryTarget.key}
        onClose={closeDeletePersonalMemoryModal}
        onConfirm={confirmDeletePersonalMemory}
        title={t('删除记忆')}
      />
    );
  }

  function renderDeleteLoginAccountModal() {
    if (!deleteLoginAccountTarget) return null;
    const deleting = deletingLoginAccountId === deleteLoginAccountTarget.id;
    return (
      <ConfirmDeleteModal
        deleting={deleting}
        description={t('确认删除这个登录账号？')}
        error={deleteLoginAccountError}
        id="login-account-delete-title"
        itemTitle={deleteLoginAccountTarget.label || deleteLoginAccountTarget.username}
        onClose={closeDeleteLoginAccountModal}
        onConfirm={confirmDeleteLoginAccount}
        title={t('删除登录账号')}
      />
    );
  }

  function renderPersonalMemoryPanel() {
    const memoryActions = (
      <div className="personal-memory-head-actions">
        <DataTransferButtons kind="memory" onImported={loadPersonalMemoryItems} />
        <button className="ui-button ui-button--neutral" disabled={loadingPersonalMemory} onClick={() => void loadPersonalMemoryItems()} type="button">
          <RefreshCw size={15} />
          {t('刷新')}
        </button>
        <button className="ui-button ui-button--primary" onClick={openCreatePersonalMemory} type="button">
          <Plus size={15} />
          {t('新增记忆')}
        </button>
      </div>
    );
    return (
      <section className={loadingPersonalMemory ? 'personal-memory-settings is-loading' : 'personal-memory-settings'}>
        {showSectionTitles ? <div className="settings-section-head">
          <div>
            <h2>{t('个性化记忆')}</h2>
            <span>{t('{count} 条记录，存储于本地数据库', { count: personalMemoryItems.length })}</span>
          </div>
          {memoryActions}
        </div> : null}

        {loadingPersonalMemory ? (
          <div className="settings-loading-panel compact" role="status" aria-live="polite" aria-label={t('正在读取个性化记忆')}>
            <LiquidGlassLoader className="ui-liquid-glass-loader--compact" />
            <div>
              <h2>{t('正在读取个性化记忆')}</h2>
            </div>
          </div>
        ) : (
          <ManagementDataTable
            columns={[
              {
                key: 'memory',
                label: t('记忆'),
                className: 'management-table-primary-column',
                filter: {
                  getValue: (item) => [item.key, item.value, ...(item.aliases || [])],
                  type: 'text',
                },
                render: (item) => (
                  <div className="management-table-primary-copy">
                    <strong>{item.key}</strong>
                    <span>{item.value}</span>
                    {item.aliases?.length ? <small>{t('等价说法')}：{item.aliases.join(' · ')}</small> : null}
                  </div>
                ),
              },
              {
                key: 'type',
                label: t('类型'),
                filter: {
                  getValue: (item) => item.type,
                  options: personalMemoryTypeOptions.map((option) => ({ label: t(option.label), value: option.value })),
                  type: 'select',
                },
                render: (item) => <span>{t(personalMemoryTypeLabel(item.type))}</span>,
              },
              {
                key: 'scope',
                label: t('适用范围'),
                filter: {
                  getValue: (item) => item.scope,
                  options: personalMemoryScopeOptions.map((option) => ({ label: t(option.label), value: option.value })),
                  type: 'select',
                },
                render: (item) => (
                  <div className="management-table-cell-stack">
                    <span>{item.scope === 'domain' ? item.domain : t('全局')}</span>
                    <small>{item.shared ? t('所有 ID 共享') : t('仅创建 ID')}</small>
                  </div>
                ),
              },
              {
                key: 'status',
                label: t('状态'),
                className: 'personal-memory-status-column',
                filter: {
                  getValue: (item) => item.status,
                  options: [
                    { label: t('启用'), value: 'active' },
                    { label: t('禁用'), value: 'disabled' },
                  ],
                  type: 'select',
                },
                render: (item) => (
                  <div className="personal-memory-status-cell">
                    <div className="personal-memory-status-control">
                      <button
                        aria-label={item.status === 'active' ? t('禁用记忆') : t('启用记忆')}
                        aria-pressed={item.status === 'active'}
                        className={`settings-toggle settings-toggle--status${item.status === 'active' ? ' on' : ''}${updatingPersonalMemoryId === item.id ? ' is-loading' : ''}`}
                        disabled={item.userId !== normalizedUserId || updatingPersonalMemoryId === item.id || deletingPersonalMemoryId === item.id}
                        onClick={() => void togglePersonalMemory(item)}
                        title={item.status === 'active' ? t('禁用记忆') : t('启用记忆')}
                        type="button"
                      >
                        <span>{updatingPersonalMemoryId === item.id ? <Loader2 className="spin" size={12} /> : null}</span>
                      </button>
                      <span className="personal-memory-status-label">{t(item.status === 'active' ? '启用' : '禁用')}</span>
                    </div>
                  </div>
                ),
              },
              {
                key: 'updated',
                label: t('最近更新'),
                className: 'management-table-date-column',
                filter: { getValue: (item) => item.updatedAt, type: 'datetime' },
                render: (item) => <span className="management-table-muted">{new Date(item.updatedAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')}</span>,
              },
              {
                key: 'actions',
                label: t('操作'),
                className: 'management-table-actions-column',
                render: (item) => (
                  <div className="personal-memory-actions">
                    {item.userId === normalizedUserId ? <>
                      <button
                        aria-label={t('编辑记忆')}
                        className="settings-model-row-button"
                        disabled={savingPersonalMemory || updatingPersonalMemoryId === item.id || deletingPersonalMemoryId === item.id}
                        onClick={() => openEditPersonalMemory(item)}
                        title={t('编辑记忆')}
                        type="button"
                      >
                        <PencilLine size={15} />
                      </button>
                      <button
                        aria-label={t('删除记忆')}
                        className="settings-model-row-button danger"
                        disabled={deletingPersonalMemoryId === item.id}
                        onClick={() => requestDeletePersonalMemory(item)}
                        title={t('删除记忆')}
                        type="button"
                      >
                        {deletingPersonalMemoryId === item.id ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                      </button>
                    </> : <span className="resource-readonly-label">{t('只读')}</span>}
                  </div>
                ),
              },
            ]}
            emptyText={t('暂无个性化记忆')}
            getId={(item) => item.id}
            getSearchText={(item) => [
              item.key,
              item.value,
              item.domain,
              item.type,
              item.status,
              personalMemoryTypeLabel(item.type),
              t(item.status === 'active' ? '启用' : '禁用'),
              item.shared ? t('所有 ID 共享') : t('仅创建 ID'),
              item.userId,
              ...(item.aliases || []),
            ]}
            items={personalMemoryItems}
            rowClassName={(item) => item.status === 'disabled' ? 'is-disabled' : ''}
            searchPlaceholder={t('筛选记忆')}
            toolbarActions={showSectionTitles ? undefined : memoryActions}
          />
        )}
        {renderPersonalMemoryEditorModal()}
        {renderDeletePersonalMemoryModal()}
      </section>
    );
  }

  function renderLoginAccountsPanel() {
    const accountActions = (
      <div className="personal-memory-head-actions">
        <DataTransferButtons kind="credentials" onImported={loadLoginAccounts} />
        <button className="ui-button ui-button--neutral" disabled={loadingLoginAccounts} onClick={() => void loadLoginAccounts()} type="button">
          <RefreshCw size={15} />
          {t('刷新')}
        </button>
        <button className="ui-button ui-button--primary" onClick={() => setLoginAccountEditor('create')} type="button">
          <Plus size={15} />
          {t('新增账号')}
        </button>
      </div>
    );
    return (
      <section className={loadingLoginAccounts ? 'login-account-settings is-loading' : 'login-account-settings'}>
        {showSectionTitles ? <div className="settings-section-head">
          <div>
            <h2>{t('登录账号')}</h2>
            <span>{t('{count} 个可跨站点使用的账号；密码只在后台解密并通过短期安全引用使用', { count: loginAccounts.length })}</span>
          </div>
          {accountActions}
        </div> : null}

        {loadingLoginAccounts ? (
          <div className="settings-loading-panel compact" role="status" aria-live="polite" aria-label={t('正在读取登录账号')}>
            <LiquidGlassLoader className="ui-liquid-glass-loader--compact" />
            <div><h2>{t('正在读取登录账号')}</h2></div>
          </div>
        ) : (
          <ManagementDataTable
            columns={[
              {
                key: 'account',
                label: t('账号'),
                className: 'management-table-primary-column',
                filter: { getValue: (account) => [account.label, account.username], type: 'text' },
                render: (account) => (
                  <div className="management-table-account-copy">
                    <span className="login-account-item-icon" aria-hidden="true"><KeyRound size={16} /></span>
                    <span>
                      <strong>{account.label || account.username}</strong>
                      <small>{account.username}</small>
                    </span>
                  </div>
                ),
              },
              {
                key: 'domain',
                label: t('默认站点'),
                filter: { getValue: (account) => [account.domain, account.loginUrl || ''], type: 'text' },
                render: (account) => <span>{account.domain}</span>,
              },
              {
                key: 'scope',
                label: t('共享范围'),
                filter: {
                  getValue: (account) => account.shared ? 'shared' : 'private',
                  options: [
                    { label: t('所有 ID 共享'), value: 'shared' },
                    { label: t('仅创建 ID'), value: 'private' },
                  ],
                  type: 'select',
                },
                render: (account) => (
                  <span className="management-table-muted">
                    {account.shared
                      ? account.userId === normalizedUserId ? t('所有 ID 共享') : t('由 ID {id} 共享', { id: account.userId })
                      : t('仅创建 ID')}
                  </span>
                ),
              },
              {
                key: 'status',
                label: t('状态'),
                filter: {
                  getValue: (account) => account.status,
                  options: [
                    { label: t('可用于目标测试'), value: 'active' },
                    { label: t('已停用'), value: 'disabled' },
                  ],
                  type: 'select',
                },
                render: (account) => (
                  <div className="management-table-cell-stack">
                    <span>{t(account.status === 'active' ? '可用于目标测试' : '已停用')}</span>
                  </div>
                ),
              },
              {
                key: 'updated',
                label: t('最近更新'),
                className: 'management-table-date-column',
                filter: { getValue: (account) => account.updatedAt, type: 'datetime' },
                render: (account) => <span className="management-table-muted">{new Date(account.updatedAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')}</span>,
              },
              {
                key: 'actions',
                label: t('操作'),
                className: 'management-table-actions-column',
                render: (account) => (
                  <div className="login-account-item-actions">
                    {account.userId === normalizedUserId ? <>
                      <button aria-label={t('编辑登录账号')} className="settings-model-row-button" onClick={() => setLoginAccountEditor(account)} title={t('编辑登录账号')} type="button">
                        <PencilLine size={15} />
                      </button>
                      <button
                        aria-label={t('删除登录账号')}
                        className="settings-model-row-button danger"
                        disabled={deletingLoginAccountId === account.id}
                        onClick={() => requestDeleteLoginAccount(account)}
                        title={t('删除登录账号')}
                        type="button"
                      >
                        {deletingLoginAccountId === account.id ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                      </button>
                    </> : <span className="resource-readonly-label">{t('只读')}</span>}
                  </div>
                ),
              },
            ]}
            emptyText={t('尚未保存登录账号。目标测试需要新账号时，也可以直接在目标卡片中创建。')}
            getId={(account) => account.id}
            getSearchText={(account) => [
              account.label,
              account.username,
              account.domain,
              account.loginUrl || '',
              account.status,
              t(account.status === 'active' ? '可用于目标测试' : '已停用'),
              account.shared ? t('所有 ID 共享') : t('仅创建 ID'),
              account.userId,
            ]}
            items={loginAccounts}
            rowClassName={(account) => account.status === 'disabled' ? 'is-disabled' : ''}
            searchPlaceholder={t('筛选登录账号')}
            toolbarActions={showSectionTitles ? undefined : accountActions}
          />
        )}

        <LoginAccountModal
          account={loginAccountEditor && loginAccountEditor !== 'create' ? loginAccountEditor : undefined}
          onClose={() => setLoginAccountEditor(null)}
          onSaved={replaceLoginAccount}
          open={Boolean(loginAccountEditor)}
        />
        {renderDeleteLoginAccountModal()}
      </section>
    );
  }

  function renderEnvSettingList(settings: VisibleEnvSetting[]) {
    return settings.map(({ item, index, definition }) => (
      <div
        className={`settings-row settings-env-row${definition?.control === 'textarea' ? ' prompt-row' : ''}${highlightedSettingKey === item.key ? ' is-highlighted' : ''}`}
        data-setting-key={item.key}
        key={item.key}
        tabIndex={-1}
      >
        <div className="env-name">
          <span className="settings-field-title-line">
            <strong>{definition?.label ? t(definition.label) : item.key}</strong>
            <small className={`settings-apply-badge is-${definition?.applyMode || 'runtime'}`}>{t(definition?.applyMode === 'startup' ? '重启后生效' : '即时生效')}</small>
          </span>
          <span>{definition?.description ? t(definition.description) : t('网页配置项。')}</span>
          <small className="settings-field-default" title={item.key}>{t('默认值')}：{displayDefaultValue(item.key, definition?.defaultValue || '', t)}</small>
        </div>
        <div className="settings-row-control">{renderRuntimeControl(item, index)}</div>
      </div>
    ));
  }

  const envDirty = envItemsFingerprint(items) !== envItemsFingerprint(savedItems);
  const modelDirty = JSON.stringify(createModelConfig(modelDraft)) !== JSON.stringify(createModelConfig(modelConfig));
  const sensitiveDataEvaluationFingerprint = JSON.stringify(sensitiveDataEvaluationPayload(sensitiveDataEvaluationCases));
  const sensitiveDataEvaluationDirty = sensitiveDataEvaluationFingerprint !== JSON.stringify(sensitiveDataEvaluationPayload(savedSensitiveDataEvaluationCases));

  useEffect(() => {
    const fingerprint = envItemsFingerprint(items);
    if (
      loading
      || savingEnv
      || !envDirty
      || fingerprint === envFailedFingerprintRef.current
      || (adminSettingsPasswordRequired && !adminSettingsAccessToken)
    ) return;
    const timeout = window.setTimeout(() => void saveEnv().catch(() => undefined), 700);
    return () => window.clearTimeout(timeout);
  // Saving is intentionally debounced from the complete settings snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSettingsAccessToken, adminSettingsPasswordRequired, envDirty, items, loading, savingEnv]);

  useEffect(() => {
    const fingerprint = JSON.stringify(createModelConfig(modelDraft));
    const hasDuplicateKeys = modelProviderDefinitionsForConfig(modelDraft.providers).some((definition) => (
      duplicateExtraRequestParameterKeys(extraRequestParameterRows[definition.value] || []).length > 0
    ));
    if (
      loading
      || savingModel
      || !modelDirty
      || hasDuplicateKeys
      || fingerprint === modelFailedFingerprintRef.current
      || (adminSettingsPasswordRequired && !adminSettingsAccessToken)
    ) return;
    const timeout = window.setTimeout(() => void saveModel().catch(() => undefined), 700);
    return () => window.clearTimeout(timeout);
  // Saving is intentionally debounced from the complete provider snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSettingsAccessToken, adminSettingsPasswordRequired, extraRequestParameterRows, loading, modelDirty, modelDraft, savingModel]);

  useEffect(() => {
    if (
      !sensitiveDataEvaluationLoaded
      || savingSensitiveDataEvaluation
      || !sensitiveDataEvaluationDirty
      || sensitiveDataEvaluationCases.some((item) => !item.text.trim())
      || sensitiveDataEvaluationFingerprint === sensitiveDataEvaluationFailedFingerprintRef.current
      || (adminSettingsPasswordRequired && !adminSettingsAccessToken)
    ) return;
    const timeout = window.setTimeout(() => void saveSensitiveDataEvaluationCases().catch(() => undefined), 700);
    return () => window.clearTimeout(timeout);
  // Evaluation cases use the same debounced auto-save behavior as the other settings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSettingsAccessToken, adminSettingsPasswordRequired, savingSensitiveDataEvaluation, sensitiveDataEvaluationCases, sensitiveDataEvaluationDirty, sensitiveDataEvaluationFingerprint, sensitiveDataEvaluationLoaded]);

  const editingModelConfig = modelDraft || modelConfig;
  const activeProvider = selectedModelProvider;
  const activeProviderOption = modelProviderDefinition(activeProvider);
  const activeProviderSettings = providerSettings(editingModelConfig, activeProvider);
  const activeProviderModels = draftModelRows(activeProviderOption, activeProviderSettings);
  const activeProviderDefaultModel = activeProviderSettings.defaultModel || activeProviderSettings.model || '';
  const activeProviderEnabled = activeProviderSettings.enabled === true;
  const activeMediaKind = modelKind === 'language' ? undefined : modelKind;
  const activeBuiltInMedia = builtInMediaModels.filter((item) => item.provider === activeProvider && item.configuration.kind === activeMediaKind);
  const activeMediaSettings = activeMediaKind ? createMediaTypeSettings(activeProvider, activeMediaKind, activeProviderSettings.media?.[activeMediaKind]) : undefined;

  function updateMediaSettings(patch: Partial<MediaTypeSettings>) {
    if (!activeMediaKind || !activeMediaSettings) return;
    updateActiveProviderSettings({ media: { ...activeProviderSettings.media, [activeMediaKind]: { ...activeMediaSettings, ...patch } } });
  }

  function updateMediaModels(models: string[], defaultModel = activeMediaSettings?.defaultModel || '') {
    const available = models.map((model) => model.trim()).filter(Boolean);
    updateMediaSettings({ models, defaultModel: available.includes(defaultModel) ? defaultModel : available[0] || '' });
  }

  function mediaSettingRow(label: string, description: string, children: ReactNode) {
    return <div className="settings-row"><div><strong>{t(label)}</strong><span>{t(description)}</span></div><div className="settings-control">{children}</div></div>;
  }

  function renderMediaFields(group: 'connection' | 'generation') {
    if (!activeMediaSettings || !activeMediaKind) return null;
    const settings = activeMediaSettings;
    return mediaSettingFields.filter((field) => field.group === group && field.kinds.includes(activeMediaKind)).map((field) => {
      const raw = settings[field.key];
      const value = typeof raw === 'number' ? raw / (field.scale || 1) : raw ?? '';
      return <div key={field.key}>{mediaSettingRow(field.label, field.description, <AppInput
        aria-label={t(field.label)} type={field.type} min={field.min} max={field.max} placeholder={field.placeholder} value={value}
        onChange={(event) => {
          const input = event.target.value;
          if (!input && field.scale) return;
          updateMediaSettings({ [field.key]: field.type === 'number' ? input ? Number(input) * (field.scale || 1) : undefined : input });
        }}
      />)}</div>;
    });
  }

  function renderMediaConnection() {
    if (!activeMediaSettings || !activeMediaKind) return null;
    const settings = activeMediaSettings;
    const driver = mediaModelDriver(settings.driver);
    return <>
      {mediaSettingRow('接口协议', '选择供应商实际使用的协议；自定义服务地址和路径不会转换请求或响应格式。', <CustomSelect value={settings.driver} options={mediaModelDrivers.filter((item) => item.models[activeMediaKind]).map((item) => ({ label: item.label, value: item.id }))} onChange={(driver) => updateMediaSettings({ driver: driver as MediaModelDriver, baseURL: '', paths: {}, parameters: [] })} />)}
      {!driver.localAuth && mediaSettingRow('服务地址', '填写当前类型的 API 基础地址，与其他类型独立。', <AppInput aria-label={t('服务地址')} value={settings.baseURL} placeholder={driver.baseURL} onChange={(event) => updateMediaSettings({ baseURL: event.target.value })} />)}
      {(driver.models[activeMediaKind]?.routes || []).map((route) => <div key={route.key}>{mediaSettingRow(route.label, '留空使用供应商默认路径；自定义路径以 / 开头，并保留占位符。', <AppInput aria-label={t(route.label)} value={settings.paths[route.key] || ''} placeholder={route.path} onChange={(event) => updateMediaSettings({ paths: { ...settings.paths, [route.key]: event.target.value } })} />)}</div>)}
      {renderMediaFields('connection')}
      {mediaSettingRow('额外请求参数', '填写当前类型 AI SDK 支持的参数名和值。', <div className="settings-extra-parameters-control">
        {settings.parameters.map((parameter, index) => <div className="settings-extra-parameter-input-row" key={index}>
          <AppInput aria-label={t('参数名')} placeholder={t('参数名')} value={parameter.key} onChange={(event) => updateMediaSettings({ parameters: settings.parameters.map((item, i) => i === index ? { ...item, key: event.target.value } : item) })} />
          <AppInput aria-label={t('参数值')} placeholder={t('参数值')} value={parameter.value} onChange={(event) => updateMediaSettings({ parameters: settings.parameters.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} />
          <button aria-label={t('删除参数')} className="settings-model-row-button danger" onClick={() => updateMediaSettings({ parameters: settings.parameters.filter((_, i) => i !== index) })} type="button"><Trash2 size={15} /></button>
        </div>)}
        <button className="ui-button settings-add-parameter-button" onClick={() => updateMediaSettings({ parameters: [...settings.parameters, { key: '', value: '' }] })} type="button"><Plus size={15} />{t('添加参数')}</button>
      </div>)}
    </>;
  }

  function renderMediaGenerationParameters() {
    if (!activeMediaSettings || !activeMediaKind) return null;
    return <section className="settings-detail-panel settings-model-group">
      <header className="settings-detail-panel-head"><h3>{t('生成参数')}</h3><span>{t('留空使用模型默认值；可用参数取决于模型。')}</span></header>
      {renderMediaFields('generation')}
    </section>;
  }

  const activeProviderSupportsExtraRequestParameters = activeProvider === 'minimax' || activeProvider.startsWith('openai-compatible');
  const activeProviderExtraRequestParameterRows = extraRequestParameterRows[activeProvider] || [];
  const activeProviderDuplicateExtraRequestParameterKeys = duplicateExtraRequestParameterKeys(activeProviderExtraRequestParameterRows);
  const configuredModelProviderDefinitions = modelProviderDefinitionsForConfig(editingModelConfig.providers, editingModelConfig.providerOrder);
  const visibleModelProviders = configuredModelProviderDefinitions.filter((provider) => {
    const compatibleIndex = openAICompatibleProviderIndex(provider.value);
    if (!compatibleIndex || compatibleIndex === 1) return true;
    const settings = editingModelConfig.providers?.[provider.value];
    return Boolean(settings?.enabled || settings?.displayName?.trim() || settings?.apiKey || settings?.hasApiKey || settings?.baseURL);
  });
  const allEnvSettings = items.map((item, index) => ({ item, index, definition: runtimeEnvDefinition(item.key) }));
  const envValues = new Map(items.map((item) => [item.key, item.value]));
  const visibleEnvItems = allEnvSettings.filter((setting) => (
    setting.definition?.hidden !== true
    && !customRuntimeSettingKeys.has(setting.item.key)
    && envSettingDisplayTab(setting) === activeTab
    && envSettingIsContextuallyVisible(setting, envValues)
  ));
  const visibleEnvGroups = groupVisibleEnvSettings(activeTab, visibleEnvItems);
  const settingsSecondaryItems: SettingsSecondaryNavItem[] = [
    ...(activeTab === 'capabilities' ? [
      { id: 'integration:connector', label: t('连接器') },
      { id: 'integration:communication', label: t('通信') },
      { id: 'integration:data', label: t('数据') },
    ] : []),
    ...visibleEnvGroups.filter((group) => !integrationSettingsSections[group.title]).map((group) => ({
      id: group.title,
      label: t(group.title),
      meta: String(group.items.length),
    })),
    ...(activeTab === 'sensitive-data' ? [
      { id: 'sensitive:test', label: t('快速检测') },
      { id: 'sensitive:evaluation', label: t('评测工作台') },
    ] : []),
  ];
  const requestedSettingsSection = activeSettingsSections[activeTab];
  const activeSettingsSection = settingsSecondaryItems.some((item) => item.id === requestedSettingsSection)
    ? requestedSettingsSection!
    : settingsSecondaryItems[0]?.id || '';
  const activeEnvGroup = visibleEnvGroups.find((group) => group.title === activeSettingsSection);
  const activeIntegrationSettings = visibleEnvItems.filter((setting) => envSettingSectionId(setting) === activeSettingsSection);
  const communicationSendSetting = items
    .map((item, index) => ({ item, index }))
    .find(({ item }) => item.key === 'AGENT_COMMUNICATION_ALLOW_SEND');
  const dataWriteSetting = items
    .map((item, index) => ({ item, index }))
    .find(({ item }) => item.key === 'AGENT_DATA_ALLOW_WRITES');
  const activeTabUsesEnvSave = ['runtime', 'browser', 'capabilities', 'sensitive-data', 'memory'].includes(activeTab);
  const normalizedSettingsSearch = settingsSearch.trim().toLocaleLowerCase();
  const settingsSearchResults = normalizedSettingsSearch ? [
    ...environmentSettingsTabs.map((tab) => ({
      key: `tab:${tab.id}`,
      title: t(tab.label),
      description: t(tab.description),
      group: t('设置页面'),
      tab: tab.id,
    })),
    ...configuredModelProviderDefinitions.map((provider) => ({
      key: `tab:model:${provider.value}`,
      title: t(provider.label),
      description: t('模型供应商、模型列表和连接配置'),
      group: t('模型与供应商'),
      provider: provider.value,
      tab: 'model' as const,
    })),
    ...allEnvSettings
      .filter((setting) => setting.definition?.hidden !== true && visibleSettingsTabs.some((tab) => tab.id === envSettingDisplayTab(setting)))
      .map((setting) => ({
        key: setting.item.key,
        title: t(setting.definition?.label || setting.item.key),
        description: t(setting.definition?.description || '网页配置项。'),
        group: t(normalizeSettingsGroupTitle(
          envSettingDisplayTab(setting),
          runtimeSettingGroup(envSettingDisplayTab(setting), setting.item.key, setting.definition?.group),
        )),
        section: envSettingSectionId(setting),
        tab: envSettingDisplayTab(setting),
      })),
  ].filter((result) => (
    `${result.title} ${result.description} ${result.group} ${result.key}`.toLocaleLowerCase().includes(normalizedSettingsSearch)
  )).slice(0, 10) : [];

  function openSettingsSearchResult(result: (typeof settingsSearchResults)[number]) {
    setHighlightedSettingKey(result.key.startsWith('tab:') ? '' : result.key);
    if ('provider' in result && result.provider) selectProvider(result.provider as ModelProvider);
    if ('section' in result && result.section) {
      setActiveSettingsSections((current) => ({ ...current, [result.tab]: result.section }));
    }
    setSettingsSearch('');
    setSettingsSearchFocused(false);
    selectTab(result.tab);
  }

  return (
    <main className={embedded ? 'settings-workspace embedded' : 'settings-workspace'}>
      {modelCapabilitiesEditor ? (
        <ModelCapabilitiesModal
          key={`${modelCapabilitiesEditor.provider}/${modelCapabilitiesEditor.model}`}
          model={modelCapabilitiesEditor.model}
          capabilities={modelCapabilities(modelDraft.providers[modelCapabilitiesEditor.provider], modelCapabilitiesEditor.provider, modelCapabilitiesEditor.model)}
          onClose={() => setModelCapabilitiesEditor(null)}
          onSave={saveModelCapabilities}
        />
      ) : null}
      {embedded ? null : (
        <header className="settings-header">
          <Link className="ghost-link" href="/browser-chat">
            <ArrowLeft size={15} />
            {t('返回工作台')}
          </Link>
          <div>
            <h1>{t('环境配置')}</h1>
            <span>{t('模型、浏览器、敏感数据过滤、运行控制和调试参数全部在网页配置中管理。')}</span>
          </div>
        </header>
      )}

      <div className={showTabs ? 'settings-layout' : 'settings-layout no-tabs'}>
        {showTabs ? (
          <nav className="settings-tabs" aria-label={t('环境配置分类')}>
            {visibleSettingsTabs.map((tab) => (
              <button className={activeTab === tab.id ? 'active' : undefined} key={tab.id} onClick={() => selectTab(tab.id)} type="button">
                {t(tab.label)}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="settings-content">
          {showTabs ? (
            <div className="settings-command-bar">
              <div className="settings-global-search">
                <InputGroup fullWidth>
                  <InputGroup.Prefix><Search aria-hidden="true" size={17} /></InputGroup.Prefix>
                  <InputGroup.Input
                    aria-label={t('搜索设置')}
                    onBlur={() => window.setTimeout(() => setSettingsSearchFocused(false), 120)}
                    onChange={(event) => setSettingsSearch(event.target.value)}
                    onFocus={() => setSettingsSearchFocused(true)}
                    placeholder={t('搜索设置、参数或功能')}
                    type="search"
                    value={settingsSearch}
                  />
                  {settingsSearch ? (
                    <InputGroup.Suffix>
                      <button aria-label={t('清除搜索')} onClick={() => setSettingsSearch('')} type="button"><X size={15} /></button>
                    </InputGroup.Suffix>
                  ) : null}
                </InputGroup>
                {settingsSearchFocused && normalizedSettingsSearch ? (
                  <div className="settings-search-results">
                    {settingsSearchResults.length ? settingsSearchResults.map((result) => (
                      <button key={`${result.tab}:${result.key}`} onClick={() => openSettingsSearchResult(result)} type="button">
                        <span><strong>{result.title}</strong><small>{result.description}</small></span>
                        <em>{result.group}</em>
                      </button>
                    )) : <div className="settings-search-empty">{t('没有找到相关设置')}</div>}
                  </div>
                ) : null}
              </div>
              <div className="settings-save-state">
                {activeTab === 'model' ? (
                  <DataTransferButtons
                    authorizationToken={adminSettingsAccessToken}
                    disabled={savingModel || loading}
                    kind="model"
                    onImported={reloadModelConfigAfterImport}
                  />
                ) : null}
                {activeTab === 'model' ? (
                  <span className={modelAutoSaveError ? 'is-error' : savingModel ? 'is-saving' : modelDirty ? 'is-dirty' : 'is-saved'} title={modelAutoSaveError || undefined}>
                    {savingModel ? <Loader2 className="spin" size={14} /> : <span />}
                    {t(modelAutoSaveError ? '自动保存失败，修改后重试' : savingModel ? '正在自动保存' : modelDirty ? '等待自动保存' : '已自动保存')}
                  </span>
                ) : activeTabUsesEnvSave ? (
                  <span className={envAutoSaveError ? 'is-error' : savingEnv ? 'is-saving' : envDirty ? 'is-dirty' : 'is-saved'} title={envAutoSaveError || undefined}>
                    {savingEnv ? <Loader2 className="spin" size={14} /> : <span />}
                    {t(envAutoSaveError ? '自动保存失败，修改后重试' : savingEnv ? '正在自动保存' : envDirty ? '等待自动保存' : '已自动保存')}
                  </span>
                ) : <span className="is-saved"><CircleCheck size={14} />{t(activeTab === 'general' ? '更改自动保存' : '此页面单独保存')}</span>}
              </div>
            </div>
          ) : null}
          {loading ? (
            <section className="settings-loading-panel" role="status" aria-live="polite">
              <LiquidGlassLoader />
              <div>
                <h2>{t('正在读取环境配置')}</h2>
                <span>{t('正在加载模型、浏览器、敏感数据过滤、运行控制和调试参数。')}</span>
              </div>
            </section>
          ) : (
            <>
          {activeTab === 'general' ? (
            <section>
              <div className="settings-detail-workspace">
                <SettingsSecondaryNav
                  activeId="general:appearance"
                  items={[{ id: 'general:appearance', label: t('基础设置') }]}
                  label={t('设置项')}
                  onChange={() => undefined}
                />
                <section className="settings-detail-panel">
                  <header className="settings-detail-panel-head">
                    <h3>{t('基础设置')}</h3>
                    <span>{t('调整品牌、界面语言与主题色。')}</span>
                  </header>
                <div className="settings-row">
                  <div>
                    <strong>{t('品牌前缀')}</strong>
                    <span>{t('设置侧边栏中高亮显示的品牌文字。')}</span>
                  </div>
                  <div className="settings-control">
                    <AppInput
                      aria-label={t('品牌前缀')}
                      maxLength={48}
                      onChange={(event) => setBrandPrefix(event.target.value)}
                      value={brandPrefix}
                    />
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>{t('产品名称')}</strong>
                    <span>{t('设置侧边栏中显示在品牌前缀右侧的名称。')}</span>
                  </div>
                  <div className="settings-control">
                    <AppInput
                      aria-label={t('产品名称')}
                      maxLength={48}
                      onChange={(event) => setBrandText(event.target.value)}
                      value={brandText}
                    />
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>{t('界面语言')}</strong>
                    <span>{t('选择界面显示语言。')}</span>
                  </div>
                  <CustomSelect
                    className="settings-control"
                    value={language}
                    onChange={(nextValue) => setLanguage(nextValue === 'en' ? 'en' : 'zh')}
                    options={languageOptions.map((option) => ({
                      label: t(option.label),
                      value: option.value,
                    }))}
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>{t('主题色')}</strong>
                    <span>{t('按当前配色比例联动背景、按钮、菜单、选择器和滚动条。夜间保持黑白灰。')}</span>
                  </div>
                  <ThemeColorControl />
                </div>
                </section>
              </div>
            </section>
          ) : null}

          {activeTab === 'model' ? (
            <section className="settings-model-section">
              <div className="settings-model-workspace">
                <aside className="settings-provider-rail">
                  <div className="settings-provider-rail-head">
                    <strong>{t('供应商')}</strong>
                    <span>{t('{count} 个可用入口', { count: visibleModelProviders.length })}</span>
                    <button
                      aria-label={t('新增 OpenAI 兼容 API')}
                      className="browser-chat-section-create settings-provider-create"
                      onClick={addOpenAICompatibleProvider}
                      title={t('新增 OpenAI 兼容 API')}
                      type="button"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  <div className="settings-provider-list" ref={providerListRef}>
                    <DndContext sensors={providerDragSensors} collisionDetection={closestCenter} onDragEnd={reorderProviders}>
                      <SortableContext items={visibleModelProviders.map(({ value }) => value)} strategy={rectSortingStrategy}>
                        {visibleModelProviders.map((provider) => {
                          const settings = editingModelConfig.providers?.[provider.value];
                          const enabled = settings?.enabled === true;
                          return (
                            <SortableProviderRow
                              active={activeProvider === provider.value}
                              provider={provider.value}
                              label={settings?.displayName?.trim() || t(provider.label)}
                              key={provider.value}
                              onSelect={() => selectProvider(provider.value)}
                            >
                              <span className="settings-provider-icon"><ModelBrandIcon model={settings?.defaultModel || provider.defaultModel} provider={provider.value} /></span>
                              <span><strong>{settings?.displayName?.trim() || t(provider.label)}</strong><small>{enabled ? t('已启用') : t('未启用')}</small></span>
                              <i className={enabled ? 'is-enabled' : undefined} />
                            </SortableProviderRow>
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                  </div>
                </aside>
                <div className="settings-model-detail">
                <section className="settings-detail-panel settings-model-group">
                <header className="settings-detail-panel-head"><h3>{t('基础信息')}</h3><span>{t('配置供应商名称和可用状态。')}</span></header>
                <div className="settings-row">
                  <div>
                    <strong>{t('默认服务商')}</strong>
                    <span>{t('选择默认使用的 AI 模型服务提供商。')}</span>
                  </div>
                  <CustomSelect
                    className="settings-control"
                    value={editingModelConfig.provider}
                    onChange={(nextValue) => selectDefaultProvider(nextValue as ModelProvider)}
                    options={visibleModelProviders.map((provider) => ({
                      label: editingModelConfig.providers?.[provider.value]?.displayName?.trim() || t(provider.label),
                      value: provider.value,
                    }))}
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>{t('供应商名称')}</strong>
                    <span>{t('用于模型选择器中的分组名称，可按实际接入服务自由修改。')}</span>
                  </div>
                  <AppInput
                    maxLength={80}
                    onChange={(event) => updateActiveProviderSettings({ displayName: event.target.value })}
                    placeholder={t(activeProviderOption.label)}
                    value={activeProviderSettings.displayName || ''}
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>{t('启用服务商')}</strong>
                    <span>{t('开启后，该服务商下配置的模型才会出现在模型选择列表中。')}</span>
                  </div>
                  <button
                    aria-label={t(activeProviderEnabled ? '关闭当前服务商' : '开启当前服务商')}
                    aria-pressed={activeProviderEnabled}
                    className={`settings-toggle${activeProviderEnabled ? ' on' : ''}`}
                    onClick={() => updateActiveProviderSettings({ enabled: !activeProviderEnabled })}
                    title={t(activeProviderEnabled ? '已开启' : '已关闭')}
                    type="button"
                  >
                    <span />
                  </button>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>{t('访问密钥')}</strong>
                    <span>{t(activeProviderOption.keyLabel)}</span>
                  </div>
                  <AppInput
                    disabled={Boolean(activeProviderOption.localAuth)}
                    type="password"
                    value={activeProviderSettings.apiKey || ''}
                    onChange={(event) => updateActiveProviderSettings({ apiKey: event.target.value, hasApiKey: Boolean(event.target.value) || activeProviderSettings.hasApiKey })}
                    placeholder={activeProviderOption.localAuth
                      ? t('本地登录，无需 Key')
                      : activeProviderSettings.hasApiKey
                        ? t('已配置，留空表示不修改')
                        : t('填写该服务商的访问密钥')}
                  />
                </div>
                </section>
              <div className="settings-model-types" role="tablist" aria-label={t('模型类型')}>
                {([{ id: 'language', label: '对话模型' }, ...mediaModelTypeDefinitions] as const).map((item) => (
                  <button key={item.id} type="button" role="tab" aria-selected={modelKind === item.id} className={modelKind === item.id ? 'active' : ''} onClick={() => setModelKind(item.id)}>{t(item.label)}</button>
                ))}
              </div>
              {activeBuiltInMedia.length ? activeBuiltInMedia.map((item) => (
                <div className="settings-row" key={item.configuration.id}>
                  <div><strong>{t(item.configuration.name)}</strong><span>{t(item.description)}</span></div>
                  <span>{t('本地登录，无需 Key')}</span>
                </div>
              )) : <ModelTypeSettings
                key={activeProvider + modelKind}
                provider={activeProvider}
                enabled={activeProviderEnabled}
                models={activeMediaSettings ? activeMediaSettings.models : activeProviderModels}
                defaultModel={activeMediaSettings ? activeMediaSettings.defaultModel : activeProviderDefaultModel}
                onDefaultChange={(model) => activeMediaSettings ? updateMediaSettings({ defaultModel: model }) : updateActiveProviderSettings({ defaultModel: model, model })}
                onModelChange={(index, value) => {
                  if (!activeMediaSettings) return updateActiveProviderModel(index, value);
                  const models = [...activeMediaSettings.models];
                  const previous = models[index];
                  models[index] = value;
                  updateMediaModels(models, previous === activeMediaSettings.defaultModel ? value.trim() : activeMediaSettings.defaultModel);
                }}
                onAdd={() => activeMediaSettings ? updateMediaModels([...activeMediaSettings.models, '']) : addActiveProviderModel()}
                onRemove={(index) => activeMediaSettings ? updateMediaModels(activeMediaSettings.models.filter((_, i) => i !== index)) : removeActiveProviderModel(index)}
                modelSuffix={modelKind === 'language' ? (model) => (
                  <button
                    aria-label={t('编辑模型')}
                    aria-haspopup="dialog"
                    className="settings-model-capability-button"
                    disabled={!activeProviderEnabled || !model.trim()}
                    onClick={() => setModelCapabilitiesEditor({ provider: activeProvider, model: model.trim() })}
                    title={t('编辑模型')}
                    type="button"
                  ><PencilLine aria-hidden="true" size={16} strokeWidth={1.9} /></button>
                ) : undefined}
                connection={modelKind === 'language' ? <>
                {activeProviderOption.baseUrlLabel ? (
                  <div className="settings-row">
                    <div>
                      <strong>{t(activeProviderOption.baseUrlLabel)}</strong>
                      <span>{t(activeProvider.startsWith('openai-compatible')
                        ? '填写服务商提供的 OpenAI 兼容 Base URL，通常以 /v1 结尾。'
                        : '自定义兼容服务地址，留空使用默认地址。')}</span>
                    </div>
                    <AppInput value={activeProviderSettings.baseURL || ''} onChange={(event) => updateActiveProviderSettings({ baseURL: event.target.value })} placeholder={activeProviderOption.defaultBaseURL || t('默认地址')} />
                  </div>
                ) : null}
                {activeProviderSupportsExtraRequestParameters ? (
                  <div className="settings-row settings-extra-parameters-row">
                    <div>
                      <strong>{t('额外请求参数')}</strong>
                      <span>{t('以键值对形式添加到每次 Chat Completions 请求。值支持布尔值、数字、JSON 对象、数组和字符串；model、messages、stream、tools、tool_choice 由应用管理。')}</span>
                    </div>
                    <div className="settings-extra-parameters-control">
                      {activeProviderExtraRequestParameterRows.length ? (
                        <div className="settings-extra-parameters-list">
                          {activeProviderExtraRequestParameterRows.map((row) => (
                            <div className="settings-extra-parameter-input-row" key={row.id}>
                              <AppInput
                                aria-invalid={activeProviderDuplicateExtraRequestParameterKeys.includes(row.key.trim()) || undefined}
                                aria-label={t('参数名')}
                                autoCapitalize="none"
                                onChange={(event) => updateActiveProviderExtraRequestParameter(row.id, { key: event.target.value })}
                                placeholder={t('参数名')}
                                spellCheck={false}
                                title={row.key || t('参数名')}
                                value={row.key}
                              />
                              <AppInput
                                aria-label={t('参数值')}
                                onChange={(event) => updateActiveProviderExtraRequestParameter(row.id, { value: event.target.value })}
                                placeholder={t('参数值，例如 true、0.2、"priority" 或 {"type":"adaptive"}')}
                                spellCheck={false}
                                title={row.value || t('参数值')}
                                value={row.value}
                              />
                              <button
                                aria-label={t('删除参数')}
                                className="settings-model-row-button danger"
                                onClick={() => removeActiveProviderExtraRequestParameter(row.id)}
                                title={t('删除参数')}
                                type="button"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="settings-extra-parameters-empty">{t('暂未添加额外请求参数。')}</span>
                      )}
                      {activeProviderDuplicateExtraRequestParameterKeys.length ? (
                        <span className="settings-extra-parameters-error" role="alert">
                          {t('额外请求参数名不能重复：{keys}', { keys: activeProviderDuplicateExtraRequestParameterKeys.join(', ') })}
                        </span>
                      ) : null}
                      <button className="ui-button settings-add-parameter-button" onClick={addActiveProviderExtraRequestParameter} type="button">
                        <Plus size={15} />
                        {t('添加参数')}
                      </button>
                    </div>
                  </div>
                ) : null}
                </> : renderMediaConnection()}
              >
                {renderMediaGenerationParameters()}
              </ModelTypeSettings>}
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === 'skills' ? <SkillsManager onChanged={onSkillsChanged} showTitle={showSectionTitles} userId={normalizedUserId} /> : null}

          {activeTab === 'memory' ? (
            <div className="settings-memory-page">
              {renderPersonalMemoryPanel()}
              {visibleEnvGroups.length ? (
                <section className="settings-secondary-section">
                  <div className="settings-subsection-head">
                    <div>
                      <h3>{t('记忆运行策略')}</h3>
                      <span>{t('控制记忆提炼、召回数量和注入上下文的预算。')}</span>
                    </div>
                  </div>
                  <div className="settings-group-stack">
                    {visibleEnvGroups.map((group) => (
                      <SettingsGroupCard forceOpen={group.items.some(({ item }) => item.key === highlightedSettingKey)} key={group.title} meta={t('{count} 项设置', { count: group.items.length })} title={t(group.title)}>
                        {group.items.map(({ item, index, definition }) => (
                          <div
                            className={`settings-row settings-env-row${highlightedSettingKey === item.key ? ' is-highlighted' : ''}`}
                            data-setting-key={item.key}
                            key={item.key}
                            tabIndex={-1}
                          >
                            <div className="env-name">
                              <span className="settings-field-title-line">
                                <strong>{definition?.label ? t(definition.label) : item.key}</strong>
                                <small className={`settings-apply-badge is-${definition?.applyMode || 'runtime'}`}>{t(definition?.applyMode === 'startup' ? '重启后生效' : '即时生效')}</small>
                              </span>
                              <span>{definition?.description ? t(definition.description) : t('网页配置项。')}</span>
                              <small className="settings-field-default">{t('默认值')}：{displayDefaultValue(item.key, definition?.defaultValue || '', t)}</small>
                            </div>
                            <div className="settings-row-control">{renderRuntimeControl(item, index)}</div>
                          </div>
                        ))}
                      </SettingsGroupCard>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'accounts' ? renderLoginAccountsPanel() : null}

          {activeTab !== 'general' && activeTab !== 'model' && activeTab !== 'skills' && activeTab !== 'memory' && activeTab !== 'accounts' ? (
            <section>
              <div className="settings-detail-workspace">
                <SettingsSecondaryNav
                  activeId={activeSettingsSection}
                  items={settingsSecondaryItems}
                  label={t('配置分组')}
                  onChange={(section) => setActiveSettingsSections((current) => ({ ...current, [activeTab]: section }))}
                />
                <div className="settings-detail-content">
                  {activeSettingsSection === 'sensitive:test' ? renderSensitiveDataToolPanel('test') : null}
                  {activeSettingsSection === 'sensitive:evaluation' ? renderSensitiveDataToolPanel('evaluation') : null}

                  {activeSettingsSection === 'integration:connector' ? (
                    <section className="settings-detail-panel">
                      <header className="settings-detail-panel-head"><h3>{t('连接器')}</h3><span>{t('配置第三方服务入口和授权信息。')}</span></header>
                      <ExternalIntegrationSettings accessToken={adminSettingsAccessToken} category="connector" />
                      {renderEnvSettingList(activeIntegrationSettings)}
                    </section>
                  ) : null}
                  {activeSettingsSection === 'integration:communication' ? (
                    <section className="settings-detail-panel">
                      <header className="settings-detail-panel-head"><h3>{t('通信')}</h3><span>{t('消息发送保持逐次确认，避免意外外发。')}</span></header>
                      <ExternalIntegrationSettings
                        accessToken={adminSettingsAccessToken}
                        category="communication"
                        permission={{
                          enabled: communicationSendSetting?.item.value === 'true',
                          label: '允许 Agent 请求发送消息',
                          description: '更改会自动保存；每次正式发送仍会暂停并等待你的确认。',
                          onChange(enabled) {
                            if (communicationSendSetting) update(communicationSendSetting.index, { value: String(enabled) });
                          },
                        }}
                      />
                      {renderEnvSettingList(activeIntegrationSettings)}
                    </section>
                  ) : null}
                  {activeSettingsSection === 'integration:data' ? (
                    <section className="settings-detail-panel">
                      <header className="settings-detail-panel-head"><h3>{t('数据')}</h3><span>{t('统一管理数据源，并单独控制写入权限。')}</span></header>
                      <ExternalIntegrationSettings
                        accessToken={adminSettingsAccessToken}
                        category="data"
                        permission={{
                          enabled: dataWriteSetting?.item.value === 'true',
                          label: '允许 Agent 执行数据写入',
                          description: '默认只允许查询；更改会自动保存，每次写操作仍需要确认。',
                          onChange(enabled) {
                            if (dataWriteSetting) update(dataWriteSetting.index, { value: String(enabled) });
                          },
                        }}
                      />
                      {renderEnvSettingList(activeIntegrationSettings)}
                    </section>
                  ) : null}
                  {activeEnvGroup ? (
                    <section className="settings-detail-panel">
                      <header className="settings-detail-panel-head">
                        <h3>{t(activeEnvGroup.title)}</h3>
                        <span>{t('{count} 项设置，修改后自动保存。', { count: activeEnvGroup.items.length })}</span>
                      </header>
                      {renderEnvSettingList(activeEnvGroup.items)}
                    </section>
                  ) : null}

                  {!activeSettingsSection ? <div className="empty-state">{t('这个分类暂无配置。')}</div> : null}
                </div>
              </div>
            </section>
          ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
