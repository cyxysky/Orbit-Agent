import { writeFile } from 'node:fs/promises';
import { configSchema, toolConfigurationKeys } from './mcp-config.mjs';

const introduction = `# MCP 按工具配置参考

本文与 mcp-config.schema.json 均由 scripts/mcp-config.mjs 中同一字段目录生成。适用于 0.3.0 及后续兼容版本，0.2.1 不包含此功能。

## 快速开始

在已安装依赖的项目根目录执行：

\`\`\`sh
npx --no-install capability-mcp init config
\`\`\`

生成 **capability.config.json**。CLI 启动时自动读取项目根目录的该文件，不必更改 Codex 的已有启动参数。\`init cursor\` 同时创建缺少的配置文件和 Cursor 连接配置；已有文件不会被覆盖。修改配置后重新连接 MCP，浏览器设置在新会话生效。

只调整部分设置的最小示例：

\`\`\`json
{
  "$schema": "./node_modules/@cjfclonedeep/capability-sdk/mcp-config.schema.json",
  "version": 1,
  "tools": {
    "browser": {
      "headless": false,
      "maxSessions": 4,
      "viewport": { "mode": "fixed", "width": 1440, "height": 900 }
    },
    "terminal": { "timeoutMs": 120000 },
    "file": { "officeGenerationMode": "uno" },
    "computer": { "enabled": false }
  }
}
\`\`\`

## 配置规则与模型操作说明

1. **读取实际文件再修改**，保留用户已有字段。不需要把所有字段都填上。init config 生成完整模板，其中的值都是显式设置，会覆盖对应环境变量。
2. JSON 使用真正的布尔值和数字：\`false\`、\`30000\`，不是字符串 \`"false"\`、\`"30000"\`。不支持注释、尾逗号、未知字段；启动错误会指出完整字段路径。
3. 项目根目录由 \`--project\`、\`CAPABILITY_PROJECT_DIR\`、进程工作目录依次确定。默认读取 \`capability.config.json\`；\`--config other.json\` 替换默认文件，相对路径仍按项目根目录解析。
4. 常规优先级为 **JSON 显式值 > 环境变量 > 内置默认值**。\`--skill-mode\` 覆盖 server.skillMode。\`--tools\` 选择候选工具组，再移除 enabled=false 的组，不能用它强行启用被配置禁用的工具。\`--list\` 仅显示平台可用组，不读取项目配置；实际注册结果由 MCP tools/list 返回。
5. 浏览器在统一入口默认 headless=true、isolated=true。maxSessions 和 idleTimeoutMs 由 JSON 设置；它们不读取 BROWSER_USER_BROWSER_IDLE_TIMEOUT_MS。后者是原应用的用户浏览器生命周期配置，不是 MCP 会话回收时间。
6. 连接已有浏览器时 isolated=false，填写 cdpEndpoint。持久化登录态时 isolated=false，填写 userDataDir，并设 maxSessions=1，避免同一配置目录被并发打开。两种模式互斥。CDP 连接使用现有浏览器，headless 不能控制它已存在的窗口。
7. 运行环境继续使用项目的 \`.capability-sdk/<平台>-<架构>\`；CAPABILITY_RUNTIME_HOME 显式覆盖仍有效。server.stateDirectory 仅控制 MCP 产物与工作区，改变它不会迁移旧文件。不要把它指向需要被当作临时工作区清理的其他业务目录。
8. 不把密码或令牌写入可提交的 JSON；computer.authorizationEnv 填的是环境变量**名称**，由 MCP 客户端传入真实值。配置说明或诊断不会输出密钥值。
9. 只有当前实现真正接入的设置列在下表。实时预览播放器、对话 UI、模型推理参数、敏感数据中间件不是此 MCP 配置的工具设置。不要从旧应用设置文件推断它们在此处有效。
10. 业务模型、数据库、通信连接仍需凭据和业务 Provider。可显式 \`--config ./business.mjs\` 返回现有 MCP options；它与自动读取的默认 JSON 共存，是高级代码入口，返回的 providers/configurations/policy 等可替换默认装配。普通用户只需要 JSON。\`--tools none\` 仅用于这种自定义模块。

配置模型可运行以下命令获取机器可读的完整说明，无需启动浏览器或下载环境：

\`\`\`sh
npx --no-install capability-mcp --describe-config
\`\`\`

编辑器通过 $schema 提供自动补全和字段提示；MCP 初始化说明也会指向本参考文件。不要用模型的工具调用参数修改宿主配置。

## 浏览器工具调用

默认 Windows 注册 8 个工具：browser、terminal、codeSandbox、file、chart、knowledge、media、computer。Linux 未配置桌面驱动时为 7 个；禁用组会减少数量，lazy Skill 模式会增加 skill。

浏览器现在只有一个 \`browser\` 工具。旧 browser_open/browser_code/browser_snapshot/browser_close 已移除，需要刷新 MCP 工具列表。参数按 action 严格校验：

| action | 必需字段 | 可选字段 | 功能 |
| --- | --- | --- | --- |
| open | action | url | 创建会话并返回 browserSessionId |
| code | action, browserSessionId, code | needChange, maxOutputChars | 执行 JavaScript；page、browser、nodeRepl 可用 |
| snapshot | action, browserSessionId | scope, frame, selector, query, cursor, maxOutputChars | 读取标签页和页面状态 |
| close | action, browserSessionId | 无 | 关闭指定会话并释放资源 |

\`\`\`json
{"action":"open","url":"https://example.com"}
\`\`\`

把真实返回的 browserSessionId 传给下一次调用：

\`\`\`json
{"action":"code","browserSessionId":"复制实际返回的 UUID","code":"nodeRepl.write(await page.title())"}
\`\`\`

会话 ID 不等于标签页 ID。配置中的 maxSessions 控制会话数量，不是单个浏览器的标签页数量。

## 字段参考

下表默认值在没有显式配置和对应环境变量时生效。computer.enabled 默认按平台和 endpoint 判断。路径相对于项目根目录；时间单位为毫秒。所有修改都按重新启动 MCP 后的行为说明。
`;

const lines = [introduction];
function fields(schema, prefix, group) {
  for (const [key, field] of Object.entries(schema.properties)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (field.type === 'object') { fields(field, name, group); continue; }
    const relative = name.startsWith(`tools.${group}.`) ? name.slice(`tools.${group}.`.length) : name;
    const env = toolConfigurationKeys[group]?.[relative];
    const limits = field.enum ? field.enum.join(', ') : field.minimum !== undefined ? `${field.minimum}–${field.maximum}` : field.const !== undefined ? String(field.const) : '—';
    const fallback = name === 'tools.computer.enabled' ? '自动判断' : JSON.stringify(field.default) ?? '—';
    lines.push(`| \`${name}\` | ${field.type} | \`${fallback}\` | ${limits} | ${field.description.replaceAll('|', '\\|')}${env ? ` 对应 \`${env}\`。` : ''} |`);
  }
}
for (const [name, schema] of [['server', configSchema.properties.server], ...Object.entries(configSchema.properties.tools.properties)]) {
  lines.push(`\n### ${name}\n\n${schema.description}\n\n| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |\n| --- | --- | --- | --- | --- |`);
  fields(schema, name === 'server' ? 'server' : `tools.${name}`, name);
}
await writeFile(new URL('../mcp-config.schema.json', import.meta.url), JSON.stringify(configSchema, null, 2) + '\n');
await writeFile(new URL('../MCP-CONFIG.zh-CN.md', import.meta.url), lines.join('\n') + '\n');
