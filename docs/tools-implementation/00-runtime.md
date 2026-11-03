# 工具运行时与跨工具完整调用链

源码基准：2026-10-06 当前工作区。本目录覆盖 Orbit 浏览器聊天使用的 13 类能力工具、skill/finalResponse/subagent，以及单独挂载的 memory/contextRead，共 18 个工具。文档描述现有实现；仅具体 source 和调用条件支持的能力才算已实现。

## 从用户请求到工具结果

1. browser-chat.service 根据用户、会话、模型、当前任务、附件、工具开关和执行模式准备本轮上下文，加载既有消息、记忆和运行时状态。
2. browser-chat-executor.agent 构造浏览器、文件、图表、地图和 createAgentInfrastructureProviders；后者提供沙箱、连接器、知识、数据、媒体、文本编辑、通信、终端和电脑。
3. mountCapabilities 合并基础配置、configStore 值与本次覆盖，normalizeCapabilityConfiguration 补默认值并校验设置，CapabilityRegistry 为启用 provider 创建 runtime。
4. registry 校验能力、工具名和 Skill ID 冲突，过滤 allowedToolNames，汇总响应类型与技能；执行时把全局 lifetime 和调用取消信号合并，跟踪所有在途 invocation。
5. AI SDK adapter 将 CapabilityTool 的 JSON Schema/parse/execute 接到模型工具协议。模型响应先经过参数强制转换/解析、宿主 record、工具选择和当前 Skill 内容检查。
6. record 记录开始时间、参数、进度、执行踪迹和审批。strict/full 与 browser-tool-approval 决定具体有副作用操作的授权；已有授权由宿主上下文处理。权限不是文档内自行发起的额外流程。
7. createCapabilityExecutor 执行 authorize 与 prerequisite，并按 concurrencyGroup 排队。排队前后检查 abort；serial 锁保持到真实 operation 结束，而非只到外层等待结束。CapabilityTaskQueue 对使用它的模块控制并发、队列容量、排队及执行截止时间，取消等待任务立即移出队列，执行任务结束清理后归还名额。
8. 实际 provider 调用库、进程、数据库或 HTTP。结果统一为成功 {ok,summary,data,content} 或失败 {ok:false,error:{code,message,retryable,details}}。Browser Chat adapter 再映射为实际模型/日志结果及图像、文件、图表、地图响应块。
9. tool trace、上下文预算与压缩保留调用/结果原子对、关键源码及 Skill 读入回执；最终 finalResponse 做结构、产物、完整性和宿主完成审查，接受后生成按序客户端 parts。
10. 最后 lifetime abort，等待在途 invocation，逆序 dispose 所有 runtime；收集 AggregateError，不把残留资源清理异常静默当成功。

## 工具和动作可用性

13 类基础能力都能在目录中描述，但配置禁用、缺少模型/通道、缺少运行环境、允许工具过滤和只读子代理会改变实际可执行动作。browser 被 Orbit 自定义入口覆盖；file 的视觉动作依模型图像输入能力增加；subagent 只在宿主提供 spawn/read 回调时加入；memory 由 service 单独创建，contextRead 在 app-server runtime 与审核上下文挂载，两者不属于 13 类 CapabilityRegistry manifest。敏感数据过滤、回复渲染、服务健康和 WebSocket 是支撑能力，不额外计为公开模型工具。

## 数据与身份边界

runId/sessionId/userId 由宿主绑定；图表/地图以会话或自动化 run 为范围，文本/知识/通信草稿按用户持久化，代码执行产物按本轮范围访问。文件、媒体和通信发送文件使用已登记附件/产物解析器，真实路径验证与身份检查位于宿主读取路由和 SDK Node 实现。模型输出只有获得的 ID/URL 才能成为最终可用链接。

本地知识/文本/通信用各自 SQLite 数据库，宿主应用数据库是 TypeORM SQLite/PostgreSQL；两者不能混用连接/迁移。浏览器与终端有跨轮会话寿命，代码沙箱每次任务有临时目录，图表/文本等记录具有持久寿命，provider dispose 只释放自己拥有的资源。

## 框架适配与 MCP

SDK 的 AI SDK adapter 和 MCP adapter 共用能力与响应契约。MCP 提供 eager/lazy Skill 发布、tools/call、resources 和可视化 MCP App；mcp-ui/viewer 用已保存记录渲染图表/地图并连接读取、更新、下载、全屏。scripts/mcp-providers.mjs 构造独立本地 provider，不经过 Orbit 的用户会话 service；因此 MCP 本地文件源/配置目录与 Orbit 身份绑定不同，不能把两套宿主的默认实现混写。

## 共享底层模块

errors.ts：所有项目文本错误码、带码异常、外部错误转换、结果归一化及动态诊断码生成；完整规则见 [统一文本错误码](../error-codes.md)。

index.ts：契约、Registry、输入定义、结果归一化与生命周期。
execution.ts/task-queue.ts：授权、前置条件、串行组、取消、容量和幂等释放。
http.ts：按接收字节限制响应，增量解码 UTF-8，并在 finally cancel/release reader。
process.ts：无 shell 拼接的子进程调用、输出上限、超时、进程树结束与 stdin。
node.ts：独立 SQLite 文档 store、旧 JSON 迁移、WAL、事务与连接关闭。
response.ts/responses/*：响应类型注册、params 校验与渲染契约。
host/*、adapters/*：配置、挂载与外部框架传输。

## 当前修复与验证记录

见 [BUG 修复与验证](audit-and-fixes.md)。审计覆盖真实代码、静态类型检查、现有测试和受控错误场景；不把已经变化的旧测试契约当作生产逻辑，也不以运行 dev/build 代替定位。

## 源码与函数定位

### [packages/capability-sdk/src/index.ts](../../packages/capability-sdk/src/index.ts)

- [capabilitySkillReadJsonSchema](../../packages/capability-sdk/src/index.ts#L91)?：函数，第?? 91 ?? 行。
- [createCapabilityRuntime](../../packages/capability-sdk/src/index.ts#L171)?：函数，第?? 171 ?? 行。
- [CapabilityRegistry](../../packages/capability-sdk/src/index.ts#L200)?：类，第?? 200 ?? 行。
- [CapabilityRegistry.register](../../packages/capability-sdk/src/index.ts#L210)?：方法，第?? 210 ?? 行。
- [CapabilityRegistry.manifests](../../packages/capability-sdk/src/index.ts#L219)?：方法，第?? 219 ?? 行。
- [CapabilityRegistry.resolve](../../packages/capability-sdk/src/index.ts#L223)?：方法，第?? 223 ?? 行。
- [defineCapabilityInput](../../packages/capability-sdk/src/index.ts#L315)?：函数，第?? 315 ?? 行。
- [defineCapabilityTool](../../packages/capability-sdk/src/index.ts#L328)?：函数，第?? 328 ?? 行。
- [jsonRecordFromUnknown](../../packages/capability-sdk/src/index.ts#L347)?：函数，第?? 347 ?? 行。
- [jsonValueFromString](../../packages/capability-sdk/src/index.ts#L353)?：函数，第?? 353 ?? 行。
- [unwrapToolTransport](../../packages/capability-sdk/src/index.ts#L362)?：函数，第?? 362 ?? 行。
- [arrayFromJsonString](../../packages/capability-sdk/src/index.ts#L380)?：函数，第?? 380 ?? 行。
- [normalizeBoundedNumberSetting](../../packages/capability-sdk/src/index.ts#L386)?：函数，第?? 386 ?? 行。
- [normalizeBoundedInteger](../../packages/capability-sdk/src/index.ts#L407)?：函数，第?? 407 ?? 行。
- [raceWithAbort](../../packages/capability-sdk/src/index.ts#L422)?：函数，第?? 422 ?? 行。

### [packages/capability-sdk/src/execution.ts](../../packages/capability-sdk/src/execution.ts)

- [createCapabilityExecutor](../../packages/capability-sdk/src/execution.ts#L12)?：函数，第?? 12 ?? 行。
- [disposeOnce](../../packages/capability-sdk/src/execution.ts#L36)?：函数，第?? 36 ?? 行。

### [packages/capability-sdk/src/task-queue.ts](../../packages/capability-sdk/src/task-queue.ts)

- [CapabilityTaskQueue](../../packages/capability-sdk/src/task-queue.ts#L19)?：类，第?? 19 ?? 行。
- [CapabilityTaskQueue.run](../../packages/capability-sdk/src/task-queue.ts#L26)?：方法，第?? 26 ?? 行。
- [CapabilityTaskQueue.snapshot](../../packages/capability-sdk/src/task-queue.ts#L77)?：方法，第?? 77 ?? 行。
- [CapabilityTaskQueue.cancel](../../packages/capability-sdk/src/task-queue.ts#L79)?：方法，第?? 79 ?? 行。
- [CapabilityTaskQueue.idle](../../packages/capability-sdk/src/task-queue.ts#L89)?：方法，第?? 89 ?? 行。
- [CapabilityTaskQueue.notifyIdle](../../packages/capability-sdk/src/task-queue.ts#L94)?：方法，第?? 94 ?? 行。
- [CapabilityTaskQueue.dispatch](../../packages/capability-sdk/src/task-queue.ts#L100)?：方法，第?? 100 ?? 行。

### [packages/capability-sdk/src/http.ts](../../packages/capability-sdk/src/http.ts)

- [readBoundedResponseText](../../packages/capability-sdk/src/http.ts#L4)?：函数，第?? 4 ?? 行。

### [packages/capability-sdk/src/process.ts](../../packages/capability-sdk/src/process.ts)

- [terminate](../../packages/capability-sdk/src/process.ts#L12)?：函数，第?? 12 ?? 行。
- [runCapabilityProcess](../../packages/capability-sdk/src/process.ts#L24)?：函数，第?? 24 ?? 行。

### [packages/capability-sdk/src/host/index.ts](../../packages/capability-sdk/src/host/index.ts)

- [createCapabilityConfigStore](../../packages/capability-sdk/src/host/index.ts#L43)?：函数，第?? 43 ?? 行。
- [capabilityConfigScopeKey](../../packages/capability-sdk/src/host/index.ts#L51)?：函数，第?? 51 ?? 行。
- [normalizedSettingValue](../../packages/capability-sdk/src/host/index.ts#L59)?：函数，第?? 59 ?? 行。
- [normalizeCapabilityConfiguration](../../packages/capability-sdk/src/host/index.ts#L88)?：函数，第?? 88 ?? 行。
- [capabilityConfigurationForApplyMode](../../packages/capability-sdk/src/host/index.ts#L99)?：函数，第?? 99 ?? 行。
- [capabilityConfigurationFromEnvironment](../../packages/capability-sdk/src/host/index.ts#L112)?：函数，第?? 112 ?? 行。
- [capabilityConfigurationsFromEnvironment](../../packages/capability-sdk/src/host/index.ts#L121)?：函数，第?? 121 ?? 行。
- [MemoryCapabilityConfigStore](../../packages/capability-sdk/src/host/index.ts#L131)?：类，第?? 131 ?? 行。
- [MemoryCapabilityConfigStore.load](../../packages/capability-sdk/src/host/index.ts#L140)?：方法，第?? 140 ?? 行。
- [MemoryCapabilityConfigStore.save](../../packages/capability-sdk/src/host/index.ts#L145)?：方法，第?? 145 ?? 行。
- [MemoryCapabilityConfigStore.delete](../../packages/capability-sdk/src/host/index.ts#L156)?：方法，第?? 156 ?? 行。
- [MemoryCapabilityConfigStore.#key](../../packages/capability-sdk/src/host/index.ts#L160)?：方法，第?? 160 ?? 行。
- [EnvironmentCapabilityConfigStore](../../packages/capability-sdk/src/host/index.ts#L165)?：类，第?? 165 ?? 行。
- [EnvironmentCapabilityConfigStore.load](../../packages/capability-sdk/src/host/index.ts#L168)?：方法，第?? 168 ?? 行。
- [EnvironmentCapabilityConfigStore.save](../../packages/capability-sdk/src/host/index.ts#L176)?：方法，第?? 176 ?? 行。
- [EnvironmentCapabilityConfigStore.delete](../../packages/capability-sdk/src/host/index.ts#L184)?：方法，第?? 184 ?? 行。
- [subsetConfiguration](../../packages/capability-sdk/src/host/index.ts#L191)?：函数，第?? 191 ?? 行。
- [subsetManifest](../../packages/capability-sdk/src/host/index.ts#L206)?：函数，第?? 206 ?? 行。
- [createSplitCapabilityConfigStore](../../packages/capability-sdk/src/host/index.ts#L221)?：函数，第?? 221 ?? 行。
- [CapabilitySkillCatalog](../../packages/capability-sdk/src/host/index.ts#L254)?：类，第?? 254 ?? 行。
- [CapabilitySkillCatalog.get](../../packages/capability-sdk/src/host/index.ts#L263)?：方法，第?? 263 ?? 行。
- [CapabilitySkillCatalog.instructions](../../packages/capability-sdk/src/host/index.ts#L267)?：方法，第?? 267 ?? 行。
- [mountCapabilities](../../packages/capability-sdk/src/host/index.ts#L301)?：函数，第?? 301 ?? 行。

### [packages/capability-sdk/src/adapters/ai-sdk/index.ts](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts)

- [inputSchema](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L56)?：函数，第?? 56 ?? 行。
- [createSkillTool](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L71)?：函数，第?? 71 ?? 行。
- [toAISDKToolSet](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L114)?：函数，第?? 114 ?? 行。
- [createAISDKResponseTool](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L174)?：函数，第?? 174 ?? 行。
- [mountAISDKCapabilities](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L207)?：函数，第?? 207 ?? 行。

### [packages/capability-sdk/src/adapters/mcp/index.ts](../../packages/capability-sdk/src/adapters/mcp/index.ts)

- [resolvedContext](../../packages/capability-sdk/src/adapters/mcp/index.ts#L48)?：函数，第?? 48 ?? 行。
- [mcpContent](../../packages/capability-sdk/src/adapters/mcp/index.ts#L60)?：函数，第?? 60 ?? 行。
- [capabilityResultToMcpResult](../../packages/capability-sdk/src/adapters/mcp/index.ts#L77)?：函数，第?? 77 ?? 行。
- [createCapabilityMcpServer](../../packages/capability-sdk/src/adapters/mcp/index.ts#L107)?：函数，第?? 107 ?? 行。
- [createCapabilityMcpHandler](../../packages/capability-sdk/src/adapters/mcp/index.ts#L263)?：函数，第?? 263 ?? 行。
- [serveCapabilityMcpStdio](../../packages/capability-sdk/src/adapters/mcp/index.ts#L267)?：函数，第?? 267 ?? 行。

### [src/server/ai/agents/browser-chat-executor.agent.ts](../../src/server/ai/agents/browser-chat-executor.agent.ts)

- [modelSupportsImageInput](../../src/server/ai/agents/browser-chat-executor.agent.ts#L142)?：函数，第?? 142 ?? 行。
- [finiteContextStat](../../src/server/ai/agents/browser-chat-executor.agent.ts#L146)?：函数，第?? 146 ?? 行。
- [toolContextFromStats](../../src/server/ai/agents/browser-chat-executor.agent.ts#L150)?：函数，第?? 150 ?? 行。
- [toolContextFromAiRequest](../../src/server/ai/agents/browser-chat-executor.agent.ts#L168)?：函数，第?? 168 ?? 行。
- [jsonSafe](../../src/server/ai/agents/browser-chat-executor.agent.ts#L178)?：函数，第?? 178 ?? 行。
- [trimDebugText](../../src/server/ai/agents/browser-chat-executor.agent.ts#L206)?：函数，第?? 206 ?? 行。
- [providerToolSchemaError](../../src/server/ai/agents/browser-chat-executor.agent.ts#L210)?：函数，第?? 210 ?? 行。
- [boundedInteger](../../src/server/ai/agents/browser-chat-executor.agent.ts#L214)?：函数，第?? 214 ?? 行。
- [upstreamApiDisconnectReason](../../src/server/ai/agents/browser-chat-executor.agent.ts#L220)?：函数，第?? 220 ?? 行。
- [aiRequestFromError](../../src/server/ai/agents/browser-chat-executor.agent.ts#L228)?：函数，第?? 228 ?? 行。
- [runtimeRetryFromError](../../src/server/ai/agents/browser-chat-executor.agent.ts#L233)?：函数，第?? 233 ?? 行。
- [diagnosticValueText](../../src/server/ai/agents/browser-chat-executor.agent.ts#L254)?：函数，第?? 254 ?? 行。
- [aiRequestBrief](../../src/server/ai/agents/browser-chat-executor.agent.ts#L265)?：函数，第?? 265 ?? 行。
- [upstreamDisconnectLines](../../src/server/ai/agents/browser-chat-executor.agent.ts#L277)?：函数，第?? 277 ?? 行。
- [userFacingInfrastructureError](../../src/server/ai/agents/browser-chat-executor.agent.ts#L312)?：函数，第?? 312 ?? 行。
- [userFacingToolResult](../../src/server/ai/agents/browser-chat-executor.agent.ts#L341)?：函数，第?? 341 ?? 行。
- [compactToolResultForModel](../../src/server/ai/agents/browser-chat-executor.agent.ts#L350)?：函数，第?? 350 ?? 行。
- [elapsedSince](../../src/server/ai/agents/browser-chat-executor.agent.ts#L423)?：函数，第?? 423 ?? 行。
- [splitToolInputAndReason](../../src/server/ai/agents/browser-chat-executor.agent.ts#L428)?：函数，第?? 428 ?? 行。
- [requestBrowserToolApproval](../../src/server/ai/agents/browser-chat-executor.agent.ts#L441)?：函数，第?? 441 ?? 行。
- [parseJsonObjectText](../../src/server/ai/agents/browser-chat-executor.agent.ts#L463)?：函数，第?? 463 ?? 行。
- [browserChatAbortError](../../src/server/ai/agents/browser-chat-executor.agent.ts#L477)?：函数，第?? 477 ?? 行。
- [throwIfAborted](../../src/server/ai/agents/browser-chat-executor.agent.ts#L483)?：函数，第?? 483 ?? 行。
- [throwIfStopped](../../src/server/ai/agents/browser-chat-executor.agent.ts#L487)?：函数，第?? 487 ?? 行。
- [extractJson](../../src/server/ai/agents/browser-chat-executor.agent.ts#L493)?：函数，第?? 493 ?? 行。
- [recordFromUnknown](../../src/server/ai/agents/browser-chat-executor.agent.ts#L503)?：函数，第?? 503 ?? 行。
- [systemPromptOf](../../src/server/ai/agents/browser-chat-executor.agent.ts#L507)?：函数，第?? 507 ?? 行。
- [browserChatSystemPromptForRuntime](../../src/server/ai/agents/browser-chat-executor.agent.ts#L514)?：函数，第?? 514 ?? 行。
- [summarizeToolTraces](../../src/server/ai/agents/browser-chat-executor.agent.ts#L518)?：函数，第?? 518 ?? 行。
- [browserChatFinalResponseCompletionError](../../src/server/ai/agents/browser-chat-executor.agent.ts#L543)?：函数，第?? 543 ?? 行。
- [subagentHumanPauseReply](../../src/server/ai/agents/browser-chat-executor.agent.ts#L556)?：函数，第?? 556 ?? 行。
- [subagentHumanPauseReplyFromTraces](../../src/server/ai/agents/browser-chat-executor.agent.ts#L572)?：函数，第?? 572 ?? 行。
- [imageTokenEstimatePerImage](../../src/server/ai/agents/browser-chat-executor.agent.ts#L587)?：函数，第?? 587 ?? 行。
- [VisualContextManager](../../src/server/ai/agents/browser-chat-executor.agent.ts#L591)?：类，第?? 591 ?? 行。
- [VisualContextManager.append](../../src/server/ai/agents/browser-chat-executor.agent.ts#L599)?：方法，第?? 599 ?? 行。
- [VisualContextManager.restore](../../src/server/ai/agents/browser-chat-executor.agent.ts#L617)?：方法，第?? 617 ?? 行。
- [VisualContextManager.select](../../src/server/ai/agents/browser-chat-executor.agent.ts#L625)?：方法，第?? 625 ?? 行。
- [VisualContextManager.clearCurrent](../../src/server/ai/agents/browser-chat-executor.agent.ts#L633)?：方法，第?? 633 ?? 行。
- [VisualContextManager.current](../../src/server/ai/agents/browser-chat-executor.agent.ts#L638)?：方法，第?? 638 ?? 行。
- [VisualContextManager.snapshot](../../src/server/ai/agents/browser-chat-executor.agent.ts#L642)?：方法，第?? 642 ?? 行。
- [VisualContextManager.persisted](../../src/server/ai/agents/browser-chat-executor.agent.ts#L649)?：方法，第?? 649 ?? 行。
- [VisualContextManager.createFrame](../../src/server/ai/agents/browser-chat-executor.agent.ts#L651)?：方法，第?? 651 ?? 行。
- [VisualContextManager.demoteCurrent](../../src/server/ai/agents/browser-chat-executor.agent.ts#L661)?：方法，第?? 661 ?? 行。
- [VisualContextManager.trim](../../src/server/ai/agents/browser-chat-executor.agent.ts#L667)?：方法，第?? 667 ?? 行。
- [createToolTrace](../../src/server/ai/agents/browser-chat-executor.agent.ts#L681)?：函数，第?? 681 ?? 行。
- [finalizeToolTraceVisuals](../../src/server/ai/agents/browser-chat-executor.agent.ts#L717)?：函数，第?? 717 ?? 行。
- [executeTracedBrowserAction](../../src/server/ai/agents/browser-chat-executor.agent.ts#L774)?：函数，第?? 774 ?? 行。
- [browserCodeScreenshotFileNames](../../src/server/ai/agents/browser-chat-executor.agent.ts#L864)?：函数，第?? 864 ?? 行。
- [makeBrowserTools](../../src/server/ai/agents/browser-chat-executor.agent.ts#L868)?：函数，第?? 868 ?? 行。
- [runtimePrompt](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1240)?：函数，第?? 1240 ?? 行。
- [binaryLogDescriptor](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1265)?：函数，第?? 1265 ?? 行。
- [sanitizeModelLogValue](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1283)?：函数，第?? 1283 ?? 行。
- [browserChatSafetyInstructions](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1356)?：函数，第?? 1356 ?? 行。
- [createInteractiveBrowserRuntimeRecord](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1373)?：函数，第?? 1373 ?? 行。
- [executeInteractiveBrowserTurn](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1388)?：函数，第?? 1388 ?? 行。
- [errorRecordSources](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1463)?：函数，第?? 1463 ?? 行。
- [firstErrorString](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1480)?：函数，第?? 1480 ?? 行。
- [firstErrorValue](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1488)?：函数，第?? 1488 ?? 行。
- [firstErrorDisplay](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1498)?：函数，第?? 1498 ?? 行。
- [firstErrorNumber](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1502)?：函数，第?? 1502 ?? 行。
- [errorCauseMessage](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1510)?：函数，第?? 1510 ?? 行。
- [errorDetailText](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1521)?：函数，第?? 1521 ?? 行。
- [infrastructureError](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1538)?：函数，第?? 1538 ?? 行。
- [flowInput](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1544)?：函数，第?? 1544 ?? 行。
- [executeRecordedBrowserOperation](../../src/server/ai/agents/browser-chat-executor.agent.ts#L1563)?：函数，第?? 1563 ?? 行。

### [src/server/ai/agents/runtime-tool-selection.ts](../../src/server/ai/agents/runtime-tool-selection.ts)

- [runtimeToolRequiresBrowserSession](../../src/server/ai/agents/runtime-tool-selection.ts#L12)?：函数，第?? 12 ?? 行。
- [runtimeAllowedToolTypes](../../src/server/ai/agents/runtime-tool-selection.ts#L16)?：函数，第?? 16 ?? 行。
- [actionFromInput](../../src/server/ai/agents/runtime-tool-selection.ts#L32)?：函数，第?? 32 ?? 行。
- [isBrowserHumanPauseCall](../../src/server/ai/agents/runtime-tool-selection.ts#L38)?：函数，第?? 38 ?? 行。

### [src/server/ai/agents/browser-tool-approval.ts](../../src/server/ai/agents/browser-tool-approval.ts)

- [compact](../../src/server/ai/agents/browser-tool-approval.ts#L10)?：函数，第?? 10 ?? 行。
- [browserToolApprovalRequest](../../src/server/ai/agents/browser-tool-approval.ts#L15)?：函数，第?? 15 ?? 行。

### [src/server/capabilities/agent-infrastructure.ts](../../src/server/capabilities/agent-infrastructure.ts)

- [safeSegment](../../src/server/capabilities/agent-infrastructure.ts#L42)?：函数，第?? 42 ?? 行。
- [createAgentCodeSandboxCapability](../../src/server/capabilities/agent-infrastructure.ts#L47)?：函数，第?? 47 ?? 行。
- [configuredConnectors](../../src/server/capabilities/agent-infrastructure.ts#L65)?：函数，第?? 65 ?? 行。
- [configuredCommunicationChannels](../../src/server/capabilities/agent-infrastructure.ts#L71)?：函数，第?? 71 ?? 行。
- [configuredDataSources](../../src/server/capabilities/agent-infrastructure.ts#L77)?：函数，第?? 77 ?? 行。
- [createConfiguredMediaOperations](../../src/server/capabilities/agent-infrastructure.ts#L90)?：函数，第?? 90 ?? 行。
- [agentMediaToolTimeoutMs](../../src/server/capabilities/agent-infrastructure.ts#L167)?：函数，第?? 167 ?? 行。
- [createAgentInfrastructureProviders](../../src/server/capabilities/agent-infrastructure.ts#L176)?：函数，第?? 176 ?? 行。
