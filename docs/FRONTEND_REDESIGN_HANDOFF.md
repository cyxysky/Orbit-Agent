# Orbit 前端重设计工作交接

更新日期：2026-11-03。整理时的生产代码基线：`f456f20`。

## 先看结论

用户已经确认喜欢 **Oil UI「全球财务 · 跨境结算」的分格与配色**，并明确要求侧边栏菜单的圆角不要那么大。当前已交付同一风格下的 A/B/C 三套全界面可浏览原型。

**视觉风格已确认，最终布局尚未选定。当前没有把这轮原型应用到生产 React 页面。** 上一位 AI 推荐 A，但这不是用户选定 A。接手后先让用户明确选 A/B/C、指定混搭区域，或明确授权你决定，再继续落地；不要将此前已经拒绝的设计重新当作目标。

本次提交发布的是原型源文件、离线预览、覆盖清单和本工作文档，不是已经完成的产品改版。

## 用户最新要求及不可忽略的约束

最新原话：

> https://ui.oiloil.org/works/global-settlement/，我觉得这种分格，配色不错，就是侧边栏菜单的 border-radius 不用这么大，你参照这种风格配色生成几版不同布局的所有界面看看。

范围已经从上一轮的“右上角按钮、浮层、弹窗、设置”扩展为**全部前端界面**。历史上用户多次不满意只调整字体、颜色，以及只改一个页面/弹窗的做法。因此下一轮必须处理信息组织、主次关系、布局、滚动区域和操作路径，不要只覆盖色值。

用户明确的工程约束：

1. 不需要运行项目 `dev` 和 `build`；不要擅自启动或重启生产开发进程。
2. 不需要考虑历史兼容，不保留无依据的旧分支和双套方案。
3. 不新增测试文件。允许适当的语法/类型检查与实际界面检查，报告清楚验证范围。
4. 所有修改考虑通用性；优先共享组件和布局，不给个别业务、弹窗或控件打补丁。
5. 工具调用尽可能使用 Capability SDK，发现可证实的 SDK 问题再修复，不把调用参数或外层 shell 编码错误当作 SDK 缺陷。
6. 保留其他工作树变更、业务数据、授权边界和已存在的功能修复。

这里的静态预览服务只提供文档目录，不会启动 Next.js 或应用后端。

## 原型入口及文件职责

在仓库根目录执行：

```powershell
node docs/design/global-settlement/serve.mjs
```

浏览 `http://127.0.0.1:4173/`；并排页为 `http://127.0.0.1:4173/comparison.html`。端口被占用时可加 `--port 4174`。从其他工作目录运行绝对脚本路径也可；服务根目录由脚本位置决定。

也可直接打开 [离线单文件](design/global-settlement/orbit-layouts.html)，它不需要 Node、依赖安装或网络。离线版包含三种布局、全部页面和浮层。并排页需要 HTTP 静态预览服务。

| 文件 | 用途 |
| --- | --- |
| [原型 README](design/global-settlement/README.md) | 快速打开、修改及打包说明 |
| `design/global-settlement/index.html` | 拆分源文件入口；顶部可选择布局、页面、浮层和主题 |
| `shared.js`、`base.css` | 通用图标、控件、变量、基础布局 |
| `shell.js` | 导航、布局切换、浮层宿主、焦点管理、预览反馈 |
| `settings.js`、`settings.css` | 7 类设置及技能/记忆/账号管理 |
| `workspaces.js`、`workspaces.css` | 对话、自动化、运营、浏览器库、演练 |
| `overlays.js`、`overlays.css` | 34 类弹窗、菜单、气泡和预览窗口 |
| `refinements.css` | 本轮截图后对布局、滚动和窄屏的调整 |
| `orbit-layouts.html` | 由拆分源文件生成的离线单文件，不要直接手改 |
| `comparison.html` | Oil UI 对比页外壳，已改成相对原型 URL |
| [覆盖清单](design/global-settlement/coverage.json) | 21 页面、34 浮层家族、43 源码入口映射 |
| `screenshots/` | A/B/C 对话、A 设置、操作确认的代表截图 |

修改原型后执行以下命令同步离线版。这只拼接静态文件，不是项目构建：

```powershell
node docs/design/global-settlement/package.mjs
```

本地 `.oil-ui/`、`.impeccable/`、`tmp/` 中的过程材料与截图采集脚本不作为交接依赖。其他电脑应以本次提交的 `docs/design/global-settlement/` 为准，不能依赖上一次会话的临时端口或绝对路径。

## 已建立的视觉方向

参考：[Global Settlement](https://ui.oiloil.org/works/global-settlement/)；方法来源：[Oil UI](https://github.com/oil-oil/oil-ui) 与 Impeccable。此处借鉴的是分区、配色、层级，不是金融业务内容，也不是引入一个新的组件库。

| 角色 | 值/原则 |
| --- | --- |
| 页面背景 | `#f3f4f4` |
| 主内容分区 | 白色；次级表面 `#f1f2f3` |
| 字段表面 | `#edeeee` |
| 主文本、重点区域 | `#1a2227` |
| 次级文本 | `#59636b`，保持可读对比 |
| 少量强调 | `#c4f95d`，不要把每个按钮都做成亮黄绿 |
| 分隔线 | `#e5e8e9` |
| 侧栏菜单圆角 | **6px**，避免大胶囊 |
| 常规按钮、字段圆角 | 约 8px |
| 主内容分格圆角 | 约 12–14px |
| 字体与密度 | 中文正文约 14–15px，辅助信息 12–13px；通过位置、分组和字重建立层级 |

三套布局的真正差别：

- **A 侧栏分区**：固定左侧导航，中间主任务，右侧工作区可收起；设置使用分区表单和辅助说明。适合频繁切换任务与工具。
- **B 上下工作台**：顶部导航，文件/浏览器/成果占据主区，下方对话支持收起或放大；设置按横向章节排列。
- **C 连续阅读**：无常驻侧栏，导航收进菜单；执行过程、来源和文件随任务记录展开；长编辑使用侧边工作面。

不要在生产里直接复制多套原型选择器。用户选定后只保留需要落地的一套视觉和结构；混搭时先明确各区域规则。

## 覆盖范围与生产组件位置

页面原型共 21 个：

- 对话、空白新对话。
- 自动化任务、任务详情、执行计划、执行记录。
- 外观与偏好、模型与供应商、Agent 运行、知识库、浏览器、工具能力、安全与隐私。
- 技能管理、个性化记忆、登录账号。
- AI 运营总览、趋势分析、用户与模型。
- 浏览器收藏/历史、新手演练。

34 类浮层包括：文件、记忆审核、操作确认、更多菜单、导出、下载管理、标签页分组、工具详情、日志、终端、实时浏览器、PDF、表格、Markdown、截图、图片、视频剪辑、生成内容、账号、技能、记忆、外部连接、模型能力、删除、导入、管理员验证、任务编辑、计划编辑、帮助、上下文、权限、模型选择、知识包导入、通知。

| 区域 | 生产入口/共享组件 |
| --- | --- |
| 对话与右上角操作 | `src/components/BrowserChatWorkspace.tsx`、`BrowserChatFilesPanel.tsx`、`BrowserChatRecoveryPanel.tsx`、`WorkspaceOverflowMenu.tsx` |
| 全局导航 | `src/components/WorkspaceSidebar.tsx` |
| 自动化 | `src/components/AutomationWorkspace.tsx` |
| 设置框架与字段 | `src/components/SettingsWorkspace.tsx`、`EnvironmentSettings.tsx`、`environment-settings-model.ts` |
| 设置子模块 | `KnowledgeSettings.tsx`、`ModelTypeSettings.tsx`、`ExternalIntegrationSettings.tsx`、`SensitiveDataRuntimeSettings.tsx` |
| 个人资源 | `SkillsManager.tsx`、`LoginAccountModal.tsx`，记忆与账号列表在 `EnvironmentSettings.tsx` |
| 运营中心 | `src/components/AiOperationsWorkspace.tsx` |
| 公共弹窗/浮层 | `src/components/ui/app-modal.tsx`、`ConfirmDeleteModal.tsx`、`HoverCard.tsx`、`CustomSelect.tsx` |
| 文件预览 | `src/components/FilePreviewProvider.tsx`、`OpenFileViewerSurface.tsx` |
| SDK 窗口 | `packages/capability-sdk/src/browser/preview/react.tsx`、`packages/capability-sdk/src/execution/terminal/react.tsx` |
| 独立页面 | `EmbeddedBrowserLibraryOverlay.tsx`、`TutorialSandbox.tsx` |
| 主题变量 | `src/app/styles/tokens.css` 及现有样式文件；以当前引用关系为准 |

覆盖清单中的旧行号用于定位线索，不是稳定 API。根路由是对话重定向；`chart-export` 是内部图表渲染端点，没有另造用户界面。

## 原型边界、已检查与未完成

所有页面内容和统计都是**合成示例数据**。模型名称、字段默认值、账号状态、权限说明等必须以实际代码/API 为最终依据，不能把原型里的示例变成新增业务规则。

已检查：

- 三套共 63 个桌面页面状态，以及 34 个浮层家族；另查看 B/C 的代表浮层、窄屏与深色设置状态。
- 实际点击文件到表格预览、供应商/模型类型切换、账号保存预览后关闭、正确的删除对象名称、菜单到技能页、工作区收起、底部对话收起/放大、Escape 关闭、长表单底部滚动。
- 预览脚本语法和静态 HTTP 入口；没有运行项目 dev/build，没有新增测试文件。

未完成：生产 React/HeroUI 改造、真实数据接线、应用级业务验证、真实保存/授权/执行/删除操作、全部生产交互与全部配置字段的完整验收。原型里的这些按钮只展示反馈，不写业务系统。不要声称它们已通过产品 E2E。

截图时曾用 CSS zoom 尝试模拟放大，该方式不等同原生浏览器缩放；最终补查的是 720×500 CSS 视口，不将其写成“浏览器原生 200% 已验证”。

## 接手实施顺序

1. 阅读本文件、`PRODUCT.md` 和原型，确认最终布局选择；直接沿用用户已确认的配色和小菜单圆角，避免重新发散。
2. 盘点当前工作树及页面状态。保留业务逻辑和授权策略，建立共享主题变量、页面框架、表单分区和浮层宿主。
3. 先落地代表性的真实对话页、设置页、操作确认和一个长编辑弹窗，验证实际数据/窄屏/滚动/键盘焦点，再覆盖全部清单。
4. 分清短菜单、锚定气泡、阻断确认、长表单、可调整大小的工具窗口。共享基础能力，但不要把它们强行变成同一种尺寸与布局。
5. 完整覆盖自动化、全部设置、个人资源、运营、文件/浏览器/终端及其他浮层。用覆盖清单逐项记录，不以一个账号弹窗代替所有弹窗。
6. 实际查看运行界面，验证长文本、空态、加载、错误、权限限制、深浅色和窄屏。设置保留真实自动保存，其他编辑保留原有提交语义。
7. 报告生产改动、检查方法和未覆盖事项。仍遵守不跑 dev/build、不新增测试文件的约束，除非用户明确修改要求。

### 不要被样式改造带回来的旧问题

用户曾报告文件预览的 Turbopack module factory 缺失，以及 `Failed to persist active context checkpoint`。本轮没有重新复现/修复这些后端问题，只确认当前代码中已有以下保护：

- `next.config.ts`：`turbopackLazyDynamicImports` 与 `turbopackLazyDynamicImportsSSR` 为 `false`。
- `FilePreviewProvider.tsx`：直接导入 `OpenFileViewerSurface`，并有本地 `SurfaceErrorBoundary`。
- `src/server/ai/agents/browser-chat.service.ts`：`persistBrowserChatCheckpoint` 使用 `commitPersistenceCheckpoint`，区分持久化提交与实时通知。

样式重构不要撤销这些行为，不要把清缓存当作已修复根因，也不要为了预览切换到 Webpack。若仍报错，应单独沿实际调用链诊断，不能直接归因 CSS。

### Capability SDK 操作提示

本会话通过 SDK 的终端与浏览器能力完成读取、截图和交互。源码模式脚本需要：

```powershell
node --loader ./server/backend-loader.mjs <你的 SDK 调用脚本.mjs>
```

不带 loader 的包导入失败不是已证实的 SDK 缺陷。Windows PowerShell 把含中文的 here-string 管道给 Node 前，应设置 `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`；源码编辑优先可靠的 UTF-8 补丁。临时 `tmp/cap-run.mjs` 没有作为公共依赖提交，接手时使用自身可用的 SDK 工具或按 SDK 文档创建入口。

## 可以直接交给下一位 AI 的任务说明

> 请先读 `docs/FRONTEND_REDESIGN_HANDOFF.md` 与 `PRODUCT.md`，打开 `docs/design/global-settlement/` 的原型。用户已确认 Global Settlement 的灰白/炭黑/亮黄绿分格风格，侧栏菜单圆角 6px；最终 A/B/C 布局尚待确定。接手后完成用户选定布局的真实前端改造，覆盖所有页面和浮层，不只调整字体颜色。保留现有业务能力、权限边界与文件预览/持久化保护，使用通用共享组件。不跑项目 dev/build，不新增测试文件，不为历史兼容保留多套实现，优先使用 Capability SDK。任何原型中的合成数据和模拟反馈都不能当作已实现业务功能。
