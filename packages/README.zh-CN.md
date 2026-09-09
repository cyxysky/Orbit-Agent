# 能力包接入指南

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

开发能力包时，相对导入必须指向实际源码文件，例如 `./types.ts` 或 `./react.tsx`。
共享 TypeScript 配置启用了 `rewriteRelativeImportExtensions`，发布编译时会自动生成
`./types.js` 等 JavaScript 路径。因此 Turbopack 和 Webpack 可以直接使用同一份源码，
无需扩展名别名。使用方仍然通过已发布的 `@webpilot/*` 入口导入。

从需要使用的能力包 README 开始。每个包都提供英文、简体中文、日文接入教程，命名示例文件创建在使用方项目中。普通能力遵循 SDK 契约，host 负责挂载，AI SDK/MCP 为可选适配；sensitive-data 则包装最终模型调用。

| 包 | 用途 |
| --- | --- |
| [capability-adapter-ai-sdk](capability-adapter-ai-sdk/README.zh-CN.md) | 将能力 Provider 转换为 AI SDK 7 工具和 Agent 指令。 |
| [capability-adapter-mcp](capability-adapter-mcp/README.zh-CN.md) | 通过 MCP 发布能力 Provider，独立于使用方 Agent 框架。 |
| [capability-browser](capability-browser/README.zh-CN.md) | 通过持久化 JavaScript 环境和页面观察控制 Playwright 浏览器。 |
| [capability-chart](capability-chart/README.zh-CN.md) | 创建、持久化和编辑 ECharts/Three.js 图表记录，可选接入 React 渲染。 |
| [capability-code-sandbox](capability-code-sandbox/README.zh-CN.md) | 通过可替换执行器运行受限 JavaScript/Python 计算。 |
| [capability-communication](capability-communication/README.zh-CN.md) | 创建消息草稿，通过已配置渠道发送并记录送达回执。 |
| [capability-computer](capability-computer/README.zh-CN.md) | 通过本地或远程驱动观察并操作交互式桌面。 |
| [capability-connectors](capability-connectors/README.zh-CN.md) | 发现并调用外部 MCP、OpenAPI 或自定义操作。 |
| [capability-data](capability-data/README.zh-CN.md) | 通过注入的驱动发现 SQL 数据源并执行受限查询。 |
| [capability-file](capability-file/README.zh-CN.md) | 读取和发布文件、生成与编辑 Office 文档，并管理文件产物工作区。 |
| [capability-git](capability-git/README.zh-CN.md) | 检查并显式修改宿主选定的一个 Git 仓库。 |
| [capability-host](capability-host/README.zh-CN.md) | 挂载 Provider，统一配置、工具选择和可移植 Skill 目录。 |
| [capability-knowledge](capability-knowledge/README.zh-CN.md) | 持久化参考文档并搜索索引文本。 |
| [capability-media](capability-media/README.zh-CN.md) | 检查媒体、提取视频帧，并接入宿主选定的 OCR、转录和生成引擎。 |
| [capability-sdk](capability-sdk/README.zh-CN.md) | 定义可移植能力契约及公共执行、生命周期机制。 |
| [capability-workflow](capability-workflow/README.zh-CN.md) | 持久化有依赖关系的工作流及已核实的检查点。 |
| [capability-sensitive-data](capability-sensitive-data/README.zh-CN.md) | 最终模型边界脱敏中间件 |

## 选择接入路线

1. 自定义 TypeScript Agent：具体 Provider → host.mountCapabilities → 原生工具/参数映射 → Agent Loop。[完整通用教程](capability-sdk/FRAMEWORK_INTEGRATION.zh-CN.md) 包括 Provider、解析、执行策略、Skill、首次调用和模型驱动 Agent。
2. AI SDK 7：安装 capability-adapter-ai-sdk，使用 mountAISDKCapabilities。
3. MCP：按[服务端/客户端教程](capability-adapter-mcp/MCP.zh-CN.md) 暴露一个或多个 Provider，包含 stdio 和有状态 HTTP 监听服务；远程使用方仅安装客户端依赖。
4. 直接调用：使用公开的底层导出，自行管理配置与生命周期。SDK 已是能力依赖；代码直接 import 时应声明直接依赖。
5. 敏感数据：完整组装提示（含 MCP 结果）后、每次调用模型前执行过滤。

## 发布与维护

每个目录是独立版本的 npm 包，使用相互匹配的已发布版本；示例对照当前 0.1.0 契约。README*.md、MCP*.md 及 SDK 的 FRAMEWORK_INTEGRATION*.md 均包含在发布 files 中。源码开发通过 npm workspaces 和根 TypeScript paths 使用本地包。无框架核心不导入 Orbit 应用代码，专用适配从显式入口访问。

manifest 归能力包管理，包含设置与 Skill；Agent 宿主负责工具可见性、Skill 预加载、操作审批、存储身份和模型循环。切换框架应只改适配层。公开契约或示例变化时同步更新三种语言，代码标识符与配置键保持一致。每份 README 可独立完成直接接入并随附自己的 MCP 教程，兄弟包链接是可选延伸阅读。
