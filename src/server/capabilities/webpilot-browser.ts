import {
  BrowserSession,
  type BrowserSessionOptions,
} from '@cjfclonedeep/capability-sdk/browser/node';
import { executeBrowserCodeRuntimeStateOperation } from '@/server/storage/browser-code-runtime-state';
import { artifactPath } from '@/server/storage/paths';
import { artifactsRoot } from '@/server/storage/paths';
import { artifactApiUrlFromRelative } from '@/lib/artifacts';
import { createNodeFileDownloadReceiver } from '@cjfclonedeep/capability-sdk/file/node';
import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import { runtimeSettingDefinitions } from '@/config/settings';
import { browserCapabilitySettings } from '@cjfclonedeep/capability-sdk/browser/settings';

export function browserRuntimeConfiguration() {
  const configuration = runtimeConfiguration();
  const keys = [...browserCapabilitySettings.map(setting => setting.key), 'BROWSER_SLOW_MO_MS', 'AI_WEB_TEST_CHROMIUM_EXECUTABLE_PATH'];
  const deploymentKeys = ['APP_DATA_DIR', 'ARTIFACTS_DIR', 'CAPABILITY_BROWSER_DATA_DIR',
    'CAPABILITY_BROWSER_RUNTIME_DIR', 'CAPABILITY_RUNTIME_HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'WEBPILOT_ELECTRON_CDP_PORT',
    'ELECTRON_EMBEDDED_BROWSER_CDP_PORT', 'BROWSER_TAB_GROUP_CDP_PORT'];
  return {
    ...Object.fromEntries(deploymentKeys.map(key => [key, process.env[key]])),
    ...Object.fromEntries(keys.map(key => [key, configuration[key]])),
    BROWSER_USER_DATA_DIR: process.env.CAPABILITY_BROWSER_PROFILE_DIR,
    AI_WEB_TEST_CHROMIUM_EXECUTABLE_PATH: configuration.AI_WEB_TEST_CHROMIUM_EXECUTABLE_PATH || process.env.ORBIT_BROWSER_EXECUTABLE_PATH,
  };
}

export function browserInstanceConfigurationKey() {
  const configuration = runtimeConfiguration();
  return JSON.stringify(runtimeSettingDefinitions.filter(setting => setting.applyMode === 'recreate' && (setting.tab === 'browser' || setting.key === 'PLAYWRIGHT_TRACE'))
    .map(setting => [setting.key, configuration[setting.key] ?? setting.defaultValue]));
}

export function createWebPilotBrowserSession(options: BrowserSessionOptions = {}) {
  const configuredHost = options.host;
  return new BrowserSession({
    ...options,
    configuration: { ...browserRuntimeConfiguration(), ...options.configuration },
    inheritEnvironment: false,
    host: {
      ...configuredHost,
      receiveDownload: configuredHost?.receiveDownload || createNodeFileDownloadReceiver({
        artifactsRoot: artifactsRoot(), artifactUrl: ({ relativePath }) => artifactApiUrlFromRelative(relativePath),
      }),
      artifactPath: configuredHost?.artifactPath || ((runId) => artifactPath(runId)),
      runtimeState: configuredHost?.runtimeState || executeBrowserCodeRuntimeStateOperation,
      waitForManualVerification: configuredHost?.waitForManualVerification,
    },
  });
}
