/** Shared settings metadata. Global switches do not replace per-session choices. */
export const toolCapabilitySettings = [
  { name: 'selfBootstrap', envKey: 'AGENT_TOOL_SELF_BOOTSTRAP_ENABLED', label: '自举与配置', description: '管理配置、注册运行字段，以及编写和验证隔离扩展；需要管理员身份和部署自举授权。' },
  { name: 'subagent', envKey: 'AGENT_TOOL_SUBAGENT_ENABLED', label: '子 Agent', description: '并行处理当前任务中确实独立的子任务；普通问答不需要派发子任务。' },
  { name: 'browser', envKey: 'AGENT_TOOL_BROWSER_ENABLED', label: '浏览器', description: '搜索并读取网页、操作页面、检查界面和截图。' },
  { name: 'file', envKey: 'AGENT_TOOL_FILE_ENABLED', label: '文件', description: '下载文件，读取 PDF、Word、Excel、PPT 的文本和表格，以及创建、修改和预览文档。' },
  { name: 'chart', envKey: 'AGENT_TOOL_CHART_ENABLED', label: '图表与画布', description: '创建和更新二维、三维图表，以及可编辑的 Excalidraw 画布。' },
  { name: 'maps', envKey: 'AGENT_TOOL_MAPS_ENABLED', label: '地图', description: '搜索 Google 地点，规划驾车、步行和骑行路线，并展示交互地图。' },
  { name: 'codeSandbox', envKey: 'AGENT_TOOL_CODE_SANDBOX_ENABLED', label: '代码沙箱', description: '运行隔离代码，计算和转换数据，执行自定义程序。普通 PDF 和 Office 内容读取使用文件工具。' },
  { name: 'connectors', envKey: 'AGENT_TOOL_CONNECTORS_ENABLED', label: 'MCP', description: '连接 MCP 服务，发现并调用其提供的工具。' },
  { name: 'knowledge', envKey: 'AGENT_TOOL_KNOWLEDGE_ENABLED', label: '知识库', description: '保存、检索和维护可复用的参考资料。' },
  { name: 'data', envKey: 'AGENT_TOOL_DATA_ENABLED', label: '数据源', description: '查询已配置的数据源，读取结构并分析数据。' },
  { name: 'media', envKey: 'AGENT_TOOL_MEDIA_ENABLED', label: '多媒体', description: '按模型和服务配置生成、转写或处理图片、音频和视频。' },
  { name: 'textEditor', envKey: 'AGENT_TOOL_TEXT_EDITOR_ENABLED', label: '文本编辑', description: '创建、编辑和导出纯文本、Markdown 与 HTML 文档，支持 AI 改写和内容预览。' },
  { name: 'communication', envKey: 'AGENT_TOOL_COMMUNICATION_ENABLED', label: '通信', description: '通过已配置的渠道读取消息、发送文字或文件。' },
  { name: 'terminal', envKey: 'AGENT_TOOL_TERMINAL_ENABLED', label: '本地终端', description: '在宿主机器执行命令、查看输出并管理命令进程。' },
  { name: 'computer', envKey: 'AGENT_TOOL_COMPUTER_ENABLED', label: '电脑操作', description: '通过已配置的电脑控制服务观察界面、点击和输入。' },
] as const;

export type ToolCapabilityName = typeof toolCapabilitySettings[number]['name'];
export type ToolCapabilityEnvironment = Readonly<Record<string, string | undefined>>;
export const toolConfigurationTargets: Record<string, string> = {
  subagent: '子 Agent',
  browser: 'capability:browser', file: '文件能力', maps: '地图', codeSandbox: '代码沙箱',
  connectors: 'integration:connector', knowledge: '知识库', data: 'integration:data',
  media: '媒体', communication: 'integration:communication', terminal: '本地终端', computer: '计算机',
};
export const TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT = 'orbit:tool-capability-settings-changed';

const settingsByName = new Map<string, typeof toolCapabilitySettings[number]>(
  toolCapabilitySettings.map(setting => [setting.name, setting]),
);

export function isToolCapabilityEnabled(name: string, env: ToolCapabilityEnvironment) {
  const setting = settingsByName.get(name);
  return !setting || !['false', '0', 'off', 'no'].includes((env[setting.envKey] || '').trim().toLowerCase());
}

export function globallyDisabledCapabilityTools(env: ToolCapabilityEnvironment): ToolCapabilityName[] {
  return toolCapabilitySettings.filter(setting => !isToolCapabilityEnabled(setting.name, env)).map(setting => setting.name);
}
