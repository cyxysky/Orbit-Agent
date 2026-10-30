# 一键安装工具与配置 MCP

本入口随当前源码提供；旧版已安装包需要升级到包含 `scripts/setup.mjs` 的发布包。需要 Node.js >=22.16 和 npm，无需启动 Orbit。自动安装运行环境支持 Windows x64，以及 Ubuntu 22.04/24.04、Debian 12/13 的 x64/arm64。

## 在本仓库运行

Windows 在仓库根目录执行：

```powershell
.\install-mcp.cmd
```

跨平台等价命令：

```sh
npm run mcp:setup
```

默认复用本项目已准备好的 SDK，补齐缺少的 npm 依赖，安装/修复 Chromium、Python、LibreOffice/UNO、FFmpeg 和脱敏模型，创建缺少的 `capability.config.json`，再为下表客户端写入**用户级配置**。工具项目固定为此目录，各应用启动自己的 stdio 进程；不依赖 Orbit 的界面或 Web 服务，也不会执行 dev/build。

纯源码缺少 `dist` 时不能直接运行 MCP。请使用维护者准备好的 SDK 发布包，安装到单独目录；安装脚本不会替你编译源码。

## 安装到独立目录

使用包含此安装器的 SDK `.tgz`，从本仓库运行：

```powershell
.\install-mcp.cmd --project "D:\AgentTools" --package "D:\Downloads\capability-sdk.tgz"
```

也支持 `--package @cjfclonedeep/capability-sdk@<已发布版本>`。不要把 `<已发布版本>` 原样执行；版本必须包含统一安装器。此命令只安装 SDK 的依赖，不安装 Orbit。新目录会创建最小 `package.json`。发布包自身的 `capability-setup` 命令提供相同功能。

省略 `--package` 时优先复用目标项目已有 SDK；新目录使用安装器所在包的同版本 npm 包。该版本尚未发布时会明确失败，可改用 `.tgz`。已有旧包或本地补丁不会被自动升级覆盖。显式指定 `--package` 表示安装或升级。

## 已安装 SDK 时

```sh
# 安装/修复运行环境，配置全部支持的客户端
npx --no-install capability-mcp setup

# 只配置客户端，不安装运行环境
npx --no-install capability-mcp init all

# 仅配置指定客户端
npx --no-install capability-mcp setup --clients cursor,codex,claude-code

# 项目级配置：桌面专用客户端会跳过
npx --no-install capability-mcp init all --scope project
```

`init cursor`、`init codex`、`init claude-code`、`init vscode` 默认写项目级配置，保持原 `init cursor` 的作用域；其他客户端默认写用户级配置。`setup` 和 `init all` 默认写用户级配置。`--project` 选择工具的工作区、运行环境和产物目录，`--scope` 选择客户端配置保存的位置，两者互不替代。

## 支持的应用

`all` 指下表适用于当前平台和作用域的客户端，会为尚未安装的应用预先创建配置；不代表任意应用，也不安装客户端软件。

| 参数 | 用户级配置 | 项目级配置 |
| --- | --- | --- |
| `cursor` | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| `codex` | `$CODEX_HOME/config.toml`，默认 `~/.codex/config.toml` | `.codex/config.toml` |
| `claude-code` | `~/.claude.json`；设置 `CLAUDE_CONFIG_DIR` 时位于该目录 | `.mcp.json` |
| `claude-desktop` | Windows `%APPDATA%/Claude/claude_desktop_config.json`；macOS 对应 Application Support 目录 | 不支持 |
| `vscode` | Windows `%APPDATA%/Code/User/mcp.json`；macOS/Linux 对应默认用户配置目录 | `.vscode/mcp.json` |
| `windsurf` | 旧版 `~/.codeium/windsurf/mcp_config.json` | 不支持 |
| `devin` | Windows `%APPDATA%/devin/mcp_config.json`；macOS/Linux `$XDG_CONFIG_HOME/devin/mcp_config.json`，默认 `~/.config/devin/mcp_config.json` | 不支持 |

VS Code 支持 `VSCODE_PORTABLE` 指定的便携版默认用户目录；其他自定义 profile、远程容器或应用自定义配置位置不自动扫描。Claude Desktop 仅在 Windows/macOS 生成配置；macOS 的运行环境自动安装仍不支持，可对已自行准备环境的 SDK 使用 `init`。

格式和作用域依据：[Cursor](https://cursor.com/docs/mcp)、[Codex](https://developers.openai.com/codex/mcp/)、[Claude Code](https://code.claude.com/docs/en/mcp)、[Claude Desktop](https://modelcontextprotocol.io/docs/develop/connect-local-servers)、[VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)、[Devin（原 Windsurf）](https://docs.devin.ai/desktop/cascade/mcp)。

## 预览、已有配置与重复执行

```powershell
.\install-mcp.cmd --dry-run
.\install-mcp.cmd --clients cursor,codex --name capability-work
```

- `--dry-run` 不下载、不安装、不创建或修改配置。SDK 尚未安装时只显示安装计划，文件级校验需在 SDK 可用后执行。
- 先读取并校验所有选中配置，再安装运行环境和写入客户端配置。已知配置冲突会在下载运行环境前报错。
- 保留其他 MCP 服务、账号设置及 VS Code JSONC/TOML 注释；实际修改前在原文件旁保存 `*.capability-*.bak` 备份。
- 相同连接重复执行不改写；保留用户已有的额外字段和启用状态。同名不同连接报错，可用 `--name` 注册另一名称，或明确编辑原条目。
- 不自动重写 TOML 内联 `mcp_servers = {...}` 表；无法追加时提示先改为 `[mcp_servers.xxx]` 分节格式。
- 写入前重新检查文件，遇到其他进程修改会停止，重新运行即可继续。各文件分别保存，意外写入失败可能留下已完成的配置和对应备份。
- 配置使用本机 Node 和 SDK 的绝对路径，避免 GUI 的 PATH 差异；移动项目或 Node 后需更新连接配置。显式 `CAPABILITY_RUNTIME_HOME` 会转换为绝对路径并写入 MCP 的 `env`。

首次运行会下载数 GB 环境；失败后重试可复用缓存。Linux 系统依赖需要 root 或免密码 sudo。安装完成后重启/重载客户端，并按客户端提示启用或信任 MCP；脚本不替应用确认授权。

API Key、数据库、企业通信及自定义媒体 Provider 仍需自行配置。地图默认不启用，敏感数据模型也不会自动拦截客户端的模型请求。这里的“全部工具”指包内可自动准备的本地能力和运行环境，完整边界见 [运行环境](RUNTIME.zh-CN.md) 与 [工具配置](MCP-CONFIG.zh-CN.md)。
