# 最终响应工具 finalResponse：完整实现逻辑

## 响应契约

工具来自 createAISDKResponseTool 与 mounted runtime 的 responseSession。输入是有序 blocks，每个块有已注册 type 和 params，外加 status/completion 等宿主完成字段。ResponseRegistry 按 manifest 收集可用类型并按实际启用工具过滤。core.markdown 只需 params.text，core.ui 使用 tree，core.html 要求 html/title/text，图表/画布/地图用能力成功结果的 content[].block。

## 接受链

1. adapter/parser 按 type 对 params 做 schema 校验；未知类型、漏字段、块形状错误在接受前失败。
2. Orbit 的 onAccept 再通过 record('finalResponse') 调用 referenceOptions.reviewFinalResponse。没有宿主回调则使用基础 completion 检查并拒绝无法审查的终结。
3. 检查 completion.complete=true 与 remainingWork=[]，核对请求范围、任务结果、证据、文件/报告和未完成事项；宿主还做独立完成审核。status=failed 不能绕过未完成检查。
4. 审核失败返回 accepted=false 与真实错误，不写入已接受 responseSession；模型仍在活动执行中继续处理。
5. 审核通过登记 blocks/status、接受回执和 blockCount；客户端按数组顺序转成文本、HTML、UI、文件、图表及地图 parts，不因类型分组重排。

## 前端和传输

responses/react.tsx 与各能力 response-react 负责显示；response-node/宿主 response-handlers 负责按权限读取记录和更新。core.html 在隔离框架显示，受资源、脚本/事件/表单限制；其 text 是必需的纯文本等价内容，不能用相邻 Markdown 替代。通信/导出以注册 parts 和实际产物为依据。

responseSession 与日志在本轮由 adapter/host 持有；任意直接写对话正文并不等于已通过 finalResponse 完成检查。最终报告如果后续证据改变，必须与实际执行结论一致。

## 源码与函数定位

### [packages/capability-sdk/src/response.ts](../../packages/capability-sdk/src/response.ts)

- [defineResponseType](../../packages/capability-sdk/src/response.ts#L32)?：函数，第?? 32 ?? 行。
- [object](../../packages/capability-sdk/src/response.ts#L36)?：函数，第?? 36 ?? 行。
- [ResponseRegistry](../../packages/capability-sdk/src/response.ts#L41)?：类，第?? 41 ?? 行。
- [ResponseRegistry.register](../../packages/capability-sdk/src/response.ts#L44)?：方法，第?? 44 ?? 行。
- [ResponseRegistry.definitions](../../packages/capability-sdk/src/response.ts#L53)?：方法，第?? 53 ?? 行。
- [ResponseRegistry.get](../../packages/capability-sdk/src/response.ts#L54)?：方法，第?? 54 ?? 行。
- [ResponseRegistry.registerManifests](../../packages/capability-sdk/src/response.ts#L56)?：方法，第?? 56 ?? 行。
- [ResponseRegistry.forTools](../../packages/capability-sdk/src/response.ts#L60)?：方法，第?? 60 ?? 行。
- [ResponseRegistry.require](../../packages/capability-sdk/src/response.ts#L63)?：方法，第?? 63 ?? 行。
- [ResponseRegistry.parse](../../packages/capability-sdk/src/response.ts#L69)?：方法，第?? 69 ?? 行。
- [ResponseRegistry.parseResponse](../../packages/capability-sdk/src/response.ts#L76)?：方法，第?? 76 ?? 行。
- [ResponseRegistry.repairInput](../../packages/capability-sdk/src/response.ts#L106)?：方法，第?? 106 ?? 行。
- [ResponseRegistry.parseInput](../../packages/capability-sdk/src/response.ts#L151)?：方法，第?? 151 ?? 行。
- [ResponseRegistry.modelInstructions](../../packages/capability-sdk/src/response.ts#L162)?：方法，第?? 162 ?? 行。
- [ResponseRegistry.input](../../packages/capability-sdk/src/response.ts#L176)?：方法，第?? 176 ?? 行。
- [ResponseRegistry.partial](../../packages/capability-sdk/src/response.ts#L202)?：方法，第?? 202 ?? 行。
- [ResponseRegistry.toText](../../packages/capability-sdk/src/response.ts#L216)?：方法，第?? 216 ?? 行。
- [ResponseRegistry.mapText](../../packages/capability-sdk/src/response.ts#L221)?：方法，第?? 221 ?? 行。
- [ResponseRegistry.resource](../../packages/capability-sdk/src/response.ts#L227)?：方法，第?? 227 ?? 行。
- [ResponseRegistry.toolBlocks](../../packages/capability-sdk/src/response.ts#L233)?：方法，第?? 233 ?? 行。
- [ResponseRegistry.identity](../../packages/capability-sdk/src/response.ts#L249)?：方法，第?? 249 ?? 行。
- [ResponseRegistry.missing](../../packages/capability-sdk/src/response.ts#L258)?：方法，第?? 258 ?? 行。
- [ResponseRegistry.assemble](../../packages/capability-sdk/src/response.ts#L269)?：方法，第?? 269 ?? 行。
- [canonical](../../packages/capability-sdk/src/response.ts#L275)?：函数，第?? 275 ?? 行。
- [closeResponseBlocksArray](../../packages/capability-sdk/src/response.ts#L283)?：函数，第?? 283 ?? 行。
- [ResponseSession](../../packages/capability-sdk/src/response.ts#L313)?：类，第?? 313 ?? 行。
- [ResponseSession.observe](../../packages/capability-sdk/src/response.ts#L318)?：方法，第?? 318 ?? 行。
- [ResponseSession.accept](../../packages/capability-sdk/src/response.ts#L324)?：方法，第?? 324 ?? 行。
- [ResponseSession.finish](../../packages/capability-sdk/src/response.ts#L333)?：方法，第?? 333 ?? 行。
- [relocateSchema](../../packages/capability-sdk/src/response.ts#L345)?：函数，第?? 345 ?? 行。
- [ResponseOperationError](../../packages/capability-sdk/src/response.ts#L357)?：类，第?? 357 ?? 行。
- [ResponseHandlerRegistry](../../packages/capability-sdk/src/response.ts#L371)?：类，第?? 371 ?? 行。
- [ResponseHandlerRegistry.register](../../packages/capability-sdk/src/response.ts#L374)?：方法，第?? 374 ?? 行。
- [ResponseHandlerRegistry.assertComplete](../../packages/capability-sdk/src/response.ts#L382)?：方法，第?? 382 ?? 行。
- [ResponseHandlerRegistry.execute](../../packages/capability-sdk/src/response.ts#L388)?：方法，第?? 388 ?? 行。
- [ResponseHandlerRegistry.export](../../packages/capability-sdk/src/response.ts#L397)?：方法，第?? 397 ?? 行。

### [packages/capability-sdk/src/adapters/ai-sdk/index.ts](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts)

- [inputSchema](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L56)?：函数，第?? 56 ?? 行。
- [createSkillTool](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L71)?：函数，第?? 71 ?? 行。
- [toAISDKToolSet](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L114)?：函数，第?? 114 ?? 行。
- [createAISDKResponseTool](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L174)?：函数，第?? 174 ?? 行。
- [mountAISDKCapabilities](../../packages/capability-sdk/src/adapters/ai-sdk/index.ts#L207)?：函数，第?? 207 ?? 行。

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

### [src/server/ai/agents/runtime-completion-review.ts](../../src/server/ai/agents/runtime-completion-review.ts)

- [object](../../src/server/ai/agents/runtime-completion-review.ts#L33)?：函数，第?? 33 ?? 行。
- [completionReviewEvidence](../../src/server/ai/agents/runtime-completion-review.ts#L40)?：函数，第?? 40 ?? 行。
- [completionReviewImages](../../src/server/ai/agents/runtime-completion-review.ts#L67)?：函数，第?? 67 ?? 行。
- [CompletionReviewUnavailableError](../../src/server/ai/agents/runtime-completion-review.ts#L85)?：类，第?? 85 ?? 行。
- [completionReviewArtifacts](../../src/server/ai/agents/runtime-completion-review.ts#L99)?：函数，第?? 99 ?? 行。
- [parseCompletionReview](../../src/server/ai/agents/runtime-completion-review.ts#L136)?：函数，第?? 136 ?? 行。

### [src/lib/browser-chat-ui-message.ts](../../src/lib/browser-chat-ui-message.ts)

- [browserChatFinalBlocksToParts](../../src/lib/browser-chat-ui-message.ts#L49)?：函数，第?? 49 ?? 行。
- [browserChatFinalBlocksToText](../../src/lib/browser-chat-ui-message.ts#L53)?：函数，第?? 53 ?? 行。
- [browserChatToolPartFromStep](../../src/lib/browser-chat-ui-message.ts#L57)?：函数，第?? 57 ?? 行。
- [browserChatExecutionParts](../../src/lib/browser-chat-ui-message.ts#L81)?：函数，第?? 81 ?? 行。
- [browserChatResponseParts](../../src/lib/browser-chat-ui-message.ts#L97)?：函数，第?? 97 ?? 行。

### [src/components/response-renderers.tsx](../../src/components/response-renderers.tsx)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。

### [src/server/capabilities/response-handlers.ts](../../src/server/capabilities/response-handlers.ts)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。


## 完整输入构造（当前源码原文）

status 为 passed/failed/blocked；blocks 1–64 个，类型与完整 params schema 来自本次启用的 ResponseRegistry definitions，无法用固定目录枚举代替。completion 声明完整工作；宿主另行要求完成审核。以下保留动态 schema 构造的完整方法，relocateSchema 只重定位嵌套 $ref。

```ts
input(): CapabilityInputSchema<StructuredResponse> {
    const variants = this.definitions().map((definition, index) => ({
      type: 'object', additionalProperties: false, required: ['type', 'params'],
      description: definition.description,
      properties: { type: { type: 'string', const: definition.type }, params: relocateSchema(definition.params.jsonSchema, `#/properties/blocks/items/anyOf/${index}/properties/params`) },
      ...(definition.examples?.length ? { examples: definition.examples.map(params => ({ type: definition.type, params })) } : {}),
    }));
    const jsonSchema: JsonSchema = {
      type: 'object', additionalProperties: false, required: ['status', 'blocks'],
      properties: {
        status: { type: 'string', enum: ['passed', 'failed', 'blocked'] },
        completion: {
          type: 'object', additionalProperties: false, required: ['complete', 'remainingWork'],
          description: 'Declare whether the active user request is complete and list any unfinished work. Hosts may require this declaration before accepting a final response.',
          properties: {
            complete: { type: 'boolean', description: 'True only after the active user request is fully handled.' },
            remainingWork: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 500 } },
          },
        },
        blocks: { type: 'array', minItems: 1, maxItems: 64, description: 'Ordered {type, params} blocks. All content is inside params; put HTML and its CSS in the same core.html block, never in a separate text fragment.', items: { anyOf: variants } },
      },
    };
    return { jsonSchema, parse: value => this.parseInput(value) };
  }
```
