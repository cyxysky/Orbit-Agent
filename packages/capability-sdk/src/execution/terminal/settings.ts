import type { CapabilitySettingDefinition } from '../../index.ts';

export const terminalCapabilitySettings: readonly CapabilitySettingDefinition[] = [
  { key: 'AGENT_TERMINAL_ENABLED', label: '启用本地终端', description: '允许 Agent 在运行服务所在的机器上执行命令，操作受宿主权限控制。', section: 'runtime', group: '本地终端', defaultValue: 'false', control: 'boolean', applyMode: 'runtime' },
  { key: 'AGENT_TERMINAL_CWD', label: '默认工作目录', description: '命令的默认目录；留空使用应用工作目录。工作目录不是文件系统隔离边界。', section: 'runtime', group: '本地终端', defaultValue: '', control: 'text', applyMode: 'runtime', picker: 'directory' },
  { key: 'AGENT_TERMINAL_SHELL', label: '终端 Shell', description: '新建终端使用的 Shell；auto 在 Windows 使用 PowerShell，在其他系统使用 Bash。已打开的终端保持原 Shell。', section: 'runtime', group: '本地终端', defaultValue: 'auto', control: 'select', applyMode: 'runtime', options: [{ label: '自动', value: 'auto' }, { label: 'Windows PowerShell', value: 'powershell' }, { label: 'PowerShell 7', value: 'pwsh' }, { label: 'Bash', value: 'bash' }] },
  { key: 'AGENT_TERMINAL_TIMEOUT_MS', label: '命令默认超时时间', description: '单位毫秒，0 表示不设上限；单次命令可覆盖。超时先中断前台命令，无响应时关闭终端。终端在多轮对话间保留，关闭对话或服务时清理。', section: 'runtime', group: '本地终端', defaultValue: '0', control: 'number', applyMode: 'runtime', min: 0, max: 3600000, step: 1000 },
  { key: 'AGENT_TERMINAL_MAX_OUTPUT_CHARS', label: '终端回滚缓冲', description: '每个终端保留的输出字符数；读取采用独立游标，超出时保留尾部并标记截断。', section: 'runtime', group: '本地终端', defaultValue: '50000', control: 'number', applyMode: 'runtime', min: 1000, max: 500000, step: 1000 },
  { key: 'AGENT_TERMINAL_MAX_PROCESSES', label: '同时打开的终端数', description: '每个用户在同一对话中可以同时打开的终端数量。关闭终端后释放名额。', section: 'runtime', group: '本地终端', defaultValue: '4', control: 'number', applyMode: 'runtime', min: 1, max: 16, step: 1 },
];
