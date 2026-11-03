# Capability SDK

**给已有 Agent 接上浏览器、Office、终端、代码、图表和知识检索能力，一个工具包即可接入。**

[English](README.md) · [全部工具](TOOLS.zh-CN.md) · [安装详情](SETUP.zh-CN.md) · [SDK 开发](SDK.zh-CN.md)

工具实现、输入参数、使用说明、结构化结果和本地运行环境一起交付。支持 MCP 的客户端可以直接连接；自有 Agent 可以选择需要的工具，在进程内调用。继续使用你已有的模型和任务编排。

当前独立版本为 **0.3.10**，通过 [GitHub Releases](https://github.com/cyxysky/capability-sdk/releases/tag/v0.3.10) 分发。安装器可直接使用 GitHub 包，npm 发布是可选的。npm 0.3.0 没有统一安装器。

## 能给 Agent 增加什么

| 能力 | 可以完成的工作 | 环境与配置 |
| --- | --- | --- |
| 浏览器 | 打开网页、读取 DOM、截图、填写和点击、管理会话 | 自动准备 Chromium |
| 文件与 Office | 读取、生成、修改、渲染和转换 Word、Excel、PowerPoint、PDF 等文件 | LibreOffice/UNO 与格式处理库 |
| 终端与代码 | 执行命令、管理终端会话、运行本地代码 | 本地进程与托管 Python |
| 图表 | 创建 ECharts、3D 可视化，预览与导出 | 随包提供可视化界面 |
| 知识检索 | 导入内容、检索相关片段 | 本地存储；部分服务可选配置 |
| 媒体 | 查看媒体信息、提取视频帧 | FFmpeg；OCR、转录、生成需配置 Provider |
| 计算机 | 观察并操作 Windows 桌面 | Windows 驱动或已配置的控制端点 |
| 地图、数据、连接器与通信 | 地图展示、数据库适配、业务系统与企业通信 | 按需启用，配置对应服务与凭据 |

通过[工具配置](MCP-CONFIG.zh-CN.md)选择暴露哪些能力。敏感数据检测属于独立的模型中间件，添加 MCP 连接不会自动拦截模型请求。

## 一键接入现有 Agent

需要 **Node.js >=22.16 和 npm**。自动准备运行环境支持 Windows x64，以及 Ubuntu 22.04/24.04、Debian 12/13 的 x64/arm64。macOS 暂不支持自动准备运行环境。

在 Windows PowerShell 运行：

```powershell
irm https://raw.githubusercontent.com/cyxysky/capability-sdk/main/install.ps1 | iex
```

在受支持的 Linux 系统运行：

```sh
curl -fsSL https://raw.githubusercontent.com/cyxysky/capability-sdk/main/install.sh | sh
```

脚本默认将 0.3.10 安装到 `~/.capability-tools`，准备运行环境，并为支持的客户端合并用户级 MCP 配置。npm 对应版本尚未发布时，自动下载 GitHub Release 包并验证 SHA-256。已有配置会备份；其他 MCP 服务会保留。完成后重新加载客户端，启用 `capability-sdk` 连接。

首次完整安装会下载数 GB 运行环境，失败后重试可复用缓存；Linux 的系统依赖安装可能需要 root 或免密码 sudo。[完整安装说明](SETUP.zh-CN.md)列出了每个客户端的配置路径和作用域。

在已审阅的本地源码目录，可先预览，再选择要接入的客户端：

```sh
node install.mjs --dry-run --clients cursor,codex,claude-code
node install.mjs --clients cursor,codex,claude-code --project ./agent-tools
```

支持配置 Cursor、Codex、Claude Code、Claude Desktop、VS Code、Windsurf 和 Devin。脚本安装工具并准备连接；这些客户端应用需自行安装。

## 接入自有 Agent

在你的 Agent 项目中安装发布包：

```sh
npm install https://github.com/cyxysky/capability-sdk/releases/download/v0.3.10/cjfclonedeep-capability-sdk-0.3.10.tgz
```

同版本发布到 npm 后，也可用 `npm install @cjfclonedeep/capability-sdk@0.3.10`。选择需要的工具，取出参数定义、说明与执行接口：

```js
import { createLocalCapabilities } from '@cjfclonedeep/capability-sdk/local';

const runtime = await createLocalCapabilities({ tools: ['browser', 'file', 'chart'] });
try {
  for (const { publicName, tool } of Object.values(runtime.snapshot.tools)) {
    console.log(publicName, tool.description, tool.input.jsonSchema);
  }
  // 将 runtime.snapshot 和 runtime.instructions 接入你的 Agent。
} finally {
  await runtime.dispose();
}
```

进程工作目录须指向准备好环境的工具项目。已有 `/ai-sdk`、`/openai`、`/mcp` 适配入口。[Agent 接入指南](AGENT-INTEGRATIONS.zh-CN.md)给出完整连接方式；[浏览器示例](examples/browser-read.mjs)无需模型调用即可执行一次工具操作。

浏览器代码使用运行时提供的 `page`。DOM 读取放在页面回调里：

```js
var info = await page.evaluate(() => ({ title: document.title }));
nodeRepl.write(info);
```

## 独立开发与发布

工具包拥有独立的 TypeScript 配置和依赖，不需要原 Agent 应用。维护者可在跳过大型运行环境下载的情况下做类型检查：

```powershell
$env:CAPABILITY_SKIP_RUNTIME_INSTALL = '1'
npm install
npm run typecheck
```

独立导出与手动发布流程见[维护说明](RELEASING.zh-CN.md)，对外介绍和演示建议见[推广草稿](docs/launch.zh-CN.md)。源码采用 [MIT 许可证](LICENSE)。依赖库与下载的第三方运行环境分别遵循各自许可证。
