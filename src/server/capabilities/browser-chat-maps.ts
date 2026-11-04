import { runtimeSetting } from '@/server/settings/runtime-configuration';
import { createGoogleMapsClient, createMapsCapability, createMapsTool, mapsCapabilitySettings, MapsError, type GoogleMapsOptions } from '@cjfclonedeep/capability-sdk/maps';
import { createFileSystemMapStore, reserveMapsRequest } from '@cjfclonedeep/capability-sdk/maps/node';
import { artifactPath, appDataRoot } from '@/server/storage/paths';
import path from 'node:path';
import { capabilityResultToBrowserActionResult } from './browser-chat-result';
import type { CapabilityConfiguration } from '@cjfclonedeep/capability-sdk';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


function mapScope(runId: string) {
  if (/^automation_run_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(runId)) return runId;
  const id = runId.match(/^(chat_[a-f0-9]{12})(?:_|$)/i)?.[1];
  if (!id) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Maps require a valid session run id.');
  return id;
}
export function browserChatMapStore(runId: string) { return createFileSystemMapStore(artifactPath(mapScope(runId), 'maps')); }
function mapConfiguration(): CapabilityConfiguration {
  return Object.fromEntries(mapsCapabilitySettings.map(setting => [setting.key, runtimeSetting(setting.key) ?? setting.defaultValue]));
}
function clientOptions(configuration: CapabilityConfiguration): GoogleMapsOptions {
  return { configuration, reserveRequest: (kind, signal) => reserveMapsRequest(path.join(appDataRoot(), '.data', 'maps-usage'), kind,
    Number(configuration[kind === 'search' ? 'GOOGLE_MAPS_SEARCH_MONTHLY_LIMIT' : 'GOOGLE_MAPS_ROUTES_MONTHLY_LIMIT'] ?? (kind === 'search' ? 4500 : 9000)), signal) };
}
export const browserChatMapsCapability = createMapsCapability({
  createStore: context => browserChatMapStore(context.runId), createClientOptions: context => clientOptions(context.configuration),
});
export async function executeBrowserChatMaps(runId: string, input: unknown, options: { abortSignal?: AbortSignal; invocationId?: string } = {}) {
  const tool = createMapsTool(browserChatMapStore(runId), clientOptions(mapConfiguration()));
  return capabilityResultToBrowserActionResult(await tool.execute(tool.input.parse(input), { ...options, invocationId: options.invocationId || `maps:${runId}` }));
}
export async function resolveBrowserChatMap(runId: string, mapId: string, signal?: AbortSignal) {
  const record = await browserChatMapStore(runId).read(mapId);
  if (!record) return undefined;
  const configuration = mapConfiguration();
  const browserKey = configuration.GOOGLE_MAPS_BROWSER_KEY?.trim();
  if (!browserKey) throw new MapsError(ERROR_CODES.MAPS_NOT_CONFIGURED, '请在设置 → 工具能力 → 地图中配置 Google 地图浏览器 Key。');
  const view = await createGoogleMapsClient(clientOptions(configuration)).resolve(record.request, signal);
  return { record, view, browserKey, language: configuration.GOOGLE_MAPS_LANGUAGE || 'zh-CN' };
}
