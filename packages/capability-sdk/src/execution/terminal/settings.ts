import type { CapabilitySettingDefinition } from '../../index.ts';

export const terminalCapabilitySettings: readonly CapabilitySettingDefinition[] = [
  { key: 'AGENT_TERMINAL_ENABLED', label: '启用本地终端', description: '允许 Agent 在运行服务所在的机器上执行命令，操作受宿主权限控制。', section: 'runtime', group: '本地终端', defaultValue: 'false', control: 'boolean', applyMode: 'runtime' },
  { key: 'AGENT_TERMINAL_CWD', label: '默认工作目录', description: '命令的默认目录；留空使用应用工作目录。工作目录不是文件系统隔离边界。', section: 'runtime', group: '本地终端', defaultValue: '', control: 'text', applyMode: 'runtime', picker: 'directory' },
  { key: 'AGENT_TERMINAL_SHELL', label: '终端 Shell', description: 'auto 在 Windows 使用 PowerShell，在其他系统使用 Bash。Windows 支持 powershell/pwsh。', section: 'runtime', group: '本地终端', defaultValue: 'auto', control: 'select', applyMode: 'runtime', options: [{ label: '自动', value: 'auto' }, { label: 'Windows PowerShell', value: 'powershell' }, { label: 'PowerShell 7', value: 'pwsh' }, { label: 'Bash', value: 'bash' }, { label: 'sh', value: 'sh' }] },
  { key: 'AGENT_TERMINAL_TIMEOUT_MS', label: '命令最长运行时间', description: '超时后终止命令进程树；每次命令可请求更短的超时。', section: 'runtime', group: '本地终端', defaultValue: '120000', control: 'number', applyMode: 'runtime', min: 1000, max: 3600000, step: 1000 },
  { key: 'AGENT_TERMINAL_MAX_OUTPUT_CHARS', label: '输出缓冲上限', description: '每个进程待读取输出的最大字符数，超出时保留尾部并标记截断。', section: 'runtime', group: '本地终端', defaultValue: '50000', control: 'number', applyMode: 'runtime', min: 1000, max: 500000, step: 1000 },
  { key: 'AGENT_TERMINAL_MAX_PROCESSES', label: '并发进程上限', description: '每个能力运行实例同时运行的命令数量。', section: 'runtime', group: '本地终端', defaultValue: '4', control: 'number', applyMode: 'runtime', min: 1, max: 16, step: 1 },
];
