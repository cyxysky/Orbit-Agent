import { existsSync } from 'node:fs';
import { chromium } from 'patchright';
import { managedChromiumOptions } from '@cjfclonedeep/capability-sdk/runtime';
import {
  WEBPILOT_ONBOARDING_VERSION,
  isWebPilotOnboardingStep,
  webPilotOnboardingSteps,
  type WebPilotOnboardingReadiness,
  type WebPilotOnboardingState,
  type WebPilotOnboardingStatus,
  type WebPilotOnboardingStep,
} from '@/lib/onboarding';
import { modelProviderDefinition } from '@/config/settings';
import { modelCapabilities } from '@/lib/model-capabilities';
import { enabledModelProviders } from '@/lib/model-selection';
import { executeDatabase, parseDatabaseJson, queryDatabaseOne } from '@/server/db/database';
import { readModelSettingsState } from '@/server/settings/settings-snapshot';
import {
  resolveLibreOfficeExecutable,
  resolveLibreOfficePythonExecutable,
  resolveUnoProgramWorker,
} from '@cjfclonedeep/capability-sdk/file/node';
import { store } from '@/server/db/store';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


export async function readOnboardingState(userId: string): Promise<WebPilotOnboardingState> {
  const row = await queryDatabaseOne<{ onboarding_json: string | null }>(
    'SELECT onboarding_json FROM application_user WHERE id = ?', [userId]);
  const current = parseDatabaseJson<WebPilotOnboardingState | undefined>(row?.onboarding_json, undefined);
  if (current?.tutorialVersion === WEBPILOT_ONBOARDING_VERSION) return current;
  return writeOnboardingState(userId, { completedSteps: [], status: 'not_started' });
}

async function writeOnboardingState(userId: string, input: {
  completedSteps: WebPilotOnboardingStep[];
  dismissedAt?: string;
  status: WebPilotOnboardingStatus;
}): Promise<WebPilotOnboardingState> {
  const timestamp = new Date().toISOString();
  const state: WebPilotOnboardingState = {
    completedSteps: Array.from(new Set(input.completedSteps)).filter(isWebPilotOnboardingStep),
    status: input.status, tutorialVersion: WEBPILOT_ONBOARDING_VERSION,
    dismissedAt: input.dismissedAt, updatedAt: timestamp,
  };
  await executeDatabase(
    'INSERT INTO application_user(id,onboarding_json,created_at,updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET onboarding_json=excluded.onboarding_json',
    [userId, JSON.stringify(state), timestamp, timestamp]);
  return state;
}

export async function updateOnboardingState(userId: string, input: {
  action: 'complete' | 'complete_step' | 'reset' | 'skip' | 'start';
  step?: WebPilotOnboardingStep;
}) {
  const current = await readOnboardingState(userId);
  if (input.action === 'reset') return writeOnboardingState(userId, { completedSteps: [], status: 'not_started' });
  if (input.action === 'skip') return writeOnboardingState(userId, {
    completedSteps: current.completedSteps,
    dismissedAt: new Date().toISOString(),
    status: 'dismissed',
  });
  if (input.action === 'complete') return writeOnboardingState(userId, {
    completedSteps: [...webPilotOnboardingSteps],
    status: 'completed',
  });
  if (input.action === 'start') return writeOnboardingState(userId, {
    completedSteps: current.completedSteps,
    status: 'in_progress',
  });
  if (!input.step) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'complete_step requires a valid onboarding step.');
  const completedSteps = Array.from(new Set([...current.completedSteps, input.step]));
  return writeOnboardingState(userId, {
    completedSteps,
    status: webPilotOnboardingSteps.every((step) => completedSteps.includes(step)) ? 'completed' : 'in_progress',
  });
}

export async function readOnboardingReadiness(): Promise<WebPilotOnboardingReadiness> {
  await store.refreshRuntimeSettings();
  const modelState = await readModelSettingsState();
  const configuredProvider = modelState.config.provider;
  const provider = modelState.config.providers?.[configuredProvider]?.enabled
    ? configuredProvider
    : enabledModelProviders(modelState.config)[0] || configuredProvider;
  const providerDefinition = modelProviderDefinition(provider);
  const providerSettings = modelState.config.providers?.[provider];
  const localProvider = ['codex', 'llama-cpp', 'lmstudio', 'ollama'].includes(provider);
  const customCompatibleReady = provider.startsWith('openai-compatible') && Boolean(providerSettings?.baseURL);
  const modelReady = Boolean(providerSettings?.enabled && providerSettings.model && (
    providerDefinition.localAuth || localProvider || customCompatibleReady || providerSettings.hasApiKey
  ));
  const selectedModel = String(providerSettings?.model || '');
  const visionReady = modelCapabilities(providerSettings, provider, selectedModel).imageInput;
  const libreOfficeExecutable = await resolveLibreOfficeExecutable();
  const libreOfficePython = libreOfficeExecutable
    ? await resolveLibreOfficePythonExecutable(libreOfficeExecutable)
    : undefined;
  const libreOfficeWorker = await resolveUnoProgramWorker();
  const libreOfficeReady = Boolean(libreOfficeExecutable && libreOfficePython && libreOfficeWorker);
  let browserReady = false;
  try {
    browserReady = existsSync(managedChromiumOptions().executablePath || chromium.executablePath());
  } catch {
    browserReady = false;
  }
  return {
    browser: {
      detail: browserReady ? 'Patchright 浏览器运行时已安装' : '未找到 Patchright 浏览器运行时',
      ready: browserReady,
    },
    libreOffice: {
      detail: libreOfficeReady
        ? 'LibreOffice UNO 可用于 Office 创建、排版、预览与格式转换'
        : libreOfficeExecutable
          ? 'LibreOffice 已安装，但 Python/PyUNO Worker 不可用，Office 文件生成会受限'
          : '未找到 LibreOffice，Office 创建、预览与格式转换不可用',
      ready: libreOfficeReady,
    },
    model: {
      detail: modelReady ? `${provider} / ${providerSettings?.model}` : '尚未完成可用模型配置',
      ready: modelReady,
    },
    vision: {
      detail: visionReady ? '当前模型配置支持图片输入' : '当前模型配置未启用图片输入',
      ready: visionReady,
    },
  };
}
