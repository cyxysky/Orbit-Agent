# 发布介绍与演示草稿

以下材料供维护者审阅；尚未发到外部社区。仓库为 [cyxysky/capability-sdk](https://github.com/cyxysky/capability-sdk)，当前独立版本为 0.3.10。大规模传播前仍需在干净的 Windows 与受支持 Linux 上验证完整运行环境安装。

## 项目一句话

Capability SDK 给已有 Agent 补上浏览器、Office、终端、代码、图表和知识检索能力，统一提供工具接口、使用说明和本地运行环境。

GitHub 简介：

> Browser, Office, terminal, code, charts and knowledge tools for existing agents. One SDK or MCP server, with local runtime setup.

可选 GitHub topics：`mcp`、`agent-tools`、`typescript`、`browser-automation`、`office`、`automation`。

## 中文发布草稿

我把自己 Agent 项目里实际使用的工具层独立出来了：Capability SDK。

如果你已有 Agent，可以直接给它接上浏览器、Word/Excel/PowerPoint/PDF、终端、代码执行、图表和知识检索。每项能力一起提供参数定义、调用说明、结构化结果和运行环境准备，减少重复编写工具与处理本机依赖的工作。

支持两条接入路径：为 Cursor、Codex、Claude Code 等客户端配置 MCP，或在自己的 Node.js Agent 中挂载需要的工具。模型和任务编排由你现有的 Agent 负责。

仓库附安装脚本、完整工具说明，以及无需模型 API 的浏览器调用示例，欢迎提真实接入问题。

仓库：https://github.com/cyxysky/capability-sdk

许可证：MIT。Windows 一行安装：

```powershell
irm https://raw.githubusercontent.com/cyxysky/capability-sdk/main/install.ps1 | iex
```

需要 Node.js >=22.16 和 npm；首次完整安装会下载数 GB 的运行环境。受支持 Linux 的命令与平台说明见 README。

## English launch draft

I extracted the tool layer from an agent application into Capability SDK.

It gives existing agents browser automation, Office/PDF file operations, terminal sessions, local code execution, charts and knowledge retrieval. Tool implementations ship with schemas, operating instructions, structured results and local runtime preparation.

Connect a supported MCP client, or mount selected tools directly in a Node.js agent. Bring your own model and orchestration.

The repository includes installers, tool documentation and a browser example that runs without a model API. Feedback from actual integrations is welcome.

Repository: https://github.com/cyxysky/capability-sdk (MIT).

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/cyxysky/capability-sdk/main/install.ps1 | iex
```

Requires Node.js >=22.16 with npm. Full runtime preparation downloads several GB. See the README for supported Linux systems and their installer.

## 先完成的三个演示

| 演示 | 输入 | 展示的结果 |
| --- | --- | --- |
| 浏览器提取 | 一个可公开访问的网页与字段要求 | 结构化结果、来源 URL、对应截图 |
| Excel 处理 | 一份公开样例表与清洗要求 | 修改后的 Excel、数据检查结果与图表 |
| PDF 读取 | 一份公开 PDF 与提取要求 | 页码对应的提取结果与可下载文件 |

每段录制约 60–90 秒，同时提供原始输入与产物，让别人复现。只展示已经实际跑通的步骤；外部服务、密钥和平台限制放在相应示例旁。

## 发布顺序

1. 发布独立 GitHub 仓库、许可证和 0.3.10；验证 Windows 与受支持 Linux 的安装路径。
2. README 首页放一句话用途、安装命令、三个演示和接入方式；详细 API 留在现有文档。
3. 从现有主项目 README 链接到工具仓库，将主项目作为工具使用示例。
4. 先向使用 MCP、浏览器自动化和 Office 工具的开发者分享实际演示，收集安装与接入问题，再扩大发布范围。

优先记录安装成功情况、首个工具调用是否成功、真实接入问题和被复用的能力。这些能帮助改善工具包，也比单纯追逐 Star 更能指导后续开发。
