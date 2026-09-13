# MCP 按工具配置参考

本文与 mcp-config.schema.json 均由 scripts/mcp-config.mjs 中同一字段目录生成。适用于 0.3.0 及后续兼容版本，0.2.1 不包含此功能。

## 快速开始

在已安装依赖的项目根目录执行：

```sh
npx --no-install capability-mcp init config
```

生成 **capability.config.json**。CLI 启动时自动读取项目根目录的该文件，不必更改 Codex 的已有启动参数。`init cursor` 同时创建缺少的配置文件和 Cursor 连接配置；已有文件不会被覆盖。修改配置后重新连接 MCP，浏览器设置在新会话生效。

只调整部分设置的最小示例：

```json
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
```

## 配置规则与模型操作说明

1. **读取实际文件再修改**，保留用户已有字段。不需要把所有字段都填上。init config 生成完整模板，其中的值都是显式设置，会覆盖对应环境变量。
2. JSON 使用真正的布尔值和数字：`false`、`30000`，不是字符串 `"false"`、`"30000"`。不支持注释、尾逗号、未知字段；启动错误会指出完整字段路径。
3. 项目根目录由 `--project`、`CAPABILITY_PROJECT_DIR`、进程工作目录依次确定。默认读取 `capability.config.json`；`--config other.json` 替换默认文件，相对路径仍按项目根目录解析。
4. 常规优先级为 **JSON 显式值 > 环境变量 > 内置默认值**。`--skill-mode` 覆盖 server.skillMode。`--tools` 选择候选工具组，再移除 enabled=false 的组，不能用它强行启用被配置禁用的工具。`--list` 仅显示平台可用组，不读取项目配置；实际注册结果由 MCP tools/list 返回。
5. 浏览器在统一入口默认 headless=true、isolated=true。maxSessions 和 idleTimeoutMs 由 JSON 设置；它们不读取 BROWSER_USER_BROWSER_IDLE_TIMEOUT_MS。后者是原应用的用户浏览器生命周期配置，不是 MCP 会话回收时间。
6. 连接已有浏览器时 isolated=false，填写 cdpEndpoint。持久化登录态时 isolated=false，填写 userDataDir，并设 maxSessions=1，避免同一配置目录被并发打开。两种模式互斥。CDP 连接使用现有浏览器，headless 不能控制它已存在的窗口。
7. 运行环境继续使用项目的 `.capability-sdk/<平台>-<架构>`；CAPABILITY_RUNTIME_HOME 显式覆盖仍有效。server.stateDirectory 仅控制 MCP 产物与工作区，改变它不会迁移旧文件。不要把它指向需要被当作临时工作区清理的其他业务目录。
8. 不把密码或令牌写入可提交的 JSON；computer.authorizationEnv 填的是环境变量**名称**，由 MCP 客户端传入真实值。配置说明或诊断不会输出密钥值。
9. 只有当前实现真正接入的设置列在下表。实时预览播放器、对话 UI、模型推理参数、敏感数据中间件不是此 MCP 配置的工具设置。不要从旧应用设置文件推断它们在此处有效。
10. 业务模型、数据库、通信连接仍需凭据和业务 Provider。可显式 `--config ./business.mjs` 返回现有 MCP options；它与自动读取的默认 JSON 共存，是高级代码入口，返回的 providers/configurations/policy 等可替换默认装配。普通用户只需要 JSON。`--tools none` 仅用于这种自定义模块。

配置模型可运行以下命令获取机器可读的完整说明，无需启动浏览器或下载环境：

```sh
npx --no-install capability-mcp --describe-config
```

编辑器通过 $schema 提供自动补全和字段提示；MCP 初始化说明也会指向本参考文件。不要用模型的工具调用参数修改宿主配置。

## 浏览器工具调用

默认 Windows 注册 8 个工具：browser、terminal、codeSandbox、file、chart、knowledge、media、computer。Linux 未配置桌面驱动时为 7 个；禁用组会减少数量，lazy Skill 模式会增加 skill。

浏览器现在只有一个 `browser` 工具。旧 browser_open/browser_code/browser_snapshot/browser_close 已移除，需要刷新 MCP 工具列表。参数按 action 严格校验：

| action | 必需字段 | 可选字段 | 功能 |
| --- | --- | --- | --- |
| open | action | url | 创建会话并返回 browserSessionId |
| code | action, browserSessionId, code | needChange, maxOutputChars | 执行 JavaScript；page、browser、nodeRepl 可用 |
| snapshot | action, browserSessionId | scope, frame, selector, query, cursor, maxOutputChars | 读取标签页和页面状态 |
| close | action, browserSessionId | 无 | 关闭指定会话并释放资源 |

```json
{"action":"open","url":"https://example.com"}
```

把真实返回的 browserSessionId 传给下一次调用：

```json
{"action":"code","browserSessionId":"复制实际返回的 UUID","code":"nodeRepl.write(await page.title())"}
```

会话 ID 不等于标签页 ID。配置中的 maxSessions 控制会话数量，不是单个浏览器的标签页数量。

## 字段参考

下表默认值在没有显式配置和对应环境变量时生效。computer.enabled 默认按平台和 endpoint 判断。路径相对于项目根目录；时间单位为毫秒。所有修改都按重新启动 MCP 后的行为说明。


### server

MCP 服务级配置。路径相对于 --project 选定的项目根目录。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `server.name` | string | `"capability-sdk"` | — | 客户端显示的 MCP 服务名称。 |
| `server.skillMode` | string | `"eager"` | eager, lazy | eager 在初始化时提供说明；lazy 增加 skill 工具按需读取说明。 |
| `server.stateDirectory` | string | `".capability-sdk/mcp"` | — | MCP 文件、知识库和工作区的存储目录。不会移动已安装的 Chromium/Python 等运行环境。 |
| `server.visualization.enabled` | boolean | `true` | — | 是否提供可视化界面；false 时只返回原有工具数据。 |
| `server.visualization.preview` | boolean | `true` | — | 提供带随机访问令牌的 127.0.0.1 浏览器预览链接；链接在 MCP 进程退出后失效。 |
| `server.visualization.port` | integer | `0` | 0–65535 | 本地预览端口；0 自动分配，避免多个 agent 冲突。仅监听 127.0.0.1。 |
| `server.visualization.readOnly` | boolean | `false` | — | 禁止预览页面写回服务器；仍可临时编辑和导出，不改变 agent 调用 chart update 的权限。 |
| `server.visualization.staticImages` | boolean | `true` | — | 为二维 ECharts 生成 PNG 回填；其他引擎保留交互页面和文字/链接，避免自动启动额外浏览器。 |

### browser

一个 browser 工具，action 为 open/code/snapshot/close。配置共享于此 MCP 的浏览器会话。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `tools.browser.enabled` | boolean | `true` | — | 是否注册该工具；false 时不加载模块，不向 MCP 客户端暴露此工具。修改后重启 MCP。 |
| `tools.browser.headless` | boolean | `true` | — | true 隐藏浏览器窗口；false 显示窗口。覆盖 HEADLESS_BROWSER/BROWSER_HEADLESS。 |
| `tools.browser.isolated` | boolean | `true` | — | true 使用隔离会话与随包 Chromium，忽略外部 CDP 和用户配置目录。使用 cdpEndpoint/userDataDir 时必须设为 false。 |
| `tools.browser.maxSessions` | integer | `8` | 1–100 | 同时打开的 browser 会话上限；超过后 open 返回容量错误。复用固定用户配置目录时应设为 1。 |
| `tools.browser.idleTimeoutMs` | integer | `900000` | 0–86400000 | 会话空闲回收时间（毫秒）；0 禁用回收。执行中的调用不会因空闲超时被关闭。 |
| `tools.browser.slowMoMs` | integer | `0` | 0–10000 | 浏览器操作延迟（毫秒），用于观察操作过程；不等同于导航超时。 |
| `tools.browser.viewport.mode` | string | `"auto"` | auto, fixed | auto 按浏览器运行方式选择视口；fixed 使用下面的 width/height。 对应 `BROWSER_VIEWPORT_MODE`。 |
| `tools.browser.viewport.width` | integer | `1440` | 1–16384 | fixed 模式的视口宽度（CSS 像素）。 对应 `BROWSER_VIEWPORT_WIDTH`。 |
| `tools.browser.viewport.height` | integer | `900` | 1–16384 | fixed 模式的视口高度（CSS 像素）。 对应 `BROWSER_VIEWPORT_HEIGHT`。 |
| `tools.browser.ignoreHTTPSErrors` | boolean | `false` | — | 是否忽略 HTTPS 证书错误。仅在需要访问对应测试环境时开启。 对应 `BROWSER_IGNORE_HTTPS_ERRORS`。 |
| `tools.browser.screenshotTimeoutMs` | integer | `15000` | 1000–120000 | 单次截图超时（毫秒）。 对应 `SCREENSHOT_TIMEOUT_MS`。 |
| `tools.browser.outputPixelRatio` | number | `1.5` | 1–2 | 截图输出像素倍率，不改变网页 CSS 视口。 对应 `BROWSER_OUTPUT_PIXEL_RATIO`。 |
| `tools.browser.domQuietMs` | integer | `250` | 0–60000 | 导航后等待 DOM 连续稳定的时间窗口（毫秒）。 对应 `BROWSER_NAVIGATION_DOM_QUIET_MS`。 |
| `tools.browser.domStabilityTimeoutMs` | integer | `1000` | 0–120000 | 导航后等待 DOM 稳定的最长时间（毫秒）。 对应 `BROWSER_NAVIGATION_DOM_STABILITY_TIMEOUT_MS`。 |
| `tools.browser.executablePath` | string | `""` | — | 指定 Chromium 可执行文件；空字符串使用项目内已安装的 Chromium。相对路径按项目根目录解析。 对应 `AI_WEB_TEST_CHROMIUM_EXECUTABLE_PATH`。 |
| `tools.browser.cdpEndpoint` | string | `""` | — | 连接已启动浏览器的 CDP 地址；需 isolated=false。不会自动安装或启动外部浏览器。 对应 `BROWSER_CDP_ENDPOINT`。 |
| `tools.browser.userDataDir` | string | `""` | — | 持久化浏览器配置目录，保存登录态；需 isolated=false、maxSessions=1，且不与 cdpEndpoint 同时设置。相对路径按项目根目录解析。 对应 `BROWSER_USER_DATA_DIR`。 |

### terminal

项目本地终端；以当前用户权限执行，不提供 OS 隔离。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `tools.terminal.enabled` | boolean | `true` | — | 是否注册该工具；false 时不加载模块，不向 MCP 客户端暴露此工具。修改后重启 MCP。 对应 `AGENT_TERMINAL_ENABLED`。 |
| `tools.terminal.cwd` | string | `"."` | — | 终端工作目录，相对于项目根目录。 |
| `tools.terminal.shell` | string | `"auto"` | auto, powershell, pwsh, bash, sh | auto 在 Windows 使用 PowerShell，Linux 使用 Bash；选择 pwsh 时需自行安装 PowerShell 7。 对应 `AGENT_TERMINAL_SHELL`。 |
| `tools.terminal.timeoutMs` | integer | `120000` | 1000–3600000 | 命令最长运行时间（毫秒），工具调用可请求更短时间。 对应 `AGENT_TERMINAL_TIMEOUT_MS`。 |
| `tools.terminal.maxOutputChars` | integer | `50000` | 1000–500000 | 每个进程的输出缓冲字符上限。 对应 `AGENT_TERMINAL_MAX_OUTPUT_CHARS`。 |
| `tools.terminal.maxProcesses` | integer | `4` | 1–16 | 此 MCP 实例的终端并发进程上限。 对应 `AGENT_TERMINAL_MAX_PROCESSES`。 |

### code

codeSandbox：本地 JavaScript/Python 执行与产物保存。临时工作区按执行器隔离。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `tools.code.enabled` | boolean | `true` | — | 是否注册该工具；false 时不加载模块，不向 MCP 客户端暴露此工具。修改后重启 MCP。 对应 `AGENT_CODE_SANDBOX_ENABLED`。 |
| `tools.code.timeoutMs` | integer | `30000` | 1000–300000 | 单次代码执行超时（毫秒）。 对应 `AGENT_CODE_SANDBOX_TIMEOUT_MS`。 |
| `tools.code.installTimeoutMs` | integer | `120000` | 5000–300000 | 依赖安装与执行共享的时间预算（毫秒）。 对应 `AGENT_CODE_SANDBOX_INSTALL_TIMEOUT_MS`。 |
| `tools.code.maxOutputChars` | integer | `30000` | 1000–200000 | stdout/stderr 合计字符上限；输出文件通过独立产物通道保存。 对应 `AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS`。 |
| `tools.code.maxConcurrent` | integer | `2` | 1–16 | 本地代码执行器的并发任务上限。 对应 `AGENT_CODE_SANDBOX_MAX_CONCURRENCY`。 |
| `tools.code.allowPackageInstall` | boolean | `true` | — | 是否允许代码任务安装固定版本的 npm/Python 包。 对应 `AGENT_CODE_SANDBOX_ALLOW_PACKAGE_INSTALL`。 |
| `tools.code.maxPackages` | integer | `16` | 0–32 | 单次任务最多安装的依赖数量。 对应 `AGENT_CODE_SANDBOX_MAX_PACKAGES`。 |

### file

文件读写、Office 生成和转换。visual QA 需要具备图像能力的宿主单独接入。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `tools.file.enabled` | boolean | `true` | — | 是否注册该工具；false 时不加载模块，不向 MCP 客户端暴露此工具。修改后重启 MCP。 |
| `tools.file.officeGenerationMode` | string | `"uno"` | uno, javascript, auto | uno 使用 LibreOffice；javascript 使用 ExcelJS/HTML 文档管线；auto 由现有文件工具选择。 对应 `OFFICE_GENERATION_MODE`。 |

### chart

图表创建、读取和更新；产物保存在 server.stateDirectory/artifacts/charts。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `tools.chart.enabled` | boolean | `true` | — | 是否注册该工具；false 时不加载模块，不向 MCP 客户端暴露此工具。修改后重启 MCP。 |
| `tools.chart.retainedRevisions` | integer | `20` | 1–1000 | 每张图表保留的历史修订数量。 |

### maps

可选 Google Maps 工具；show 无密钥可生成位置示意，搜索/路线需要服务端 Key，底图需要浏览器 Key。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `tools.maps.enabled` | boolean | `false` | — | 是否启用 maps；默认不启用。 |
| `tools.maps.browserKeyEnv` | string | `"GOOGLE_MAPS_BROWSER_KEY"` | — | Maps JavaScript API 浏览器 Key 所在环境变量名；该 Key 会提供给页面，需限制网站来源。 |
| `tools.maps.serverKeyEnv` | string | `"GOOGLE_MAPS_SERVER_KEY"` | — | Places/Routes 服务端 Key 所在环境变量名；不会发送给预览页面。 |
| `tools.maps.language` | string | `"zh-CN"` | — | 地图语言，例如 zh-CN、en。 |
| `tools.maps.searchMonthlyLimit` | integer | `4500` | 0–100000 | 项目内每月搜索调用上限；0 停用搜索。 |
| `tools.maps.routesMonthlyLimit` | integer | `9000` | 0–100000 | 项目内每月路线调用上限；0 停用路线。 |

### knowledge

持久化参考资料知识库；保存在 server.stateDirectory/knowledge。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `tools.knowledge.enabled` | boolean | `true` | — | 是否注册该工具；false 时不加载模块，不向 MCP 客户端暴露此工具。修改后重启 MCP。 |
| `tools.knowledge.chunkChars` | integer | `1800` | 400–8000 | 全文索引每个分块的目标字符数。 对应 `AGENT_KNOWLEDGE_CHUNK_CHARS`。 |
| `tools.knowledge.searchLimit` | integer | `8` | 1–30 | 知识检索默认返回条数。 对应 `AGENT_KNOWLEDGE_SEARCH_LIMIT`。 |

### media

默认实现本地媒体检查和视频抽帧；OCR/转写/生成需业务 Provider，不会自动接入模型。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `tools.media.enabled` | boolean | `true` | — | 是否注册该工具；false 时不加载模块，不向 MCP 客户端暴露此工具。修改后重启 MCP。 |
| `tools.media.timeoutMs` | integer | `120000` | 1000–900000 | FFmpeg 处理超时（毫秒）；媒体头检查最长 15 秒。 对应 `AGENT_MEDIA_TIMEOUT_MS`。 |
| `tools.media.maxFrames` | integer | `12` | 1–60 | 每次抽帧最多生成的帧数。 对应 `AGENT_MEDIA_MAX_FRAMES`。 |

### computer

Windows 内置桌面驱动，或自行配置的远程驱动。其他平台无 endpoint 时默认不注册。

| 字段 | 类型 | 默认值 | 可选值/范围 | 说明 |
| --- | --- | --- | --- | --- |
| `tools.computer.enabled` | boolean | `自动判断` | — | 默认自动判断平台：Windows 或配置 endpoint 时启用。显式 false 禁用；不支持的平台显式 true 会报错。 对应 `AGENT_COMPUTER_ENABLED`。 |
| `tools.computer.endpoint` | string | `""` | — | 外部桌面驱动地址；空字符串在 Windows 使用内置驱动。 对应 `AGENT_COMPUTER_ENDPOINT`。 |
| `tools.computer.authorizationEnv` | string | `""` | — | 包含外部驱动 Authorization 值的环境变量名称；不在 JSON 中保存密钥。 |
| `tools.computer.timeoutMs` | integer | `30000` | 1000–300000 | 单次桌面操作超时（毫秒）。 对应 `AGENT_COMPUTER_TIMEOUT_MS`。 |
