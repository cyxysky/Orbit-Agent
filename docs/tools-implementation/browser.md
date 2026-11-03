# 浏览器 browser：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.browser`。公开工具名：`browser`。动作覆盖：`state`、`snapshot`、`code`、`dismissSurface`、`observe`、`act`、`images`、`navigate`、`tabs`、`waitForHumanVerification`、`requestUserInput`、`mcp`。并发边界：serial / browser；会话调度器另管页面执行。

## Orbit 实际使用的四种模式

宿主 browserInteractionSchema 替换 SDK 默认三动作 schema。DOM 模式发布 state/snapshot/code/dismissSurface 和公共控制；visual 发布 observe/act/images/dismissSurface 和公共控制；hybrid 合并 DOM 与 visual；MCP 发布 mcp/dismissSurface 和公共控制。公共控制为 navigate/tabs/waitForHumanVerification/requestUserInput。当前会话模式决定允许动作，历史内容不能扩大当前 schema。

| 宿主动作 | 实际实现与结果 |
| --- | --- |
| snapshot | readDomObservationSnapshot 按 actionable/full/text 模式读取元素、UID、当前 surface 与稳定分页 cursor；同时追加当前 Playwright AX 树；过期捕获返回 browser-snapshot-stale |
| dismissSurface | 在当前 viewport 的 (0,0) 直接点击；返回 closureConfirmed/outcome，支持截图时再捕获；DOM/hybrid/MCP 追加 postActionState。点击送达与弹层真正关闭分别表达 |
| navigate | 要求绝对 HTTP(S) URL 或 about:blank，在活动页导航；非 visual 模式追加实时页面状态 |
| tabs | list/open/select/close 仅操作本会话拥有的标签页；select/close 要求当前目录中的 tabId，open 可传 URL；列表不附额外页面状态 |
| observe | 捕获当前 viewport PNG 并返回 observationId；有界等待文档加载和像素稳定，失败不假装已看到当前画面 |
| act | 要求 observationId 和 kind；click/hover/move/drag/scroll 使用 CSS viewport 像素而非电脑物理像素；drag 带终点，type 带 text，key 带单键/组合键；执行前比较文档、路由、surface、滚动和 viewport，拒绝旧证据；鼠标修饰键在 finally 释放 |
| images | 从宿主持有的视觉上下文选择最多 12 个历史 imageIds；空数组清空历史选择，当前图始终保留；无图像模型拒绝视觉动作 |
| requestUserInput | 要求非空 question；在启动浏览器前返回 userInput.requested，让同一任务进入等待用户文字/附件的状态 |
| mcp | tool=list 从与 Patchright 同版本的 MCP 子进程读取当前目录；准确 browser_* 名称交给官方实现。屏蔽 unsafe code、关闭浏览器、模型管理 tabs 和不可靠 console 消息；每次按活动 URL 唯一确认会话页面；多匹配时拒绝执行 |

MCP client 按 BrowserSession 缓存初始化 Promise，连接失败删除缓存，session.onClose 关闭客户端。MCP 结果保留完整文本，图像写为本轮真实产物；除目录读取外追加 postActionState。code 对实际尝试的输入附 postActionState；条件动作未执行时标记 actionOutcome=skipped 并附 recoveryState；页面显式 HTTP 错误另外附 pageErrorIndicators。

## 从请求到浏览器

SDK 的 browserToolInput 先经 normalizeBrowserToolInput 统一动作字段，再使用动作专属解析器进行校验。createBrowserTools 把三个动作绑定到 BrowserCapabilityOperations；Node 实现绑定现有 BrowserSession。Orbit 在挂载后替换浏览器工具的描述、输入 schema 和 execute，因此浏览器实际执行入口还要看 runtime-browser-interaction.ts，不能只依据 SDK 默认入口。

BrowserSession 管理浏览器连接、宿主拥有的标签页、活动页、生命周期、下载和预览。启动/接管行为来自宿主配置和现有会话，工具不为每个调用重新启动一套浏览器。执行携带 runId、stepIndex、附件、凭据和取消信号；宿主可额外拒绝特定代码。BrowserSession 的调度与截止时间管理负责协调同一会话的操作。

## 各动作

| 动作 | 实际执行逻辑 | 输出及状态变化 |
| --- | --- | --- |
| state | 确保会话启动，读取活动页面、标签页、页面观察和 DOM/可访问树；支持 scope、frame、selector、query 和 cursor | 文本状态和观察证据；分页延续同一份捕获，不执行页面点击 |
| code | 在持久 Node 代码内核运行 JavaScript，注入 page、context、browser、tab 和 nodeRepl；代码可通过 Playwright 操作页面 | 收集写出的数据、截图、活动及错误；变量在同一内核后续调用中可复用 |
| waitForHumanVerification | 确保页面存在，再等待人工验证或取消/超时 | 返回验证等待状态；不自动识别并绕过验证码 |

### state 的分页一致性

BrowserStateReader 创建捕获 ID，并保留页面对象、页面修订、捕获时间、原始筛选条件和完整输出。cursor 是捕获 ID 与偏移量的 base64url 编码。续页必须仍属于同一页面、URL 和修订，时间不超过 120 秒，且筛选条件不变。无效或过期游标要求重新读取。输出截断按既有捕获分页，避免不同 DOM 顺序造成漏读。

### code 的执行边界

外层代码运行在 Node：document/window 只能在 page.evaluate 等浏览器回调内使用。回调通过参数接收输入并返回可序列化值。nodeRepl.write 收集输出；截图走内核提供的图像输出接口。图片能力关闭时，含图像操作的代码会被拒绝。内核检查策略、输出大小、内存和使用寿命，并处理取消与连接失效。

browser-code-cdp-scope 建立会话专属 CDP 通道，限制附着到宿主拥有的页面和弹出页，避免连接其他会话或等待其挂起的渲染器。附件与凭据由宿主绑定；代码执行并不允许从任意输入猜测凭据。页面 DOM、UID、坐标及截图证据的收集/校验在 observation、snapshot 和 interaction 模块中完成。

## 输出、预览与释放

browserOperationToCapabilityResult 将 BrowserActionResult 转为 CapabilityResult，保留结构化数据、失败类别和图片；宿主再映射成模型可见的 actual。预览服务通过帧泵、视频编码、网络及会话诊断向客户端更新画面。disposeSession 为真时 Node operations 关闭会话，否则只释放本轮能力，让宿主管理会话寿命。浏览器操作失败与目标操作成功是两个独立判断，后续页面观察用于确认实际结果。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `BROWSER_CODE_AUTO_SCREENSHOT` | true | runtime | 每次浏览器代码执行后截取当前视口，供支持图片的模型观察。关闭后不自动截图或附加旧截图；代码主动截图不受影响。 |
| `BROWSER_PREVIEW_FPS` | 20 | runtime | 实时预览轮询截图并发送的目标帧率。 |
| `BROWSER_OUTPUT_PIXEL_RATIO` | 1.5 | runtime | 提高系统截图的输出像素密度，不改变网页 CSS 视口。 |
| `BROWSER_SCREENCAST_FORMAT` | jpeg | runtime | JPEG 体积较小；PNG 无损但编码和传输开销更高。 |
| `BROWSER_SCREENCAST_QUALITY` | 90 | runtime | 仅对 JPEG 生效。数值越高画质越好，开销也越高。 |
| `BROWSER_PREVIEW_TRANSPORT` | video | runtime | 使用 H.264 视频流或独立图片帧传输实时预览。 |
| `BROWSER_PREVIEW_VIDEO_BITRATE_KBPS` | 空 | runtime | H.264 视频目标码率，留空时按分辨率和帧率自动估算。 |
| `BROWSER_PREVIEW_VIDEO_SOURCE_FORMAT` | jpeg | runtime | 选择送入 H.264 编码器的源图片格式。 |
| `BROWSER_PREVIEW_VIDEO_MAX_WIDTH` | 1920 | runtime | 视频编码宽度上限，只进行等比缩小。 |
| `BROWSER_PREVIEW_VIDEO_MAX_HEIGHT` | 1080 | runtime | 视频编码高度上限，只进行等比缩小。 |
| `BROWSER_PREVIEW_VIDEO_KEYFRAME_INTERVAL` | 15 | runtime | H.264 关键帧间隔，单位为帧。 |
| `BROWSER_PROFILE_CLEAR_CACHE_ON_CLOSE` | true | startup | 浏览器进程完全关闭后清理缓存并保留登录态及站点数据。 |
| `BROWSER_USER_BROWSER_IDLE_TIMEOUT_MS` | 180000 | runtime | 没有运行中的对话和实时预览后，等待该时长关闭测试浏览器。 |
| `ELECTRON_EMBEDDED_BROWSER` | false | startup | 桌面端对话使用 Electron 原生浏览器视图。 |
| `HEADLESS_BROWSER` | false | startup | 是否隐藏浏览器窗口运行。 |
| `BROWSER_VIEWPORT_MODE` | auto | startup | 自动跟随真实窗口，或使用固定视口尺寸。 |
| `BROWSER_VIEWPORT_WIDTH` | 空 | startup | 固定视口模式下的浏览器宽度。 |
| `BROWSER_VIEWPORT_HEIGHT` | 空 | startup | 固定视口模式下的浏览器高度。 |
| `BROWSER_NAVIGATION_DOM_QUIET_MS` | 250 | runtime | 导航提交后 DOM 连续保持不变达到该时长即生成语义快照。 |
| `BROWSER_NAVIGATION_DOM_STABILITY_TIMEOUT_MS` | 1000 | runtime | 等待导航后 DOM 稳定的最长时间。 |
| `BROWSER_IGNORE_HTTPS_ERRORS` | false | startup | 测试环境证书异常时允许继续打开页面。 |
| `BROWSER_HTTP_REQUEST_HISTORY_LIMIT` | 400 | runtime | 每个标签页保留的 HTTP 请求记录数。 |
| `AI_HTTP_REQUEST_TOOL_LIMIT` | 80 | runtime | 浏览器工具单次返回的最近 HTTP 请求条数。 |
| `SCREENSHOT_TIMEOUT_MS` | 15000 | runtime | Playwright 截图等待上限，单位毫秒。 |
| `MANUAL_VERIFICATION_TIMEOUT_MS` | 180000 | runtime | 验证码、登录或设备验证的最长等待时间。 |
| `BROWSER_CHAT_KEEP_BROWSER_OPEN_AFTER_TURN` | true | runtime | 每轮对话完成后保留浏览器，以便后续对话复用。 |
| `BROWSER_CHAT_ACTION_FRAME_LIMIT` | 24 | runtime | 每次动作参与交互校验与 DOM 增量采集的 frame 数量。 |
| `BROWSER_CHAT_SHOW_REASONING` | false | runtime | 是否在对话模式中展示模型返回的推理内容。 |
| `BROWSER_CHAT_LOG_LIMIT` | 2000 | runtime | 每个浏览器对话最多保留的执行日志条数。 |
| `AI_VISUAL_HISTORY_LIMIT` | 6 | runtime | Visual Context Manager 保留的历史图片数量。 |
| `AI_COMPLETION_VERIFY` | true | runtime | Agent 声明完成后是否再进行一次完成校验。 |
| `PLAYWRIGHT_TRACE` | true | startup | 是否保存 Playwright trace。 |

权限契约：`browser:launch`、`browser:cdp`、`network:access`、`artifact:write`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/browser/index.ts](../../packages/capability-sdk/src/browser/index.ts)

- [normalizeBrowserToolInput](../../packages/capability-sdk/src/browser/index.ts#L87)?：函数，第?? 87 ?? 行。
- [browserOperationSummary](../../packages/capability-sdk/src/browser/index.ts#L158)?：函数，第?? 158 ?? 行。
- [browserOperationToCapabilityResult](../../packages/capability-sdk/src/browser/index.ts#L162)?：函数，第?? 162 ?? 行。
- [browserOperationFromCapabilityResult](../../packages/capability-sdk/src/browser/index.ts#L185)?：函数，第?? 185 ?? 行。
- [createBrowserTools](../../packages/capability-sdk/src/browser/index.ts#L227)?：函数，第?? 227 ?? 行。
- [createBrowserCapability](../../packages/capability-sdk/src/browser/index.ts#L252)?：函数，第?? 252 ?? 行。

### [packages/capability-sdk/src/browser/node/capability.ts](../../packages/capability-sdk/src/browser/node/capability.ts)

- [createNodeBrowserOperations](../../packages/capability-sdk/src/browser/node/capability.ts#L32)?：函数，第?? 32 ?? 行。
- [createNodeBrowserCapability](../../packages/capability-sdk/src/browser/node/capability.ts#L91)?：函数，第?? 91 ?? 行。

### [packages/capability-sdk/src/browser/node/browser-session.ts](../../packages/capability-sdk/src/browser/node/browser-session.ts)

- [fixedBrowserViewportFromEnv](../../packages/capability-sdk/src/browser/node/browser-session.ts#L50)?：函数，第?? 50 ?? 行。
- [browserOutputPixelRatioFromEnv](../../packages/capability-sdk/src/browser/node/browser-session.ts#L57)?：函数，第?? 57 ?? 行。
- [timeBrowserClickStage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L226)?：函数，第?? 226 ?? 行。
- [normalizeDomSearchText](../../packages/capability-sdk/src/browser/node/browser-session.ts#L383)?：函数，第?? 383 ?? 行。
- [indexDomNodeReference](../../packages/capability-sdk/src/browser/node/browser-session.ts#L391)?：函数，第?? 391 ?? 行。
- [isSnapshotReference](../../packages/capability-sdk/src/browser/node/browser-session.ts#L950)?：函数，第?? 950 ?? 行。
- [installLivePreviewVisibilityReporter](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1084)?：函数，第?? 1084 ?? 行。
- [timedBrowserStep](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1100)?：函数，第?? 1100 ?? 行。
- [mapWithConcurrency](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1113)?：函数，第?? 1113 ?? 行。
- [normalizedOriginSet](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1132)?：函数，第?? 1132 ?? 行。
- [BrowserSession](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1143)?：类，第?? 1143 ?? 行。
- [BrowserSession.browserDownloads](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1145)?：方法，第?? 1145 ?? 行。
- [BrowserSession.withSessionOperation](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1157)?：方法，第?? 1157 ?? 行。
- [BrowserSession.captureVisualFrame](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1211)?：方法，第?? 1211 ?? 行。
- [BrowserSession.captureBrowserObservation](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1309)?：方法，第?? 1309 ?? 行。
- [BrowserSession.executeBrowserControl](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1341)?：方法，第?? 1341 ?? 行。
- [BrowserSession.executeVisualBrowserAction](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1398)?：方法，第?? 1398 ?? 行。
- [BrowserSession.getBrowserObservation](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1528)?：方法，第?? 1528 ?? 行。
- [BrowserSession.automaticBrowserScreenshotEnabled](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1551)?：方法，第?? 1551 ?? 行。
- [BrowserSession.configure](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1611)?：方法，第?? 1611 ?? 行。
- [BrowserSession.runtimeEnvironment](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1624)?：方法，第?? 1624 ?? 行。
- [BrowserSession.configuredValue](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1628)?：方法，第?? 1628 ?? 行。
- [BrowserSession.snapshotFrameConcurrency](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1632)?：方法，第?? 1632 ?? 行。
- [BrowserSession.isUsable](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1642)?：方法，第?? 1642 ?? 行。
- [BrowserSession.currentUrl](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1652)?：方法，第?? 1652 ?? 行。
- [BrowserSession.browserAutomationConnection](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1661)?：方法，第?? 1661 ?? 行。
- [BrowserSession.focusActivePage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1666)?：方法，第?? 1666 ?? 行。
- [BrowserSession.onClose](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1670)?：方法，第?? 1670 ?? 行。
- [BrowserSession.hasNonBlankActivePage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1675)?：方法，第?? 1675 ?? 行。
- [BrowserSession.exportStorageState](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1683)?：方法，第?? 1683 ?? 行。
- [BrowserSession.sessionStorageByOrigin](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1687)?：方法，第?? 1687 ?? 行。
- [BrowserSession.forkChildSession](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1707)?：方法，第?? 1707 ?? 行。
- [BrowserSession.injectCookies](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1789)?：方法，第?? 1789 ?? 行。
- [BrowserSession.start](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1801)?：方法，第?? 1801 ?? 行。
- [BrowserSession.ensureStarted](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1834)?：方法，第?? 1834 ?? 行。
- [BrowserSession.startNow](../../packages/capability-sdk/src/browser/node/browser-session.ts#L1838)?：方法，第?? 1838 ?? 行。
- [BrowserSession.selectInitialSessionGroupPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2077)?：方法，第?? 2077 ?? 行。
- [BrowserSession.findInitialSharedPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2086)?：方法，第?? 2086 ?? 行。
- [BrowserSession.chooseInitialPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2111)?：方法，第?? 2111 ?? 行。
- [BrowserSession.isElectronEmbeddedBrowserPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2115)?：方法，第?? 2115 ?? 行。
- [BrowserSession.isElectronEmbeddedBrowserSessionPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2124)?：方法，第?? 2124 ?? 行。
- [BrowserSession.findElectronEmbeddedBrowserSessionPages](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2136)?：方法，第?? 2136 ?? 行。
- [BrowserSession.reclaimSessionPagesByMarker](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2147)?：方法，第?? 2147 ?? 行。
- [BrowserSession.reclaimPagesFromNativeTabGroup](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2161)?：方法，第?? 2161 ?? 行。
- [BrowserSession.sessionTabGrouperWorker](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2173)?：方法，第?? 2173 ?? 行。
- [BrowserSession.findNativeTabGroupTabs](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2183)?：方法，第?? 2183 ?? 行。
- [BrowserSession.chooseNativeTabGroupTab](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2199)?：方法，第?? 2199 ?? 行。
- [BrowserSession.activateNativeTabGroupTab](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2206)?：方法，第?? 2206 ?? 行。
- [BrowserSession.waitForNativeGroupPages](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2227)?：方法，第?? 2227 ?? 行。
- [BrowserSession.prepareContext](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2237)?：方法，第?? 2237 ?? 行。
- [BrowserSession.installOwnedPageDiscovery](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2253)?：方法，第?? 2253 ?? 行。
- [BrowserSession.installElectronEmbeddedBrowserPageDiscovery](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2261)?：方法，第?? 2261 ?? 行。
- [BrowserSession.claimPopupIfOwned](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2280)?：方法，第?? 2280 ?? 行。
- [BrowserSession.notifyLivePreviewTabsChanged](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2305)?：方法，第?? 2305 ?? 行。
- [BrowserSession.claimPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2318)?：方法，第?? 2318 ?? 行。
- [BrowserSession.releaseOwnedPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2362)?：方法，第?? 2362 ?? 行。
- [BrowserSession.handleLivePreviewVisibility](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2371)?：方法，第?? 2371 ?? 行。
- [BrowserSession.sessionPages](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2392)?：方法，第?? 2392 ?? 行。
- [BrowserSession.browserCodeTargetId](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2396)?：方法，第?? 2396 ?? 行。
- [BrowserSession.browserCodeOwnedTargetIds](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2412)?：方法，第?? 2412 ?? 行。
- [BrowserSession.browserSlowMoMs](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2416)?：方法，第?? 2416 ?? 行。
- [BrowserSession.actionFrames](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2422)?：方法，第?? 2422 ?? 行。
- [BrowserSession.selectInitialPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2435)?：方法，第?? 2435 ?? 行。
- [BrowserSession.tabGroupLabel](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2447)?：方法，第?? 2447 ?? 行。
- [BrowserSession.artifactDirectory](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2451)?：方法，第?? 2451 ?? 行。
- [BrowserSession.tabTitlePrefix](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2467)?：方法，第?? 2467 ?? 行。
- [BrowserSession.stripTabTitlePrefix](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2471)?：方法，第?? 2471 ?? 行。
- [BrowserSession.pageGroupMarkerInput](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2476)?：方法，第?? 2476 ?? 行。
- [BrowserSession.markPageGroup](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2485)?：方法，第?? 2485 ?? 行。
- [BrowserSession.ensurePageGroup](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2501)?：方法，第?? 2501 ?? 行。
- [BrowserSession.ensureBrowserPageRuntime](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2513)?：方法，第?? 2513 ?? 行。
- [BrowserSession.readPageObservation](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2531)?：方法，第?? 2531 ?? 行。
- [BrowserSession.pageObservationLine](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2582)?：方法，第?? 2582 ?? 行。
- [BrowserSession.currentTitle](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2586)?：方法，第?? 2586 ?? 行。
- [BrowserSession.bringToFront](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2594)?：方法，第?? 2594 ?? 行。
- [BrowserSession.installAccessibilitySnapshotExportControl](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2598)?：方法，第?? 2598 ?? 行。
- [BrowserSession.readPageGroupId](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2621)?：方法，第?? 2621 ?? 行。
- [BrowserSession.readPageNativeTabId](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2633)?：方法，第?? 2633 ?? 行。
- [BrowserSession.ensureLivePreviewState](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2641)?：方法，第?? 2641 ?? 行。
- [BrowserSession.livePreviewTabId](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2666)?：方法，第?? 2666 ?? 行。
- [BrowserSession.getTabsSnapshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2675)?：方法，第?? 2675 ?? 行。
- [BrowserSession.restoreTabsFromSnapshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2688)?：方法，第?? 2688 ?? 行。
- [BrowserSession.refreshSessionGroupPages](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2768)?：方法，第?? 2768 ?? 行。
- [BrowserSession.refreshTabsSnapshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2814)?：方法，第?? 2814 ?? 行。
- [BrowserSession.activateSessionPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2819)?：方法，第?? 2819 ?? 行。
- [BrowserSession.applyConfiguredViewport](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2842)?：方法，第?? 2842 ?? 行。
- [BrowserSession.switchLivePreviewTab](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2890)?：方法，第?? 2890 ?? 行。
- [BrowserSession.startScreencast](../../packages/capability-sdk/src/browser/node/browser-session.ts#L2905)?：方法，第?? 2905 ?? 行。
- [BrowserSession.liveFileControlForElement](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3287)?：方法，第?? 3287 ?? 行。
- [BrowserSession.liveFileControlAt](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3332)?：方法，第?? 3332 ?? 行。
- [BrowserSession.liveNativeControlAt](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3355)?：方法，第?? 3355 ?? 行。
- [BrowserSession.liveDownloadLinkAt](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3434)?：方法，第?? 3434 ?? 行。
- [BrowserSession.relayLivePreviewDownload](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3471)?：方法，第?? 3471 ?? 行。
- [BrowserSession.applyLiveSelectValue](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3483)?：方法，第?? 3483 ?? 行。
- [BrowserSession.applyLiveControlValue](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3512)?：方法，第?? 3512 ?? 行。
- [BrowserSession.applyLiveFiles](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3539)?：方法，第?? 3539 ?? 行。
- [BrowserSession.notifyLivePreviewNative](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3559)?：方法，第?? 3559 ?? 行。
- [BrowserSession.dismissPendingLiveDialogs](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3569)?：方法，第?? 3569 ?? 行。
- [BrowserSession.clearPendingLiveFileInputs](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3582)?：方法，第?? 3582 ?? 行。
- [BrowserSession.resolveLiveDialog](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3588)?：方法，第?? 3588 ?? 行。
- [BrowserSession.dispatchLiveInput](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3606)?：方法，第?? 3606 ?? 行。
- [BrowserSession.closeOwnedPages](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3831)?：方法，第?? 3831 ?? 行。
- [BrowserSession.clearElectronEmbeddedSessionData](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3838)?：方法，第?? 3838 ?? 行。
- [BrowserSession.attachLivePreviewDownloadListener](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3886)?：方法，第?? 3886 ?? 行。
- [BrowserSession.attachPageListeners](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3896)?：方法，第?? 3896 ?? 行。
- [BrowserSession.detachPageListeners](../../packages/capability-sdk/src/browser/node/browser-session.ts#L3986)?：方法，第?? 3986 ?? 行。
- [BrowserSession.captureLivePreviewDownload](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4000)?：方法，第?? 4000 ?? 行。
- [BrowserSession.rememberVisitedOrigin](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4051)?：方法，第?? 4051 ?? 行。
- [BrowserSession.recordDomChangeError](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4060)?：方法，第?? 4060 ?? 行。
- [BrowserSession.open](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4095)?：方法，第?? 4095 ?? 行。
- [BrowserSession.readBrowserState](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4136)?：方法，第?? 4136 ?? 行。
- [BrowserSession.dismissBrowserSurface](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4149)?：方法，第?? 4149 ?? 行。
- [BrowserSession.readStructuredPageText](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4206)?：方法，第?? 4206 ?? 行。
- [BrowserSession.readDomObservation](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4212)?：方法，第?? 4212 ?? 行。
- [BrowserSession.getPageContext](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4301)?：方法，第?? 4301 ?? 行。
- [BrowserSession.detectManualVerificationContext](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4380)?：方法，第?? 4380 ?? 行。
- [BrowserSession.scanCaptchaInputFields](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4388)?：方法，第?? 4388 ?? 行。
- [BrowserSession.buildScreenshotFailureError](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4433)?：方法，第?? 4433 ?? 行。
- [BrowserSession.collectScreenshotFailureDiagnostics](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4448)?：方法，第?? 4448 ?? 行。
- [BrowserSession.capturePngBuffer](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4492)?：方法，第?? 4492 ?? 行。
- [BrowserSession.capturePngScreenshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4551)?：方法，第?? 4551 ?? 行。
- [BrowserSession.updateLastScreenshotMetrics](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4560)?：方法，第?? 4560 ?? 行。
- [BrowserSession.takeScreenshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4588)?：方法，第?? 4588 ?? 行。
- [BrowserSession.takeCurrentScreenshotOnly](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4671)?：方法，第?? 4671 ?? 行。
- [BrowserSession.getLastScreenshotTiming](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4698)?：方法，第?? 4698 ?? 行。
- [BrowserSession.debugInteractiveCandidateScan](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4707)?：方法，第?? 4707 ?? 行。
- [BrowserSession.resetInterActionChangeJournal](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4759)?：方法，第?? 4759 ?? 行。
- [BrowserSession.readInterActionChangeJournal](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4784)?：方法，第?? 4784 ?? 行。
- [BrowserSession.getCurrentTabHttpRequests](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4837)?：方法，第?? 4837 ?? 行。
- [BrowserSession.waitForPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4842)?：方法，第?? 4842 ?? 行。
- [BrowserSession.wait](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4876)?：方法，第?? 4876 ?? 行。
- [BrowserSession.browserCodeUidReferences](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4884)?：方法，第?? 4884 ?? 行。
- [BrowserSession.executeBrowserCode](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4911)?：方法，第?? 4911 ?? 行。
- [BrowserSession.executeBrowserCodeCell](../../packages/capability-sdk/src/browser/node/browser-session.ts#L4971)?：方法，第?? 4971 ?? 行。
- [BrowserSession.waitForManualVerification](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5208)?：方法，第?? 5208 ?? 行。
- [BrowserSession.getLifecycleState](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5234)?：方法，第?? 5234 ?? 行。
- [BrowserSession.getNetworkErrors](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5239)?：方法，第?? 5239 ?? 行。
- [BrowserSession.close](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5244)?：方法，第?? 5244 ?? 行。
- [BrowserSession.closeNow](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5265)?：方法，第?? 5265 ?? 行。
- [BrowserSession.waitForStableViewport](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5350)?：方法，第?? 5350 ?? 行。
- [BrowserSession.isTargetClosedError](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5369)?：方法，第?? 5369 ?? 行。
- [BrowserSession.manualVerificationNote](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5375)?：方法，第?? 5375 ?? 行。
- [BrowserSession.getFocusedElement](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5382)?：方法，第?? 5382 ?? 行。
- [BrowserSession.detectManualVerification](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5451)?：方法，第?? 5451 ?? 行。
- [BrowserSession.detectManualVerificationDetails](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5459)?：方法，第?? 5459 ?? 行。
- [BrowserSession.getViewportSize](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5479)?：方法，第?? 5479 ?? 行。
- [BrowserSession.getViewportMetrics](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5484)?：方法，第?? 5484 ?? 行。
- [BrowserSession.getPageScrollState](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5502)?：方法，第?? 5502 ?? 行。
- [BrowserSession.refreshScrollableAreas](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5510)?：方法，第?? 5510 ?? 行。
- [BrowserSession.finalizeInteractiveCandidates](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5597)?：方法，第?? 5597 ?? 行。
- [BrowserSession.refreshInteractiveCandidates](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5616)?：方法，第?? 5616 ?? 行。
- [BrowserSession.rectContains](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5627)?：方法，第?? 5627 ?? 行。
- [BrowserSession.refreshFrameInteractiveCandidates](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5640)?：方法，第?? 5640 ?? 行。
- [BrowserSession.watchForPopup](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5685)?：方法，第?? 5685 ?? 行。
- [BrowserSession.claimPopupPage](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5698)?：方法，第?? 5698 ?? 行。
- [BrowserSession.settlePopupAfterAction](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5719)?：方法，第?? 5719 ?? 行。
- [BrowserSession.compareCandidateOrder](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5732)?：方法，第?? 5732 ?? 行。
- [BrowserSession.comparePathString](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5745)?：方法，第?? 5745 ?? 行。
- [BrowserSession.getFramePath](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5755)?：方法，第?? 5755 ?? 行。
- [BrowserSession.frameFromPath](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5769)?：方法，第?? 5769 ?? 行。
- [BrowserSession.elementHandleForDomPath](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5781)?：方法，第?? 5781 ?? 行。
- [BrowserSession.elementHandleForDomReference](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5806)?：方法，第?? 5806 ?? 行。
- [BrowserSession.describeTopmostAtViewportPoint](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5823)?：方法，第?? 5823 ?? 行。
- [BrowserSession.snapshotPageId](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5846)?：方法，第?? 5846 ?? 行。
- [BrowserSession.snapshotUid](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5855)?：方法，第?? 5855 ?? 行。
- [BrowserSession.pruneSnapshotUidMappings](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5870)?：方法，第?? 5870 ?? 行。
- [BrowserSession.snapshotActionsForNode](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5885)?：方法，第?? 5885 ?? 行。
- [BrowserSession.collectSnapshotDomFallback](../../packages/capability-sdk/src/browser/node/browser-session.ts#L5898)?：方法，第?? 5898 ?? 行。
- [BrowserSession.buildSnapshotGeneration](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6257)?：方法，第?? 6257 ?? 行。
- [BrowserSession.ensureSnapshotGeneration](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6370)?：方法，第?? 6370 ?? 行。
- [BrowserSession.invalidateSnapshotGeneration](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6389)?：方法，第?? 6389 ?? 行。
- [BrowserSession.snapshotMutationKey](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6394)?：方法，第?? 6394 ?? 行。
- [BrowserSession.readSnapshotMutationEpochs](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6398)?：方法，第?? 6398 ?? 行。
- [BrowserSession.snapshotMutationChanged](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6412)?：方法，第?? 6412 ?? 行。
- [BrowserSession.readNavigationDomStabilitySample](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6422)?：方法，第?? 6422 ?? 行。
- [BrowserSession.waitForNavigationDomStability](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6452)?：方法，第?? 6452 ?? 行。
- [BrowserSession.snapshotViewText](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6500)?：方法，第?? 6500 ?? 行。
- [BrowserSession.snapshotObservationViews](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6508)?：方法，第?? 6508 ?? 行。
- [BrowserSession.currentSnapshotObservationViews](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6517)?：方法，第?? 6517 ?? 行。
- [BrowserSession.readInteractionCounts](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6524)?：方法，第?? 6524 ?? 行。
- [BrowserSession.interactionDelta](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6541)?：方法，第?? 6541 ?? 行。
- [BrowserSession.completeVerifiedAction](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6545)?：方法，第?? 6545 ?? 行。
- [BrowserSession.readScrollPosition](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6591)?：方法，第?? 6591 ?? 行。
- [BrowserSession.editableValue](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6634)?：方法，第?? 6634 ?? 行。
- [BrowserSession.setEditableTextSelection](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6644)?：方法，第?? 6644 ?? 行。
- [BrowserSession.hasFocusedNativeSelect](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6662)?：方法，第?? 6662 ?? 行。
- [BrowserSession.viewportDragTarget](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6670)?：方法，第?? 6670 ?? 行。
- [BrowserSession.dispatchHtml5Drag](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6680)?：方法，第?? 6680 ?? 行。
- [BrowserSession.completeActionWithDomChanges](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6697)?：方法，第?? 6697 ?? 行。
- [BrowserSession.readSnapshotSlice](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6774)?：方法，第?? 6774 ?? 行。
- [BrowserSession.searchSnapshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6826)?：方法，第?? 6826 ?? 行。
- [BrowserSession.currentSnapshotReference](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6897)?：方法，第?? 6897 ?? 行。
- [BrowserSession.snapshotReferenceLocator](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6909)?：方法，第?? 6909 ?? 行。
- [BrowserSession.validateLocatorActionPoint](../../packages/capability-sdk/src/browser/node/browser-session.ts#L6924)?：方法，第?? 6924 ?? 行。
- [BrowserSession.resolveSnapshotReferencePoint](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7018)?：方法，第?? 7018 ?? 行。
- [BrowserSession.resolveStructuredActionTarget](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7141)?：方法，第?? 7141 ?? 行。
- [BrowserSession.resolveDomObservationReferencePoint](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7169)?：方法，第?? 7169 ?? 行。
- [BrowserSession.editableIframeLocator](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7215)?：方法，第?? 7215 ?? 行。
- [BrowserSession.resolveScreenshotPoint](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7238)?：方法，第?? 7238 ?? 行。
- [BrowserSession.unifiedActionPoint](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7280)?：方法，第?? 7280 ?? 行。
- [BrowserSession.mouse](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7300)?：方法，第?? 7300 ?? 行。
- [BrowserSession.selectOption](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7608)?：方法，第?? 7608 ?? 行。
- [BrowserSession.keyboard](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7727)?：方法，第?? 7727 ?? 行。
- [BrowserSession.emptySimplifiedDomObservation](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7974)?：方法，第?? 7974 ?? 行。
- [BrowserSession.domObservationDepth](../../packages/capability-sdk/src/browser/node/browser-session.ts#L7993)?：方法，第?? 7993 ?? 行。
- [BrowserSession.domObservationIndent](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8005)?：方法，第?? 8005 ?? 行。
- [BrowserSession.readSimplifiedDomTree](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8009)?：方法，第?? 8009 ?? 行。
- [BrowserSession.snapshotFrameTargets](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8234)?：方法，第?? 8234 ?? 行。
- [BrowserSession.frameElementIsInsideDisplayNoneSubtree](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8266)?：方法，第?? 8266 ?? 行。
- [BrowserSession.resetDomVisibleIdState](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8286)?：方法，第?? 8286 ?? 行。
- [BrowserSession.publicDomVisibleId](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8296)?：方法，第?? 8296 ?? 行。
- [BrowserSession.exposeDomReferencesFromText](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8308)?：方法，第?? 8308 ?? 行。
- [BrowserSession.bindDomReferencesToObservation](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8314)?：方法，第?? 8314 ?? 行。
- [BrowserSession.removeDomVisibleReference](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8322)?：方法，第?? 8322 ?? 行。
- [BrowserSession.domObservationReference](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8331)?：方法，第?? 8331 ?? 行。
- [BrowserSession.domObservationExtraLine](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8364)?：方法，第?? 8364 ?? 行。
- [BrowserSession.domObservationValidationError](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8370)?：方法，第?? 8370 ?? 行。
- [BrowserSession.readDomObservationSnapshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8382)?：方法，第?? 8382 ?? 行。
- [BrowserSession.readDomChanges](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8502)?：方法，第?? 8502 ?? 行。
- [BrowserSession.discardDomChanges](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8648)?：方法，第?? 8648 ?? 行。
- [BrowserSession.intersectViewportClip](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8659)?：方法，第?? 8659 ?? 行。
- [BrowserSession.readVisibleDomSnapshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8670)?：方法，第?? 8670 ?? 行。
- [BrowserSession.readFullDomSnapshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8685)?：方法，第?? 8685 ?? 行。
- [BrowserSession.readDomSnapshot](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8694)?：方法，第?? 8694 ?? 行。
- [BrowserSession.readFullFrameDomSnapshots](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8713)?：方法，第?? 8713 ?? 行。
- [BrowserSession.readVisibleFrameDomSnapshots](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8747)?：方法，第?? 8747 ?? 行。
- [BrowserSession.readPngSize](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8799)?：方法，第?? 8799 ?? 行。
- [BrowserSession.readPngSizeFromBuffer](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8810)?：方法，第?? 8810 ?? 行。
- [BrowserSession.removeCandidateOverlay](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8825)?：方法，第?? 8825 ?? 行。
- [BrowserSession.showAiMouseCursor](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8833)?：方法，第?? 8833 ?? 行。
- [closeAllBrowserSessions](../../packages/capability-sdk/src/browser/node/browser-session.ts#L8843)?：函数，第?? 8843 ?? 行。

### [packages/capability-sdk/src/browser/node/browser-session-runtime.ts](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts)

- [browserRuntimeDataRoot](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L8)?：函数，第?? 8 ?? 行。
- [positiveIntegerEnv](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L16)?：函数，第?? 16 ?? 行。
- [boundedPositiveIntegerEnv](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L24)?：函数，第?? 24 ?? 行。
- [boundedNonNegativeIntegerEnv](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L29)?：函数，第?? 29 ?? 行。
- [numericLimitFromEnv](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L37)?：函数，第?? 37 ?? 行。
- [sharedBrowserTabsEnabled](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L44)?：函数，第?? 44 ?? 行。
- [browserHeadlessEnabled](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L48)?：函数，第?? 48 ?? 行。
- [nativeBrowserTabGroupsEnabled](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L64)?：函数，第?? 64 ?? 行。
- [browserTabTitlePrefixEnabled](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L68)?：函数，第?? 68 ?? 行。
- [electronEmbeddedBrowserEnabled](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L72)?：函数，第?? 72 ?? 行。
- [cdpEndpointForPort](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L76)?：函数，第?? 76 ?? 行。
- [electronEmbeddedBrowserCdpEndpoint](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L80)?：函数，第?? 80 ?? 行。
- [sessionTabGrouperExtensionPath](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L86)?：函数，第?? 86 ?? 行。
- [sessionTabGrouperEnabled](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L101)?：函数，第?? 101 ?? 行。
- [withSessionTabGrouperArgs](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L106)?：函数，第?? 106 ?? 行。
- [normalizePageGroupId](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L117)?：函数，第?? 117 ?? 行。
- [sessionTabGrouperProfileDir](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L126)?：函数，第?? 126 ?? 行。
- [managedBrowserProfilesRoot](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L130)?：函数，第?? 130 ?? 行。
- [isPathInside](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L134)?：函数，第?? 134 ?? 行。
- [clearManagedBrowserProfileCaches](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L139)?：函数，第?? 139 ?? 行。
- [sessionTabGrouperDebugPort](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L181)?：函数，第?? 181 ?? 行。
- [cdpPortFromEndpoint](../../packages/capability-sdk/src/browser/node/browser-session-runtime.ts#L190)?：函数，第?? 190 ?? 行。

### [packages/capability-sdk/src/browser/node/browser-session-lifecycle.ts](../../packages/capability-sdk/src/browser/node/browser-session-lifecycle.ts)

- [registerBrowserSession](../../packages/capability-sdk/src/browser/node/browser-session-lifecycle.ts#L18)?：函数，第?? 18 ?? 行。
- [unregisterBrowserSession](../../packages/capability-sdk/src/browser/node/browser-session-lifecycle.ts#L22)?：函数，第?? 22 ?? 行。
- [closeManagedBrowserSessions](../../packages/capability-sdk/src/browser/node/browser-session-lifecycle.ts#L26)?：函数，第?? 26 ?? 行。
- [installBrowserSessionShutdownHooks](../../packages/capability-sdk/src/browser/node/browser-session-lifecycle.ts#L38)?：函数，第?? 38 ?? 行。

### [packages/capability-sdk/src/browser/node/browser-session-scheduler.ts](../../packages/capability-sdk/src/browser/node/browser-session-scheduler.ts)

- [BrowserSessionScheduler](../../packages/capability-sdk/src/browser/node/browser-session-scheduler.ts#L7)?：类，第?? 7 ?? 行。
- [BrowserSessionScheduler.run](../../packages/capability-sdk/src/browser/node/browser-session-scheduler.ts#L11)?：方法，第?? 11 ?? 行。
- [BrowserSessionScheduler.cancelAndDrain](../../packages/capability-sdk/src/browser/node/browser-session-scheduler.ts#L25)?：方法，第?? 25 ?? 行。

### [packages/capability-sdk/src/browser/node/browser-code-runner.ts](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts)

- [browserCodeFailureText](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L100)?：函数，第?? 100 ?? 行。
- [browserCodeReportedFailure](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L115)?：函数，第?? 115 ?? 行。
- [evaluateCallContainsDomClick](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L136)?：函数，第?? 136 ?? 行。
- [parseBrowserCodeAst](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L198)?：函数，第?? 198 ?? 行。
- [walkBrowserCodeAst](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L211)?：函数，第?? 211 ?? 行。
- [browserCodeWithCellReturns](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L228)?：函数，第?? 228 ?? 行。
- [browserCodeMemberPath](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L263)?：函数，第?? 263 ?? 行。
- [browserCodeHasImageOperation](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L276)?：函数，第?? 276 ?? 行。
- [browserCodeHasDeclaredBrowserAction](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L307)?：函数，第?? 307 ?? 行。
- [browserCodePolicyViolation](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L329)?：函数，第?? 329 ?? 行。
- [boundedInteger](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L408)?：函数，第?? 408 ?? 行。
- [browserCodeWithoutComments](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L414)?：函数，第?? 414 ?? 行。
- [browserCodeHasCommittingAction](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L471)?：函数，第?? 471 ?? 行。
- [analyzeBrowserCodeRisk](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L480)?：函数，第?? 480 ?? 行。
- [browserCodeKernelMain](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L495)?：函数，第?? 495 ?? 行。
- [childSource](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3165)?：函数，第?? 3165 ?? 行。
- [browserCodeResolvedPackageReadRoots](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3188)?：函数，第?? 3188 ?? 行。
- [browserCodeKernelMemoryLimits](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3205)?：函数，第?? 3205 ?? 行。
- [browserCodeModuleReadRoots](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3220)?：函数，第?? 3220 ?? 行。
- [browserCodeChildArgs](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3231)?：函数，第?? 3231 ?? 行。
- [browserCodeChildEnv](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3250)?：函数，第?? 3250 ?? 行。
- [removeBrowserCodeTempDir](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3269)?：函数，第?? 3269 ?? 行。
- [BrowserCodeKernel](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3278)?：类，第?? 3278 ?? 行。
- [BrowserCodeKernel.execute](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3300)?：方法，第?? 3300 ?? 行。
- [BrowserCodeKernel.close](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3306)?：方法，第?? 3306 ?? 行。
- [BrowserCodeKernel.executeNow](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3316)?：方法，第?? 3316 ?? 行。
- [BrowserCodeKernel.ensureReady](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3436)?：方法，第?? 3436 ?? 行。
- [BrowserCodeKernel.kernelResetAfterResult](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3532)?：方法，第?? 3532 ?? 行。
- [BrowserCodeKernel.handleMessage](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3568)?：方法，第?? 3568 ?? 行。
- [BrowserCodeKernel.handleRuntimeStateOperation](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3632)?：方法，第?? 3632 ?? 行。
- [BrowserCodeKernel.finishPending](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3666)?：方法，第?? 3666 ?? 行。
- [BrowserCodeKernel.executionProgress](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3680)?：方法，第?? 3680 ?? 行。
- [BrowserCodeKernel.interrupted](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3687)?：方法，第?? 3687 ?? 行。
- [BrowserCodeKernel.rejectReady](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3697)?：方法，第?? 3697 ?? 行。
- [BrowserCodeKernel.resolveReady](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3705)?：方法，第?? 3705 ?? 行。
- [BrowserCodeKernel.clearExecutionTimer](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3713)?：方法，第?? 3713 ?? 行。
- [BrowserCodeKernel.clearReadyTimer](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3719)?：方法，第?? 3719 ?? 行。
- [BrowserCodeKernel.stopChild](../../packages/capability-sdk/src/browser/node/browser-code-runner.ts#L3725)?：方法，第?? 3725 ?? 行。

### [packages/capability-sdk/src/browser/node/browser-code-cdp-scope.ts](../../packages/capability-sdk/src/browser/node/browser-code-cdp-scope.ts)

- [createBrowserCodeCdpScope](../../packages/capability-sdk/src/browser/node/browser-code-cdp-scope.ts#L9)?：函数，第?? 9 ?? 行。

### [packages/capability-sdk/src/browser/node/browser-state-reader.ts](../../packages/capability-sdk/src/browser/node/browser-state-reader.ts)

- [BrowserStateReader](../../packages/capability-sdk/src/browser/node/browser-state-reader.ts#L21)?：类，第?? 21 ?? 行。
- [BrowserStateReader.clear](../../packages/capability-sdk/src/browser/node/browser-state-reader.ts#L31)?：方法，第?? 31 ?? 行。
- [BrowserStateReader.read](../../packages/capability-sdk/src/browser/node/browser-state-reader.ts#L33)?：方法，第?? 33 ?? 行。

### [packages/capability-sdk/src/browser/node/browser-page-observation.ts](../../packages/capability-sdk/src/browser/node/browser-page-observation.ts)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。

### [packages/capability-sdk/src/browser/node/dom-snapshot.ts](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts)

- [text](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L101)?：函数，第?? 101 ?? 行。
- [canonicalUrl](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L105)?：函数，第?? 105 ?? 行。
- [readableName](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L115)?：函数，第?? 115 ?? 行。
- [classDescriptor](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L119)?：函数，第?? 119 ?? 行。
- [axValue](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L124)?：函数，第?? 124 ?? 行。
- [rareString](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L129)?：函数，第?? 129 ?? 行。
- [rareBoolean](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L137)?：函数，第?? 137 ?? 行。
- [attributesAt](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L141)?：函数，第?? 141 ?? 行。
- [inferredRole](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L150)?：函数，第?? 150 ?? 行。
- [hasClickAttribute](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L184)?：函数，第?? 184 ?? 行。
- [actionsFor](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L191)?：函数，第?? 191 ?? 行。
- [resolveUrl](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L222)?：函数，第?? 222 ?? 行。
- [mapConcurrent](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L231)?：函数，第?? 231 ?? 行。
- [enrichFromAx](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L244)?：函数，第?? 244 ?? 行。
- [captureDomSnapshot](../../packages/capability-sdk/src/browser/node/dom-snapshot.ts#L277)?：函数，第?? 277 ?? 行。

### [packages/capability-sdk/src/browser/node/ax-snapshot.ts](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts)

- [errorText](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L157)?：函数，第?? 157 ?? 行。
- [valueOf](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L161)?：函数，第?? 161 ?? 行。
- [stringValue](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L175)?：函数，第?? 175 ?? 行。
- [normalizeWhitespace](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L180)?：函数，第?? 180 ?? 行。
- [readableText](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L184)?：函数，第?? 184 ?? 行。
- [propertyRecord](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L188)?：函数，第?? 188 ?? 行。
- [roleOf](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L199)?：函数，第?? 199 ?? 行。
- [isActionable](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L203)?：函数，第?? 203 ?? 行。
- [concurrentMap](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L214)?：函数，第?? 214 ?? 行。
- [normalizeFrameNodes](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L228)?：函数，第?? 228 ?? 行。
- [sensitiveBackendNodes](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L281)?：函数，第?? 281 ?? 行。
- [captureAxSnapshot](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L321)?：函数，第?? 321 ?? 行。
- [escaped](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L358)?：函数，第?? 358 ?? 行。
- [meaningfulNode](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L364)?：函数，第?? 364 ?? 行。
- [snapshotNodeKey](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L372)?：函数，第?? 372 ?? 行。
- [displayTextForNode](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L376)?：函数，第?? 376 ?? 行。
- [ancestorsForNode](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L380)?：函数，第?? 380 ?? 行。
- [contextLabelForUnnamedAction](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L396)?：函数，第?? 396 ?? 行。
- [displayNameForNode](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L421)?：函数，第?? 421 ?? 行。
- [serializeNode](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L428)?：函数，第?? 428 ?? 行。
- [frameBoundary](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L445)?：函数，第?? 445 ?? 行。
- [recordForNode](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L455)?：函数，第?? 455 ?? 行。
- [actionableNodeIds](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L467)?：函数，第?? 467 ?? 行。
- [buildSnapshotViews](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L530)?：函数，第?? 530 ?? 行。
- [snapshotRoleIsActionable](../../packages/capability-sdk/src/browser/node/ax-snapshot.ts#L588)?：函数，第?? 588 ?? 行。

### [packages/capability-sdk/src/browser/node/interaction.ts](../../packages/capability-sdk/src/browser/node/interaction.ts)

- [executeBrowserSessionOperation](../../packages/capability-sdk/src/browser/node/interaction.ts#L21)?：函数，第?? 21 ?? 行。
- [visiblePageErrorIndicators](../../packages/capability-sdk/src/browser/node/interaction.ts#L115)?：函数，第?? 115 ?? 行。

### [packages/capability-sdk/src/browser/preview/server.ts](../../packages/capability-sdk/src/browser/preview/server.ts)

- [browserPreviewPreferredTransport](../../packages/capability-sdk/src/browser/preview/server.ts#L90)?：函数，第?? 90 ?? 行。
- [createBrowserPreviewServer](../../packages/capability-sdk/src/browser/preview/server.ts#L93)?：函数，第?? 93 ?? 行。

### [src/server/ai/agents/runtime-browser-interaction.ts](../../src/server/ai/agents/runtime-browser-interaction.ts)

- [browserInteractionSchema](../../src/server/ai/agents/runtime-browser-interaction.ts#L60)?：函数，第?? 60 ?? 行。
- [parseBrowserInteractionInput](../../src/server/ai/agents/runtime-browser-interaction.ts#L63)?：函数，第?? 63 ?? 行。
- [browserInteractionInstructions](../../src/server/ai/agents/runtime-browser-interaction.ts#L74)?：函数，第?? 74 ?? 行。
- [executeBrowserInteraction](../../src/server/ai/agents/runtime-browser-interaction.ts#L96)?：函数，第?? 96 ?? 行。

### [src/server/ai/agents/runtime-browser-visual.ts](../../src/server/ai/agents/runtime-browser-visual.ts)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。

### [src/server/ai/agents/runtime-browser-mcp.ts](../../src/server/ai/agents/runtime-browser-mcp.ts)

- [connectedClient](../../src/server/ai/agents/runtime-browser-mcp.ts#L15)?：函数，第?? 15 ?? 行。
- [availableTool](../../src/server/ai/agents/runtime-browser-mcp.ts#L47)?：函数，第?? 47 ?? 行。
- [selectOwnedTab](../../src/server/ai/agents/runtime-browser-mcp.ts#L51)?：函数，第?? 51 ?? 行。
- [executePlaywrightMcpOperation](../../src/server/ai/agents/runtime-browser-mcp.ts#L63)?：函数，第?? 63 ?? 行。

### [packages/capability-sdk/src/browser/interaction-schema.ts](../../packages/capability-sdk/src/browser/interaction-schema.ts)

- [validateBrowserVisualInput](../../packages/capability-sdk/src/browser/interaction-schema.ts#L30)?：函数，第?? 30 ?? 行。

### [src/server/capabilities/browser-chat-browser.ts](../../src/server/capabilities/browser-chat-browser.ts)

- [createBrowserChatBrowserCapability](../../src/server/capabilities/browser-chat-browser.ts#L21)?：函数，第?? 21 ?? 行。

### [src/server/capabilities/webpilot-browser.ts](../../src/server/capabilities/webpilot-browser.ts)

- [createWebPilotBrowserSession](../../src/server/capabilities/webpilot-browser.ts#L11)?：函数，第?? 11 ?? 行。

## 完整输入 JSON Schema

以下内容直接来自当前源码导出，并不是手写参数示例。运行时的跨字段校验不由 JSON Schema 完全表达，仍以正文和 input.parse 为准。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "active",
        "all"
      ]
    },
    "frame": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "selector": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "cursor": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    },
    "action": {
      "type": "string",
      "enum": [
        "code",
        "state",
        "waitForHumanVerification"
      ],
      "description": "Required operation. Use code for Playwright interaction. Use state for an active-surface snapshot, or narrow it with scope/frame/selector/query and continue with the returned nextCursor."
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "observationMode": {
      "description": "After code: replace old screenshots, append a continuous observation, or keep a before/after pair. Host bounds history and preserves the current observation.",
      "type": "string",
      "enum": [
        "replace",
        "append",
        "keep-pair"
      ]
    },
    "recoveryReview": {
      "description": "After a browser failure: concise Markdown with observed screenshot state, evidence-based cause (label uncertainty), changed recovery action, verification and prevention rule. Put review here, not in assistant narrative. Only claim images actually received.",
      "type": "string",
      "minLength": 1,
      "maxLength": 6000
    },
    "code": {
      "description": "action=code executes JavaScript with top-level await in a persistent Node.js Playwright runtime. page, context, browser and tab are already provided: use page directly; never initialize it from window.__page or redeclare these bindings. document, window and DOMParser are unavailable in the outer cell; use them inside a browser-side callback such as page.evaluate. Correct: var info = await page.evaluate(() => ({ title: document.title, url: window.location.href })); nodeRepl.write(info); Incorrect: const page = window.__page; document.querySelector(...). An evaluate callback runs in the page and cannot capture Node variables, page or nodeRepl; pass values using its second argument, return JSON-safe data, then call nodeRepl.write outside the callback. Use nodeRepl.write(value) for results (top-level return is also supported). Prefer var for bindings reused across cells. Bare fetch runs on the Node host without browser cookies; for an observed browser-authenticated HTTP API use context.request.get(url), check response.ok(), then await response.json()/text(). If document/window is not defined, move the DOM read into page.evaluate instead of retrying the same outer-cell code.",
      "type": "string",
      "minLength": 1,
      "maxLength": 40000
    },
    "maxOutputChars": {
      "description": "Optional explicit output limit. Code returns the complete result when omitted. State supports scope, frame, selector, query and nextCursor continuation, with a maximum page size of 200000 characters.",
      "type": "integer",
      "minimum": 1000,
      "maximum": 9007199254740991
    },
    "maxMs": {
      "description": "Optional only when action=waitForHumanVerification.",
      "type": "integer",
      "minimum": 1000,
      "maximum": 1800000
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```

## Orbit 实际发布的四种模式输入 Schema

上节 JSON 是 SDK 默认输入；本项目聊天入口实际按模式发布以下 schema。为控制冗余，仅 code.description 使用简述，字段和约束直接来自当前源码。跨字段 refine 不在 JSON 中完全表达，须结合正文。

### dom

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "maxLength": 16000
    },
    "tabOperation": {
      "type": "string",
      "enum": [
        "list",
        "open",
        "select",
        "close"
      ]
    },
    "tabId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "action": {
      "type": "string",
      "enum": [
        "state",
        "snapshot",
        "code",
        "dismissSurface",
        "navigate",
        "tabs",
        "waitForHumanVerification",
        "requestUserInput"
      ],
      "description": "snapshot reads actionable elements and surfaces; code acts and returns data.postActionState after attempted input, data.actionOutcome=\"skipped\" when a conditional action did not run, and data.pageErrorIndicators for visible HTTP errors (page.verifyState does not exist); dismissSurface always sends a direct mouse click at viewport (0,0), then reports data.closureConfirmed and postActionState. A delivered click is not proof that the popup closed."
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "question": {
      "description": "requestUserInput: the complete user-facing question in Markdown. Preserve paragraph breaks; use headings and lists for multiple options or files. Ask for specific user-owned information or an attachment; the user reply resumes the same task.",
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "code": {
      "description": "Run browser JavaScript in the persistent Node kernel.",
      "type": "string",
      "minLength": 1,
      "maxLength": 40000
    },
    "scope": {
      "type": "string",
      "enum": [
        "active",
        "all"
      ]
    },
    "frame": {
      "type": "string",
      "maxLength": 200
    },
    "selector": {
      "type": "string",
      "maxLength": 2000
    },
    "query": {
      "type": "string",
      "maxLength": 300
    },
    "cursor": {
      "type": "string",
      "maxLength": 1000
    },
    "maxOutputChars": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 200000
    },
    "maxMs": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 1800000
    },
    "snapshotView": {
      "description": "snapshot only: actionable controls by default, full semantic tree, or readable text.",
      "type": "string",
      "enum": [
        "actionable",
        "full",
        "text"
      ]
    },
    "snapshotCursor": {
      "description": "snapshot only: nextCursor from the same DOM observation.",
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    },
    "recoveryReview": {
      "type": "string",
      "maxLength": 6000
    },
    "observationMode": {
      "type": "string",
      "enum": [
        "replace",
        "append",
        "keep-pair"
      ]
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```

### visual

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "maxLength": 16000
    },
    "tabOperation": {
      "type": "string",
      "enum": [
        "list",
        "open",
        "select",
        "close"
      ]
    },
    "tabId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "action": {
      "type": "string",
      "enum": [
        "observe",
        "act",
        "images",
        "dismissSurface",
        "navigate",
        "tabs",
        "waitForHumanVerification",
        "requestUserInput"
      ],
      "description": "dismissSurface clicks viewport (0,0) to close an option surface; check closureConfirmed and the latest screenshot before continuing."
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "question": {
      "description": "requestUserInput: the complete user-facing question in Markdown. Preserve paragraph breaks; use headings and lists for multiple options or files. Identify the material or decision needed to continue the current task.",
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "observationId": {
      "type": "string"
    },
    "kind": {
      "type": "string",
      "enum": [
        "click",
        "hover",
        "move",
        "drag",
        "scroll",
        "type",
        "key"
      ]
    },
    "x": {
      "type": "number",
      "minimum": 0
    },
    "y": {
      "type": "number",
      "minimum": 0
    },
    "endX": {
      "type": "number",
      "minimum": 0
    },
    "endY": {
      "type": "number",
      "minimum": 0
    },
    "button": {
      "description": "Mouse button for click/drag. Default left. Use right for context menus.",
      "type": "string",
      "enum": [
        "left",
        "right",
        "middle"
      ]
    },
    "clickCount": {
      "description": "click only: 1 single, 2 double, 3 triple click in one gesture.",
      "type": "integer",
      "minimum": 1,
      "maximum": 3
    },
    "modifiers": {
      "description": "Hold these keys throughout one mouse gesture; release afterwards, including on failure.",
      "maxItems": 4,
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "Control",
          "Shift",
          "Alt",
          "Meta"
        ]
      }
    },
    "steps": {
      "description": "Intermediate mouse moves for drag/move/hover; drag defaults to 12.",
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "deltaX": {
      "type": "number"
    },
    "deltaY": {
      "type": "number"
    },
    "text": {
      "type": "string",
      "maxLength": 20000
    },
    "key": {
      "description": "One key or simultaneous chord, e.g. Control+v, Control+Shift+v, Shift+ArrowLeft, Alt+ArrowDown.",
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "observationMode": {
      "type": "string",
      "enum": [
        "replace",
        "append",
        "keep-pair"
      ]
    },
    "imageIds": {
      "description": "Select historical image IDs; latest image always remains selected. Empty resets history.",
      "maxItems": 12,
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "recoveryReview": {
      "type": "string",
      "maxLength": 6000
    },
    "maxMs": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```

### hybrid

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "maxLength": 16000
    },
    "tabOperation": {
      "type": "string",
      "enum": [
        "list",
        "open",
        "select",
        "close"
      ]
    },
    "tabId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "action": {
      "type": "string",
      "enum": [
        "state",
        "snapshot",
        "code",
        "dismissSurface",
        "observe",
        "act",
        "images",
        "navigate",
        "tabs",
        "waitForHumanVerification",
        "requestUserInput"
      ],
      "description": "snapshot reads actionable elements and surfaces; code acts and returns data.postActionState after attempted input, data.actionOutcome=\"skipped\" when a conditional action did not run, and data.pageErrorIndicators for visible HTTP errors (page.verifyState does not exist); dismissSurface always sends a direct mouse click at viewport (0,0), then reports data.closureConfirmed and postActionState. A delivered click is not proof that the popup closed."
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "question": {
      "description": "requestUserInput: the complete user-facing question in Markdown. Preserve paragraph breaks; use headings and lists for multiple options or files. Ask for specific user-owned information or an attachment; the user reply resumes the same task.",
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "observationId": {
      "type": "string"
    },
    "kind": {
      "type": "string",
      "enum": [
        "click",
        "hover",
        "move",
        "drag",
        "scroll",
        "type",
        "key"
      ]
    },
    "x": {
      "type": "number",
      "minimum": 0
    },
    "y": {
      "type": "number",
      "minimum": 0
    },
    "endX": {
      "type": "number",
      "minimum": 0
    },
    "endY": {
      "type": "number",
      "minimum": 0
    },
    "button": {
      "description": "Mouse button for click/drag. Default left. Use right for context menus.",
      "type": "string",
      "enum": [
        "left",
        "right",
        "middle"
      ]
    },
    "clickCount": {
      "description": "click only: 1 single, 2 double, 3 triple click in one gesture.",
      "type": "integer",
      "minimum": 1,
      "maximum": 3
    },
    "modifiers": {
      "description": "Hold these keys throughout one mouse gesture; release afterwards, including on failure.",
      "maxItems": 4,
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "Control",
          "Shift",
          "Alt",
          "Meta"
        ]
      }
    },
    "steps": {
      "description": "Intermediate mouse moves for drag/move/hover; drag defaults to 12.",
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "deltaX": {
      "type": "number"
    },
    "deltaY": {
      "type": "number"
    },
    "text": {
      "type": "string",
      "maxLength": 20000
    },
    "key": {
      "description": "One key or simultaneous chord, e.g. Control+v, Control+Shift+v, Shift+ArrowLeft, Alt+ArrowDown.",
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "observationMode": {
      "type": "string",
      "enum": [
        "replace",
        "append",
        "keep-pair"
      ]
    },
    "imageIds": {
      "description": "Select historical image IDs; latest image always remains selected. Empty resets history.",
      "maxItems": 12,
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "recoveryReview": {
      "type": "string",
      "maxLength": 6000
    },
    "maxMs": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 1800000
    },
    "code": {
      "description": "Run browser JavaScript in the persistent Node kernel.",
      "type": "string",
      "minLength": 1,
      "maxLength": 40000
    },
    "scope": {
      "type": "string",
      "enum": [
        "active",
        "all"
      ]
    },
    "frame": {
      "type": "string",
      "maxLength": 200
    },
    "selector": {
      "type": "string",
      "maxLength": 2000
    },
    "query": {
      "type": "string",
      "maxLength": 300
    },
    "cursor": {
      "type": "string",
      "maxLength": 1000
    },
    "maxOutputChars": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 200000
    },
    "snapshotView": {
      "description": "snapshot only: actionable controls by default, full semantic tree, or readable text.",
      "type": "string",
      "enum": [
        "actionable",
        "full",
        "text"
      ]
    },
    "snapshotCursor": {
      "description": "snapshot only: nextCursor from the same DOM observation.",
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```

### mcp

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "maxLength": 16000
    },
    "tabOperation": {
      "type": "string",
      "enum": [
        "list",
        "open",
        "select",
        "close"
      ]
    },
    "tabId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "action": {
      "type": "string",
      "enum": [
        "mcp",
        "dismissSurface",
        "navigate",
        "tabs",
        "waitForHumanVerification",
        "requestUserInput"
      ],
      "description": "dismissSurface directly clicks viewport (0,0) to dismiss an option surface; inspect closureConfirmed and postActionState."
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "question": {
      "description": "requestUserInput: the complete user-facing question in Markdown. Preserve paragraph breaks; use headings and lists for multiple options or files. Identify the material or decision needed to continue the current task.",
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "tool": {
      "description": "Use list to discover tools, then an exact official Playwright MCP browser_* tool name.",
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "arguments": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "maxMs": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 1800000
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```
