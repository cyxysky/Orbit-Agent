# 独立仓库与发布

独立仓库为 [cyxysky/capability-sdk](https://github.com/cyxysky/capability-sdk)，对外名称 **Capability SDK**，npm 包名沿用 `@cjfclonedeep/capability-sdk`。当前独立版本 **0.3.10** 包含统一安装器、最新工具实现与修复。

## 从当前主项目导出

在主项目根目录运行：

```sh
node packages/capability-sdk/scripts/export-repository.mjs --output ../capability-sdk --version 0.3.10 --dry-run
node packages/capability-sdk/scripts/export-repository.mjs --output ../capability-sdk --version 0.3.10
```

只复制 SDK 的源码、运行脚本、文档、示例和仓库配置；不复制原 Agent 应用、生成的 dist、数据库、下载的运行环境、用户配置或原项目 Git 历史。当前未提交的 SDK 修改也会包含。目标必须为空，已有目录不会覆盖或清理。

导出目录可初始化为独立仓库。先审阅 README、源码和许可证，再创建 GitHub 项目、推送源码。独立仓库成为工具包的维护入口后，原应用继续通过 npm 包消费，避免长期手动维护两份源码。

## 发布前需确定

- 维护者已选择 MIT，`LICENSE` 与 package.json 的 `license` 已添加；第三方组件分别遵循自己的许可。
- GitHub 仓库名称、公开范围与 npm 包维护权限。
- 对新增行为选择正确版本号；npm 已发布的 0.3.0 不能被覆盖。
- 独立仓库已提交 `package-lock.json`。修改依赖后更新锁文件；CI 使用 `npm ci` 固定依赖解析。

源码不再继承原应用的 tsconfig，Node、React、Three.js 等开发类型依赖也已显式列出。CI 只做类型检查和安装计划预览，不下载完整工具运行环境。

## 准备可分发包

独立仓库的 Actions 中手动运行 **Publish GitHub release and optionally npm**，保持 `publish=false`。流程在发布 runner 上准备 `.tgz`、检查许可证与 exports/bin/UI 文件，计算 SHA-256，然后创建同版本 GitHub Release。消费者使用准备好的发布包，不需要编译工具源码或启动原应用。安装器在 npm 版本尚未发布时自动使用此 Release。

拿到 `.tgz` 后，可在独立消费者目录做实际安装：

```sh
node scripts/setup.mjs --project /path/to/agent-tools --package /path/to/capability-sdk.tgz --clients cursor,codex,claude-code
```

Windows 将路径换为实际目录。必须验证 MCP 初始化、浏览器读取与一个 Office 操作；CI 的类型检查不能替代运行环境验证。本次源码拆分没有在本机执行 dev/build，也没有承诺完整运行环境已经重装验证。

## 发布 npm 与 GitHub Release

为 npm 包配置 GitHub Actions trusted publisher：账户 `cyxysky`、仓库 `capability-sdk`、工作流文件 `release.yml`，允许直接 `npm publish`。流程使用 OIDC 和 provenance，无需长期 npm token。配置方法见 [npm 官方文档](https://docs.npmjs.com/trusted-publishers/)；包的维护权限必须属于发布者。

需要同时发布 npm 时，手动运行相同工作流，选择 `publish=true`。它会校验许可证、发布 npm 包、创建同版本 GitHub Release 并上传 `.tgz` 与校验和。许可证或导出文件缺失时停止。已存在的 GitHub Release 不会被静默覆盖；后续修复先提高版本号。GitHub 托管 runner 使用 Node 24，满足 OIDC 对 npm/Node 的要求。

确认 GitHub Release 的安装包与校验和可以下载后，再传播安装命令。npm 登录或可信发布配置未就绪时，可先使用 GitHub 分发路径。将视频、输入样例与实际产物放进 Release，方便用户直接复现。

## 依赖与第三方运行环境

Chromium、LibreOffice、FFmpeg、Python、模型和 npm 依赖不是 SDK 原创代码。它们保留自己的许可证与通知。当前安装器下载并验证运行环境；首次独立源码发布不把本机下载的二进制或模型复制进 GitHub。若以后分发预打包运行环境，需要分别整理对应的许可与源码提供义务。
