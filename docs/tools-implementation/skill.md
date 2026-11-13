# 技能读取工具 skill：完整实现逻辑

## 输入和入口

输入为 action=read、准确 skillId、reason。Orbit 入口在 browser-chat-executor.agent.ts；缺少非空 reason 时 preprocess 根据 skillId 补“读取 Skill：ID”。skillId 长度 1–160，action 只有 read。该工具被 record 包装，进入与其他工具相同的日志和执行追踪。

## 执行分支

先 hiddenRuntimeSkillContent(skillId) 查系统技能目录，存在则返回当前完整原文作为 actual；否则调用宿主 referenceOptions.readSkill，读取用户 Skill。没有读取回调或找不到 ID 返回 unavailable。工具返回正文，不是执行 Skill 中提到的动作。

hidden-runtime-skills 从能力 manifest 的 skills 收集系统技能，再加入 subagentRuntimeSkill；浏览器使用宿主 browserInteractionSkill 替换 SDK 主技能，其他附加参考技能保留。activation 的 toolName/actions 建立工具调用所需内容检查，不是所有 Skill 的读取前提。

可读目录以能力归属和当前挂载工具为准，Orbit 和 SDK 统一使用 capabilitySkillsForTools：带 activation 的运行规范只随对应工具开放；没有 activation 的设计指导、API 手册、图示参考随所属能力开放。所属能力没有任何可用工具时，其全部 Skill 隐藏。文件 plan 返回的设计 Skill ID 因而可以直接读取，无需为参考资料伪造 activation，也不会把这些可选参考变成每次工具调用的前置条件。

## 内容在上下文中的有效性

hiddenRuntimeSkillIdsInModelContext 识别三种准确回执：成功 skill 返回全文、失败工具中 RUNTIME_SKILL_CONTENT_RETURNED 内嵌全文、runtimeSkill.readSatisfied 回执。仅与当前 Skill 全文逐字匹配时满足 gate；摘要、用户声明、旧版本或压缩掉正文均不足。skillBodyKeysForPreservation 使用 skillId+SHA256 为准确正文标记，压缩保留历史读取证据与当前版本执行资格是两件事。

Skill gate 的补正文和授权检查由宿主负责，能力包只发布内容。当前上下文已经含当前全文时无需重复读取；技能变更后需新内容。用户 Skill 存储和系统 hidden catalog 互相独立，不因用户 Skill 没有系统 ID 而丢弃其保存证据。

## 源码与函数定位

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

### [src/server/ai/agents/hidden-runtime-skills.ts](../../src/server/ai/agents/hidden-runtime-skills.ts)

- [manifestRuntimeSkill](../../src/server/ai/agents/hidden-runtime-skills.ts#L22)?：函数，第?? 22 ?? 行。
- [actionFromInput](../../src/server/ai/agents/hidden-runtime-skills.ts#L59)?：函数，第?? 59 ?? 行。
- [activeBrowserRuntimeSkillId](../../src/server/ai/agents/hidden-runtime-skills.ts#L81)?：函数，第?? 81 ?? 行。
- [hiddenRuntimeSkillIds](../../src/server/ai/agents/hidden-runtime-skills.ts#L85)?：函数，第?? 85 ?? 行。
- [hiddenRuntimeSkillContent](../../src/server/ai/agents/hidden-runtime-skills.ts#L89)?：函数，第?? 89 ?? 行。
- [hiddenRuntimeToolCatalog](../../src/server/ai/agents/hidden-runtime-skills.ts#L93)?：函数，第?? 93 ?? 行。
- [capabilityRuntimeToolCatalog](../../src/server/ai/agents/hidden-runtime-skills.ts#L97)?：函数，第?? 97 ?? 行。
- [toolCatalogFromSkills](../../src/server/ai/agents/hidden-runtime-skills.ts#L101)?：函数，第?? 101 ?? 行。
- [runtimeSkillResultRecord](../../src/server/ai/agents/hidden-runtime-skills.ts#L109)?：函数，第?? 109 ?? 行。
- [hiddenRuntimeSkillIdsInModelContext](../../src/server/ai/agents/hidden-runtime-skills.ts#L128)?：函数，第?? 128 ?? 行。
- [skillBodyKeysForPreservation](../../src/server/ai/agents/hidden-runtime-skills.ts#L160)?：函数，第?? 160 ?? 行。
- [requiredHiddenRuntimeSkillId](../../src/server/ai/agents/hidden-runtime-skills.ts#L189)?：函数，第?? 189 ?? 行。
- [requireHiddenRuntimeSkillRead](../../src/server/ai/agents/hidden-runtime-skills.ts#L198)?：函数，第?? 198 ?? 行。
- [hiddenRuntimeSkillForToolCall](../../src/server/ai/agents/hidden-runtime-skills.ts#L222)?：函数，第?? 222 ?? 行。
- [runtimeToolTypesWithLoadedSkills](../../src/server/ai/agents/hidden-runtime-skills.ts#L233)?：函数，第?? 233 ?? 行。

### [src/server/ai/agents/skill-context.ts](../../src/server/ai/agents/skill-context.ts)

- [compactText](../../src/server/ai/agents/skill-context.ts#L4)?：函数，第?? 4 ?? 行。
- [xmlAttribute](../../src/server/ai/agents/skill-context.ts#L9)?：函数，第?? 9 ?? 行。
- [activeSkills](../../src/server/ai/agents/skill-context.ts#L17)?：函数，第?? 17 ?? 行。
- [skillRelevanceScore](../../src/server/ai/agents/skill-context.ts#L21)?：函数，第?? 21 ?? 行。
- [runtimeSkills](../../src/server/ai/agents/skill-context.ts#L29)?：函数，第?? 29 ?? 行。
- [formatSkillReferencesForUser](../../src/server/ai/agents/skill-context.ts#L54)?：函数，第?? 54 ?? 行。
- [formatSkillSummariesForPrompt](../../src/server/ai/agents/skill-context.ts#L64)?：函数，第?? 64 ?? 行。
- [formatLoadedSkillsForPrompt](../../src/server/ai/agents/skill-context.ts#L82)?：函数，第?? 82 ?? 行。


## 完整输入定义（当前源码原文）

以下保留 preprocess/superRefine 及示例包装；toolReasonInput 为长度 1–300 的字符串，browserToolInput 给所有子代理参数加 reason。

```ts
withToolInputExamples(z.preprocess((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        const record = value as Record<string, unknown>;
        if (typeof record.reason === 'string' && record.reason.trim()) return value;
        const skillId = typeof record.skillId === 'string' ? record.skillId.trim() : '';
        return { ...record, reason: skillId ? `读取 Skill：${skillId}` : '读取运行规范' };
      }, z.object({
        reason: toolReasonInput,
        action: z.literal('read'),
        skillId: z.string().min(1).max(160).describe('Exact Skill id from an available <system_skill> or user Skill summary.'),
      })), [
        { reason: '读取浏览器代码运行规范', action: 'read', skillId: browserRuntimeSkillId },
        { reason: '读取文件产物运行规范', action: 'read', skillId: fileArtifactRuntimeSkillId },
        { reason: '读取图表生成运行规范', action: 'read', skillId: chartRuntimeSkillId },
        { reason: '读取子 Agent 运行规范', action: 'read', skillId: subagentRuntimeSkillId },
      ])
```
