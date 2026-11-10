import type { RuntimeSettingDefinition, SettingsTab } from './settings';

type ConfiguredSetting = { item: { key: string }; definition?: RuntimeSettingDefinition };

export const integrationSettingsSections: Record<string, string> = {
  'MCP': 'integration:connector',
  '通信': 'integration:communication',
  '数据': 'integration:data',
};
export const browserRuntimeGroups = new Set(['站点访问规则', '浏览器观察', '实时预览', '浏览器实例', '导航与诊断', '浏览器 Agent', '浏览器调试']);
export const capabilityRuntimeGroups = new Set(['代码沙箱', '计算机', '文件能力', '本地终端', '知识库', '媒体', '地图', '数据与文件', ...Object.keys(integrationSettingsSections)]);
export const browserSettingsPages = [
  { id: 'access', label: '站点访问规则' },
  { id: 'interaction', label: '操作与观察' },
  { id: 'instance', label: '实例与会话' },
  { id: 'preview', label: '实时预览' },
  { id: 'diagnostics', label: '诊断与日志' },
] as const;
export type BrowserSettingsPage = (typeof browserSettingsPages)[number]['id'];

export function runtimeSettingGroup(tab: SettingsTab, key: string, configuredGroup?: string) {
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
    if (/^AI_(?:SYSTEM_PROMPT_|TOOL_PROMPT_MODE)/.test(key)) return '系统提示词';
    if (/^AI_(?:REQUEST_TIMEOUT|RUNTIME_REQUEST_TIMEOUT|RUNTIME_FIRST_CHUNK_TIMEOUT|STREAM_FIRST_CHUNK_TIMEOUT|STREAM_CHUNK_TIMEOUT)_MS$/.test(key)) return '请求超时';
    return '执行控制';
  }
  return '配置';
}

export function envSettingGroup(setting: ConfiguredSetting) {
  return runtimeSettingGroup(setting.definition?.tab || 'runtime', setting.item.key, setting.definition?.group);
}

export function envSettingDisplayTab(setting: ConfiguredSetting): SettingsTab {
  const sourceTab = setting.definition?.tab;
  const group = envSettingGroup(setting);
  if (sourceTab === 'browser' || browserRuntimeGroups.has(group)) return 'capabilities';
  if (sourceTab === 'runtime' && capabilityRuntimeGroups.has(group)) return 'capabilities';
  if (sourceTab === 'runtime' && group === '个性化记忆') return 'memory';
  return sourceTab || 'runtime';
}

export function envSettingSectionId(setting: ConfiguredSetting) {
  const group = envSettingGroup(setting);
  if (setting.definition?.tab === 'browser' || browserRuntimeGroups.has(group)) return 'capability:browser';
  if (group === '工具开关') return 'capability:overview';
  return integrationSettingsSections[group] || group;
}

export function browserSettingsPageFor(setting: ConfiguredSetting): BrowserSettingsPage {
  const group = envSettingGroup(setting);
  if (group === '站点访问规则') return 'access';
  const key = setting.item.key;
  if (group === '实时预览') return 'preview';
  if (group === '浏览器实例' || key === 'BROWSER_CHAT_KEEP_BROWSER_OPEN_AFTER_TURN') return 'instance';
  if (group === '导航与诊断' || group === '浏览器调试' || key === 'BROWSER_CHAT_LOG_LIMIT') return 'diagnostics';
  return 'interaction';
}

export function envSettingCardTitle(setting: ConfiguredSetting) {
  const key = setting.item.key;
  const group = envSettingGroup(setting);
  if (envSettingSectionId(setting) === 'capability:browser') {
    switch (browserSettingsPageFor(setting)) {
      case 'preview':
        if (/^BROWSER_(?:OUTPUT|SCREENCAST)/.test(key)) return '图像输出';
        if (/_TRANSPORT$|_SOURCE_FORMAT$|_KEYFRAME_INTERVAL$/.test(key)) return '传输与编码';
        return '视频画面';
      case 'instance':
        if (/^BROWSER_VIEWPORT_/.test(key)) return '视口尺寸';
        if (key === 'HEADLESS_BROWSER' || key === 'ELECTRON_EMBEDDED_BROWSER') return '浏览器进程';
        return '会话与缓存';
      case 'diagnostics':
        if (key.startsWith('BROWSER_NAVIGATION_')) return '页面稳定等待';
        if (/HTTP|LOG_LIMIT/.test(key)) return '网络与记录';
        return '执行诊断';
      default:
        if (key === 'BROWSER_CODE_AUTO_SCREENSHOT' || key === 'AI_VISUAL_HISTORY_LIMIT') return '视觉观察';
        if (key === 'MANUAL_VERIFICATION_TIMEOUT_MS' || key === 'BROWSER_CHAT_SHOW_REASONING') return '任务交互';
        return '操作方式';
    }
  }
  if (group === '请求超时') return /FIRST_CHUNK|STREAM_CHUNK/.test(key) ? '流式响应' : '模型请求';
  if (group === '代码沙箱') {
    if (/RUNNER_|_BACKEND$|_ENABLED$/.test(key)) return '执行环境';
    if (/NETWORK_MODE|ALLOW_PACKAGE_INSTALL|MAX_PACKAGES|INSTALL_TIMEOUT/.test(key)) return '网络与依赖';
    if (/MEMORY_MB|CPU_LIMIT|PIDS_LIMIT|WORKSPACE_MB/.test(key)) return '资源配额';
    return '执行限制';
  }
  if (group === 'Codex CLI') {
    if (/PATH$|CWD$/.test(key)) return '程序与目录';
    if (/APPROVAL|SANDBOX/.test(key)) return '访问权限';
    return '启动选项';
  }
  if (group === '本地终端') return /ENABLED|CWD|SHELL/.test(key) ? '终端环境' : '执行与输出';
  if (group === '地图') return /_KEY$|_LANGUAGE$/.test(key) ? '连接与语言' : '请求配额';
  if (group === '脱敏策略') return /THRESHOLD|LABELS/.test(key) ? '识别范围' : '过滤与失败策略';
  if (group === '推理服务') return /DEVICE|BATCH_SIZE/.test(key) ? '推理性能' : '服务连接';
  return group;
}

export function envSettingIsContextuallyVisible(setting: ConfiguredSetting, values: Map<string, string>) {
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
