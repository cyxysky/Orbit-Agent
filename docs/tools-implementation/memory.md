# 个人记忆工具 memory：完整实现逻辑

## 入口和作用域

createPersonalMemoryTools 在 browser-chat.service 不同运行入口单独挂载，不属于 CapabilityRegistry 的 13 类能力。上下文提供规范 userId、当前 URL、当前来源消息/会话、只读模式、已使用记忆 ID 集合及取消信号。一个输入 schema 合并 memoryCandidateSchema 的可选字段并增加 action=search/save/update/disable、query/limit/id；未知字段禁止。

## search

要求非空 query（最多 1000），limit 1–20。按当前用户与 normalizePersonalMemoryDomain(URL) 搜索有效已批准记忆，返回 item、score、reasons。每轮 usedMemoryIds 去重，只对首次使用的结果 markPersonalMemoryItemsUsed，防止同轮多次检索重复累计使用。输出保留 scope/domain/type/key/aliases/value/status/applicability/utility/evidence/verification/expiry 和更新时间。

## save/update/disable

只读上下文拒绝任何变更。写入必须有识别过的当前用户消息、sourceSessionId 和 sourceMessageIds。update/disable 必须加载当前用户拥有的准确 id；候选字段先继承已有记忆再覆盖明确提供值，并用完整 memoryCandidateSchema 校验。disable 填充停止使用该规则的 applicability/utility，使用 user_correction 来源，不能无依据推断“忘记”。

verified_procedure 不能在普通工具写入伪造，实际程序验证必须由执行结束后的提取工作收集。reviewPersonalMemoryCandidates 接收当前原始用户消息、来源 ID、目标 ID、候选、requestedAction、receiptSuffix 和 abort，独立审核来源支持、长期适用性、效用、重复/冲突。未审核候选不成为活动记忆。

## 结果与持久化

返回 pendingCandidateId、changed、skipped、reason、已审核 items 和 review diagnostics；这些字段区分“提出候选”和“已生效”。个人记忆存储、候选、审核作业及回执在 personal-memory/policy/job 模块实现，通过宿主数据库持久化并按用户隔离。知识库参考正文与个人记忆规则不互相替代。

## 源码与函数定位

### [src/server/ai/personal-memory-tools.ts](../../src/server/ai/personal-memory-tools.ts)

- [toolMemoryItem](../../src/server/ai/personal-memory-tools.ts#L24)?：函数，第?? 24 ?? 行。
- [createPersonalMemoryTools](../../src/server/ai/personal-memory-tools.ts#L32)?：函数，第?? 32 ?? 行。

### [src/server/ai/personal-memory.ts](../../src/server/ai/personal-memory.ts)

- [parsePersonalMemoryExtractionOutput](../../src/server/ai/personal-memory.ts#L134)?：函数，第?? 134 ?? 行。
- [now](../../src/server/ai/personal-memory.ts#L138)?：函数，第?? 138 ?? 行。
- [textFromUnknown](../../src/server/ai/personal-memory.ts#L142)?：函数，第?? 142 ?? 行。
- [compactText](../../src/server/ai/personal-memory.ts#L148)?：函数，第?? 148 ?? 行。
- [normalizePersonalMemoryValue](../../src/server/ai/personal-memory.ts#L153)?：函数，第?? 153 ?? 行。
- [normalizePersonalMemoryUserId](../../src/server/ai/personal-memory.ts#L157)?：函数，第?? 157 ?? 行。
- [personalMemoryEnabled](../../src/server/ai/personal-memory.ts#L161)?：函数，第?? 161 ?? 行。
- [personalMemoryExtractionEnabled](../../src/server/ai/personal-memory.ts#L165)?：函数，第?? 165 ?? 行。
- [personalMemoryPromptLimit](../../src/server/ai/personal-memory.ts#L169)?：函数，第?? 169 ?? 行。
- [personalMemoryPromptMaxChars](../../src/server/ai/personal-memory.ts#L174)?：函数，第?? 174 ?? 行。
- [personalMemoryExtractionInputLimit](../../src/server/ai/personal-memory.ts#L179)?：函数，第?? 179 ?? 行。
- [normalizePersonalMemoryDomain](../../src/server/ai/personal-memory.ts#L184)?：函数，第?? 184 ?? 行。
- [domainMatches](../../src/server/ai/personal-memory.ts#L200)?：函数，第?? 200 ?? 行。
- [normalizeScope](../../src/server/ai/personal-memory.ts#L206)?：函数，第?? 206 ?? 行。
- [normalizeType](../../src/server/ai/personal-memory.ts#L212)?：函数，第?? 212 ?? 行。
- [normalizeStatus](../../src/server/ai/personal-memory.ts#L218)?：函数，第?? 218 ?? 行。
- [normalizeConfidence](../../src/server/ai/personal-memory.ts#L224)?：函数，第?? 224 ?? 行。
- [normalizeKey](../../src/server/ai/personal-memory.ts#L230)?：函数，第?? 230 ?? 行。
- [normalizeAliases](../../src/server/ai/personal-memory.ts#L234)?：函数，第?? 234 ?? 行。
- [itemText](../../src/server/ai/personal-memory.ts#L248)?：函数，第?? 248 ?? 行。
- [normalizeMemoryDraft](../../src/server/ai/personal-memory.ts#L254)?：函数，第?? 254 ?? 行。
- [normalizeStoreItem](../../src/server/ai/personal-memory.ts#L298)?：函数，第?? 298 ?? 行。
- [readStore](../../src/server/ai/personal-memory.ts#L322)?：函数，第?? 322 ?? 行。
- [memoryIdentity](../../src/server/ai/personal-memory.ts#L335)?：函数，第?? 335 ?? 行。
- [listPersonalMemoryItems](../../src/server/ai/personal-memory.ts#L345)?：函数，第?? 345 ?? 行。
- [getPersonalMemoryItem](../../src/server/ai/personal-memory.ts#L369)?：函数，第?? 369 ?? 行。
- [savePersonalMemoryItem](../../src/server/ai/personal-memory.ts#L378)?：函数，第?? 378 ?? 行。
- [savePersonalMemoryItems](../../src/server/ai/personal-memory.ts#L425)?：函数，第?? 425 ?? 行。
- [updatePersonalMemoryItem](../../src/server/ai/personal-memory.ts#L467)?：函数，第?? 467 ?? 行。
- [deletePersonalMemoryItem](../../src/server/ai/personal-memory.ts#L525)?：函数，第?? 525 ?? 行。
- [rankPersonalMemory](../../src/server/ai/personal-memory.ts#L535)?：函数，第?? 535 ?? 行。
- [searchPersonalMemory](../../src/server/ai/personal-memory.ts#L578)?：函数，第?? 578 ?? 行。
- [formatPersonalMemoryForRuntime](../../src/server/ai/personal-memory.ts#L593)?：函数，第?? 593 ?? 行。
- [markPersonalMemoryItemsUsed](../../src/server/ai/personal-memory.ts#L605)?：函数，第?? 605 ?? 行。
- [formatPersonalMemoryForPrompt](../../src/server/ai/personal-memory.ts#L611)?：函数，第?? 611 ?? 行。
- [personalMemoryDiagnostics](../../src/server/ai/personal-memory.ts#L655)?：函数，第?? 655 ?? 行。

### [src/server/ai/personal-memory-policy.ts](../../src/server/ai/personal-memory-policy.ts)

- [parseMemoryJson](../../src/server/ai/personal-memory-policy.ts#L53)?：函数，第?? 53 ?? 行。
- [evidenceIsInMessage](../../src/server/ai/personal-memory-policy.ts#L78)?：函数，第?? 78 ?? 行。

### [src/server/ai/agents/browser-chat.service.ts](../../src/server/ai/agents/browser-chat.service.ts)

- [readBrowserChatRuntimeStatus](../../src/server/ai/agents/browser-chat.service.ts#L522)?：函数，第?? 522 ?? 行。
- [browserChatNoVncUrl](../../src/server/ai/agents/browser-chat.service.ts#L573)?：函数，第?? 573 ?? 行。
- [browserChatBrowserProfileKey](../../src/server/ai/agents/browser-chat.service.ts#L584)?：函数，第?? 584 ?? 行。
- [browserChatUserRuntimeKey](../../src/server/ai/agents/browser-chat.service.ts#L594)?：函数，第?? 594 ?? 行。
- [browserChatUserBrowserIdleTimeoutMs](../../src/server/ai/agents/browser-chat.service.ts#L598)?：函数，第?? 598 ?? 行。
- [cancelBrowserChatSessionEviction](../../src/server/ai/agents/browser-chat.service.ts#L605)?：函数，第?? 605 ?? 行。
- [browserChatSessionIsSelected](../../src/server/ai/agents/browser-chat.service.ts#L611)?：函数，第?? 611 ?? 行。
- [browserChatSessionHasActiveRuntimeWork](../../src/server/ai/agents/browser-chat.service.ts#L615)?：函数，第?? 615 ?? 行。
- [browserChatSessionHasRuntimeWork](../../src/server/ai/agents/browser-chat.service.ts#L624)?：函数，第?? 624 ?? 行。
- [evictBrowserChatSessionRuntime](../../src/server/ai/agents/browser-chat.service.ts#L628)?：函数，第?? 628 ?? 行。
- [compactIdleBrowserChatSessionRuntime](../../src/server/ai/agents/browser-chat.service.ts#L642)?：函数，第?? 642 ?? 行。
- [releaseInactiveBrowserChatSessionRuntime](../../src/server/ai/agents/browser-chat.service.ts#L665)?：函数，第?? 665 ?? 行。
- [scheduleBrowserChatSessionEviction](../../src/server/ai/agents/browser-chat.service.ts#L695)?：函数，第?? 695 ?? 行。
- [browserChatUserHasActiveWork](../../src/server/ai/agents/browser-chat.service.ts#L717)?：函数，第?? 717 ?? 行。
- [cancelBrowserChatUserIdleClose](../../src/server/ai/agents/browser-chat.service.ts#L727)?：函数，第?? 727 ?? 行。
- [scheduleBrowserChatUserIdleClose](../../src/server/ai/agents/browser-chat.service.ts#L735)?：函数，第?? 735 ?? 行。
- [browserChatLogLimit](../../src/server/ai/agents/browser-chat.service.ts#L774)?：函数，第?? 774 ?? 行。
- [browserChatLogDetailCharacterLimit](../../src/server/ai/agents/browser-chat.service.ts#L780)?：函数，第?? 780 ?? 行。
- [browserChatLogCharacterLimit](../../src/server/ai/agents/browser-chat.service.ts#L786)?：函数，第?? 786 ?? 行。
- [browserChatOutputCycleLimit](../../src/server/ai/agents/browser-chat.service.ts#L792)?：函数，第?? 792 ?? 行。
- [browserChatProgressPersistDelayMs](../../src/server/ai/agents/browser-chat.service.ts#L798)?：函数，第?? 798 ?? 行。
- [browserChatStreamPublishDelayMs](../../src/server/ai/agents/browser-chat.service.ts#L804)?：函数，第?? 804 ?? 行。
- [trimBrowserChatLogs](../../src/server/ai/agents/browser-chat.service.ts#L810)?：函数，第?? 810 ?? 行。
- [trimBrowserChatOutputCycles](../../src/server/ai/agents/browser-chat.service.ts#L818)?：函数，第?? 818 ?? 行。
- [compactBrowserChatRuntimeWindow](../../src/server/ai/agents/browser-chat.service.ts#L822)?：函数，第?? 822 ?? 行。
- [dirtyRecordsFor](../../src/server/ai/agents/browser-chat.service.ts#L829)?：函数，第?? 829 ?? 行。
- [markMessageDirty](../../src/server/ai/agents/browser-chat.service.ts#L845)?：函数，第?? 845 ?? 行。
- [markMessageRemoved](../../src/server/ai/agents/browser-chat.service.ts#L851)?：函数，第?? 851 ?? 行。
- [markStepDirty](../../src/server/ai/agents/browser-chat.service.ts#L857)?：函数，第?? 857 ?? 行。
- [replaceSessionSteps](../../src/server/ai/agents/browser-chat.service.ts#L863)?：函数，第?? 863 ?? 行。
- [replaceSessionLogs](../../src/server/ai/agents/browser-chat.service.ts#L889)?：函数，第?? 889 ?? 行。
- [browserChatLogStorageLimit](../../src/server/ai/agents/browser-chat.service.ts#L904)?：函数，第?? 904 ?? 行。
- [browserChatKeepBrowserOpenAfterTurn](../../src/server/ai/agents/browser-chat.service.ts#L908)?：函数，第?? 908 ?? 行。
- [browserChatBoundedNonNegativeEnv](../../src/server/ai/agents/browser-chat.service.ts#L912)?：函数，第?? 912 ?? 行。
- [browserChatBrowserExecutionOptions](../../src/server/ai/agents/browser-chat.service.ts#L918)?：函数，第?? 918 ?? 行。
- [browserChatMemoryUrl](../../src/server/ai/agents/browser-chat.service.ts#L926)?：函数，第?? 926 ?? 行。
- [queuePersonalMemoryExtraction](../../src/server/ai/agents/browser-chat.service.ts#L931)?：函数，第?? 931 ?? 行。
- [normalizeSafetyMode](../../src/server/ai/agents/browser-chat.service.ts#L963)?：函数，第?? 963 ?? 行。
- [browserChatModelSettings](../../src/server/ai/agents/browser-chat.service.ts#L967)?：函数，第?? 967 ?? 行。
- [normalizeToolConfirmation](../../src/server/ai/agents/browser-chat.service.ts#L982)?：函数，第?? 982 ?? 行。
- [now](../../src/server/ai/agents/browser-chat.service.ts#L1010)?：函数，第?? 1010 ?? 行。
- [browserChatTurnUsedMemoryIds](../../src/server/ai/agents/browser-chat.service.ts#L1014)?：函数，第?? 1014 ?? 行。
- [id](../../src/server/ai/agents/browser-chat.service.ts#L1029)?：函数，第?? 1029 ?? 行。
- [elapsedMs](../../src/server/ai/agents/browser-chat.service.ts#L1033)?：函数，第?? 1033 ?? 行。
- [elapsedFromDetails](../../src/server/ai/agents/browser-chat.service.ts#L1037)?：函数，第?? 1037 ?? 行。
- [trimLogText](../../src/server/ai/agents/browser-chat.service.ts#L1053)?：函数，第?? 1053 ?? 行。
- [unwrapLogDetails](../../src/server/ai/agents/browser-chat.service.ts#L1058)?：函数，第?? 1058 ?? 行。
- [stringifyCompactLogDetails](../../src/server/ai/agents/browser-chat.service.ts#L1075)?：函数，第?? 1075 ?? 行。
- [logDetailsFromUnknown](../../src/server/ai/agents/browser-chat.service.ts#L1106)?：函数，第?? 1106 ?? 行。
- [errorLogDetails](../../src/server/ai/agents/browser-chat.service.ts#L1130)?：函数，第?? 1130 ?? 行。
- [userFacingErrorMessage](../../src/server/ai/agents/browser-chat.service.ts#L1144)?：函数，第?? 1144 ?? 行。
- [normalizeBrowserUrl](../../src/server/ai/agents/browser-chat.service.ts#L1152)?：函数，第?? 1152 ?? 行。
- [isEmbeddedBrowserPlaceholderUrl](../../src/server/ai/agents/browser-chat.service.ts#L1160)?：函数，第?? 1160 ?? 行。
- [isBlankBrowserUrl](../../src/server/ai/agents/browser-chat.service.ts#L1165)?：函数，第?? 1165 ?? 行。
- [exportableTargetUrl](../../src/server/ai/agents/browser-chat.service.ts#L1172)?：函数，第?? 1172 ?? 行。
- [inputUrl](../../src/server/ai/agents/browser-chat.service.ts#L1178)?：函数，第?? 1178 ?? 行。
- [firstExportableTargetUrl](../../src/server/ai/agents/browser-chat.service.ts#L1184)?：函数，第?? 1184 ?? 行。
- [exportedTargetUrl](../../src/server/ai/agents/browser-chat.service.ts#L1192)?：函数，第?? 1192 ?? 行。
- [compactText](../../src/server/ai/agents/browser-chat.service.ts#L1204)?：函数，第?? 1204 ?? 行。
- [normalizeUserId](../../src/server/ai/agents/browser-chat.service.ts#L1209)?：函数，第?? 1209 ?? 行。
- [sessionBelongsToUser](../../src/server/ai/agents/browser-chat.service.ts#L1213)?：函数，第?? 1213 ?? 行。
- [normalizeAttachments](../../src/server/ai/agents/browser-chat.service.ts#L1217)?：函数，第?? 1217 ?? 行。
- [normalizeSkillIds](../../src/server/ai/agents/browser-chat.service.ts#L1221)?：函数，第?? 1221 ?? 行。
- [artifactAttachmentForSession](../../src/server/ai/agents/browser-chat.service.ts#L1230)?：函数，第?? 1230 ?? 行。
- [readFileForSession](../../src/server/ai/agents/browser-chat.service.ts#L1249)?：函数，第?? 1249 ?? 行。
- [browserChatCredentialContext](../../src/server/ai/agents/browser-chat.service.ts#L1298)?：函数，第?? 1298 ?? 行。
- [browserChatCredentialPrompt](../../src/server/ai/agents/browser-chat.service.ts#L1338)?：函数，第?? 1338 ?? 行。
- [createBrowserChatRuntimeOperationalContext](../../src/server/ai/agents/browser-chat.service.ts#L1347)?：函数，第?? 1347 ?? 行。
- [attachmentKindLabel](../../src/server/ai/agents/browser-chat.service.ts#L1419)?：函数，第?? 1419 ?? 行。
- [decodeInlineReferenceId](../../src/server/ai/agents/browser-chat.service.ts#L1427)?：函数，第?? 1427 ?? 行。
- [attachmentPromptText](../../src/server/ai/agents/browser-chat.service.ts#L1435)?：函数，第?? 1435 ?? 行。
- [inlineReferencedIds](../../src/server/ai/agents/browser-chat.service.ts#L1444)?：函数，第?? 1444 ?? 行。
- [attachmentSummary](../../src/server/ai/agents/browser-chat.service.ts#L1453)?：函数，第?? 1453 ?? 行。
- [readFileVisualsForSession](../../src/server/ai/agents/browser-chat.service.ts#L1462)?：函数，第?? 1462 ?? 行。
- [conversationFileRegistry](../../src/server/ai/agents/browser-chat.service.ts#L1482)?：函数，第?? 1482 ?? 行。
- [contentWithInlineReferencesForPrompt](../../src/server/ai/agents/browser-chat.service.ts#L1532)?：函数，第?? 1532 ?? 行。
- [safeJson](../../src/server/ai/agents/browser-chat.service.ts#L1544)?：函数，第?? 1544 ?? 行。
- [statusFromSteps](../../src/server/ai/agents/browser-chat.service.ts#L1554)?：函数，第?? 1554 ?? 行。
- [compactStepForClient](../../src/server/ai/agents/browser-chat.service.ts#L1560)?：函数，第?? 1560 ?? 行。
- [compactRealtimeText](../../src/server/ai/agents/browser-chat.service.ts#L1570)?：函数，第?? 1570 ?? 行。
- [compactRealtimeValue](../../src/server/ai/agents/browser-chat.service.ts#L1576)?：函数，第?? 1576 ?? 行。
- [compactRealtimeTool](../../src/server/ai/agents/browser-chat.service.ts#L1599)?：函数，第?? 1599 ?? 行。
- [compactOutputCycleForRealtime](../../src/server/ai/agents/browser-chat.service.ts#L1647)?：函数，第?? 1647 ?? 行。
- [compactHistoricalAiRequest](../../src/server/ai/agents/browser-chat.service.ts#L1665)?：函数，第?? 1665 ?? 行。
- [compactBrowserChatStepsForRuntime](../../src/server/ai/agents/browser-chat.service.ts#L1693)?：函数，第?? 1693 ?? 行。
- [compactBrowserChatSubagentSteps](../../src/server/ai/agents/browser-chat.service.ts#L1704)?：函数，第?? 1704 ?? 行。
- [compactBrowserChatSubagentRecord](../../src/server/ai/agents/browser-chat.service.ts#L1708)?：函数，第?? 1708 ?? 行。
- [browserCodeAttachmentBindingsForSession](../../src/server/ai/agents/browser-chat.service.ts#L1720)?：函数，第?? 1720 ?? 行。
- [compactStepForRealtime](../../src/server/ai/agents/browser-chat.service.ts#L1743)?：函数，第?? 1743 ?? 行。
- [summaryFromSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L1753)?：函数，第?? 1753 ?? 行。
- [browserChatTabs](../../src/server/ai/agents/browser-chat.service.ts#L1772)?：函数，第?? 1772 ?? 行。
- [activeBrowserChatContextUsage](../../src/server/ai/agents/browser-chat.service.ts#L1784)?：函数，第?? 1784 ?? 行。
- [browserChatContextUsage](../../src/server/ai/agents/browser-chat.service.ts#L1793)?：函数，第?? 1793 ?? 行。
- [browserChatContextUsageFromDebugDetails](../../src/server/ai/agents/browser-chat.service.ts#L1835)?：函数，第?? 1835 ?? 行。
- [refreshBrowserChatTerminalContextUsage](../../src/server/ai/agents/browser-chat.service.ts#L1847)?：函数，第?? 1847 ?? 行。
- [sessionSnapshotHeader](../../src/server/ai/agents/browser-chat.service.ts#L1854)?：函数，第?? 1854 ?? 行。
- [snapshot](../../src/server/ai/agents/browser-chat.service.ts#L1896)?：函数，第?? 1896 ?? 行。
- [clientSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L1911)?：函数，第?? 1911 ?? 行。
- [browserChatMessageSteps](../../src/server/ai/agents/browser-chat.service.ts#L1949)?：函数，第?? 1949 ?? 行。
- [browserChatAssistantParts](../../src/server/ai/agents/browser-chat.service.ts#L1954)?：函数，第?? 1954 ?? 行。
- [browserChatStreamingParts](../../src/server/ai/agents/browser-chat.service.ts#L1972)?：函数，第?? 1972 ?? 行。
- [browserChatLiveResponseMessage](../../src/server/ai/agents/browser-chat.service.ts#L1978)?：函数，第?? 1978 ?? 行。
- [publishBrowserChatUIStreamUpdate](../../src/server/ai/agents/browser-chat.service.ts#L1987)?：函数，第?? 1987 ?? 行。
- [subscribeBrowserChatUIStream](../../src/server/ai/agents/browser-chat.service.ts#L2010)?：函数，第?? 2010 ?? 行。
- [summarySnapshot](../../src/server/ai/agents/browser-chat.service.ts#L2063)?：函数，第?? 2063 ?? 行。
- [isTransientBrowserChatProgress](../../src/server/ai/agents/browser-chat.service.ts#L2076)?：函数，第?? 2076 ?? 行。
- [parseLogDetails](../../src/server/ai/agents/browser-chat.service.ts#L2082)?：函数，第?? 2082 ?? 行。
- [runtimeResponseTextFromLog](../../src/server/ai/agents/browser-chat.service.ts#L2091)?：函数，第?? 2091 ?? 行。
- [recoverAssistantMessageFromLogs](../../src/server/ai/agents/browser-chat.service.ts#L2105)?：函数，第?? 2105 ?? 行。
- [hasRunningAssistantMessage](../../src/server/ai/agents/browser-chat.service.ts#L2123)?：函数，第?? 2123 ?? 行。
- [assistantMessageMatchesClientTurn](../../src/server/ai/agents/browser-chat.service.ts#L2131)?：函数，第?? 2131 ?? 行。
- [runningAssistantMessageIdsForClientTurn](../../src/server/ai/agents/browser-chat.service.ts#L2141)?：函数，第?? 2141 ?? 行。
- [recoveredStatusForStaleAssistantMessage](../../src/server/ai/agents/browser-chat.service.ts#L2154)?：函数，第?? 2154 ?? 行。
- [browserChatAcceptedFinalResponse](../../src/server/ai/agents/browser-chat.service.ts#L2170)?：函数，第?? 2170 ?? 行。
- [finalizeIdleRunningAssistantMessages](../../src/server/ai/agents/browser-chat.service.ts#L2190)?：函数，第?? 2190 ?? 行。
- [markRecoveredRunningRecordsDirty](../../src/server/ai/agents/browser-chat.service.ts#L2215)?：函数，第?? 2215 ?? 行。
- [markAssistantMessageInterrupted](../../src/server/ai/agents/browser-chat.service.ts#L2234)?：函数，第?? 2234 ?? 行。
- [preserveInterruptedModelContext](../../src/server/ai/agents/browser-chat.service.ts#L2245)?：函数，第?? 2245 ?? 行。
- [preserveInterruptedTurn](../../src/server/ai/agents/browser-chat.service.ts#L2265)?：函数，第?? 2265 ?? 行。
- [shouldPreserveRuntimeTurn](../../src/server/ai/agents/browser-chat.service.ts#L2298)?：函数，第?? 2298 ?? 行。
- [browserChatRecoveredSubagentRecord](../../src/server/ai/agents/browser-chat.service.ts#L2314)?：函数，第?? 2314 ?? 行。
- [recordFromSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L2339)?：函数，第?? 2339 ?? 行。
- [appendLog](../../src/server/ai/agents/browser-chat.service.ts#L2475)?：函数，第?? 2475 ?? 行。
- [readSessionSummaries](../../src/server/ai/agents/browser-chat.service.ts#L2544)?：函数，第?? 2544 ?? 行。
- [isBrowserChatSessionSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L2554)?：函数，第?? 2554 ?? 行。
- [readSessionSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L2561)?：函数，第?? 2561 ?? 行。
- [readRuntimeSessionSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L2573)?：函数，第?? 2573 ?? 行。
- [persistenceDelta](../../src/server/ai/agents/browser-chat.service.ts#L2590)?：函数，第?? 2590 ?? 行。
- [advancePersistenceCursor](../../src/server/ai/agents/browser-chat.service.ts#L2598)?：函数，第?? 2598 ?? 行。
- [seedPersistenceCursor](../../src/server/ai/agents/browser-chat.service.ts#L2607)?：函数，第?? 2607 ?? 行。
- [trackSessionDatabaseWrite](../../src/server/ai/agents/browser-chat.service.ts#L2614)?：函数，第?? 2614 ?? 行。
- [writeSessionSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L2634)?：函数，第?? 2634 ?? 行。
- [publishBrowserChatTextStreamSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L2704)?：函数，第?? 2704 ?? 行。
- [browserChatTextStreamPublisher](../../src/server/ai/agents/browser-chat.service.ts#L2736)?：函数，第?? 2736 ?? 行。
- [scheduleBrowserChatTextStreamPublish](../../src/server/ai/agents/browser-chat.service.ts#L2743)?：函数，第?? 2743 ?? 行。
- [deleteSessionSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L2747)?：函数，第?? 2747 ?? 行。
- [timestampValue](../../src/server/ai/agents/browser-chat.service.ts#L2762)?：函数，第?? 2762 ?? 行。
- [messageTimestamp](../../src/server/ai/agents/browser-chat.service.ts#L2767)?：函数，第?? 2767 ?? 行。
- [hasMessageContent](../../src/server/ai/agents/browser-chat.service.ts#L2771)?：函数，第?? 2771 ?? 行。
- [shouldPreferIncomingMessage](../../src/server/ai/agents/browser-chat.service.ts#L2775)?：函数，第?? 2775 ?? 行。
- [mergeSortedNumbers](../../src/server/ai/agents/browser-chat.service.ts#L2791)?：函数，第?? 2791 ?? 行。
- [mergeStringLists](../../src/server/ai/agents/browser-chat.service.ts#L2795)?：函数，第?? 2795 ?? 行。
- [mergePersistedMessages](../../src/server/ai/agents/browser-chat.service.ts#L2799)?：函数，第?? 2799 ?? 行。
- [stepCompletenessScore](../../src/server/ai/agents/browser-chat.service.ts#L2820)?：函数，第?? 2820 ?? 行。
- [toolCompletenessScore](../../src/server/ai/agents/browser-chat.service.ts#L2832)?：函数，第?? 2832 ?? 行。
- [toolMergeKey](../../src/server/ai/agents/browser-chat.service.ts#L2841)?：函数，第?? 2841 ?? 行。
- [browserChatSubagentToolVersion](../../src/server/ai/agents/browser-chat.service.ts#L2845)?：函数，第?? 2845 ?? 行。
- [mergePersistedTools](../../src/server/ai/agents/browser-chat.service.ts#L2858)?：函数，第?? 2858 ?? 行。
- [mergePersistedStep](../../src/server/ai/agents/browser-chat.service.ts#L2899)?：函数，第?? 2899 ?? 行。
- [mergePersistedSteps](../../src/server/ai/agents/browser-chat.service.ts#L2917)?：函数，第?? 2917 ?? 行。
- [mergePersistedLogs](../../src/server/ai/agents/browser-chat.service.ts#L2927)?：函数，第?? 2927 ?? 行。
- [mergePersistedOutputCycles](../../src/server/ai/agents/browser-chat.service.ts#L2937)?：函数，第?? 2937 ?? 行。
- [mergePersistedSubagents](../../src/server/ai/agents/browser-chat.service.ts#L2952)?：函数，第?? 2952 ?? 行。
- [mergePersistedSessionSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L2986)?：函数，第?? 2986 ?? 行。
- [mergeRuntimeSessionState](../../src/server/ai/agents/browser-chat.service.ts#L3013)?：函数，第?? 3013 ?? 行。
- [applyPersistedSnapshotToRuntime](../../src/server/ai/agents/browser-chat.service.ts#L3035)?：函数，第?? 3035 ?? 行。
- [restoreCompactedBrowserChatSession](../../src/server/ai/agents/browser-chat.service.ts#L3060)?：函数，第?? 3060 ?? 行。
- [hydrateSession](../../src/server/ai/agents/browser-chat.service.ts#L3082)?：函数，第?? 3082 ?? 行。
- [persistSession](../../src/server/ai/agents/browser-chat.service.ts#L3105)?：函数，第?? 3105 ?? 行。
- [clearPendingPersist](../../src/server/ai/agents/browser-chat.service.ts#L3144)?：函数，第?? 3144 ?? 行。
- [schedulePersistAndNotify](../../src/server/ai/agents/browser-chat.service.ts#L3151)?：函数，第?? 3151 ?? 行。
- [persistInterruptedSessionInBackground](../../src/server/ai/agents/browser-chat.service.ts#L3160)?：函数，第?? 3160 ?? 行。
- [persistAndNotify](../../src/server/ai/agents/browser-chat.service.ts#L3171)?：函数，第?? 3171 ?? 行。
- [persistAndNotifyTerminal](../../src/server/ai/agents/browser-chat.service.ts#L3190)?：函数，第?? 3190 ?? 行。
- [publishPersistedRealtimePatch](../../src/server/ai/agents/browser-chat.service.ts#L3203)?：函数，第?? 3203 ?? 行。
- [persistBrowserChatCheckpoint](../../src/server/ai/agents/browser-chat.service.ts#L3219)?：函数，第?? 3219 ?? 行。
- [persistDeletedSessions](../../src/server/ai/agents/browser-chat.service.ts#L3233)?：函数，第?? 3233 ?? 行。
- [isDeadBrowserSessionError](../../src/server/ai/agents/browser-chat.service.ts#L3245)?：函数，第?? 3245 ?? 行。
- [ensureStarted](../../src/server/ai/agents/browser-chat.service.ts#L3256)?：函数，第?? 3256 ?? 行。
- [createBrowserChatBrowser](../../src/server/ai/agents/browser-chat.service.ts#L3278)?：函数，第?? 3278 ?? 行。
- [restoreBrowserSessionPrototype](../../src/server/ai/agents/browser-chat.service.ts#L3292)?：函数，第?? 3292 ?? 行。
- [browserForTurnDecision](../../src/server/ai/agents/browser-chat.service.ts#L3299)?：函数，第?? 3299 ?? 行。
- [ensureStartedNow](../../src/server/ai/agents/browser-chat.service.ts#L3321)?：函数，第?? 3321 ?? 行。
- [createBrowserChatSession](../../src/server/ai/agents/browser-chat.service.ts#L3418)?：函数，第?? 3418 ?? 行。
- [durableBrowserChatSnapshot](../../src/server/ai/agents/browser-chat.service.ts#L3476)?：函数，第?? 3476 ?? 行。
- [selectBrowserChatSessionRuntime](../../src/server/ai/agents/browser-chat.service.ts#L3485)?：函数，第?? 3485 ?? 行。
- [releaseBrowserChatSessionRuntime](../../src/server/ai/agents/browser-chat.service.ts#L3510)?：函数，第?? 3510 ?? 行。
- [getBrowserChatSession](../../src/server/ai/agents/browser-chat.service.ts#L3524)?：函数，第?? 3524 ?? 行。
- [setBrowserChatSessionGroup](../../src/server/ai/agents/browser-chat.service.ts#L3539)?：函数，第?? 3539 ?? 行。
- [updateBrowserChatSessionTitle](../../src/server/ai/agents/browser-chat.service.ts#L3550)?：函数，第?? 3550 ?? 行。
- [updateBrowserChatSessionReasoning](../../src/server/ai/agents/browser-chat.service.ts#L3562)?：函数，第?? 3562 ?? 行。
- [updateBrowserChatSessionTools](../../src/server/ai/agents/browser-chat.service.ts#L3573)?：函数，第?? 3573 ?? 行。
- [listBrowserChatSessions](../../src/server/ai/agents/browser-chat.service.ts#L3584)?：函数，第?? 3584 ?? 行。
- [reportBrowserChatSubagentOwnership](../../src/server/ai/agents/browser-chat.service.ts#L3592)?：函数，第?? 3592 ?? 行。
- [setBrowserChatBlockedSubagent](../../src/server/ai/agents/browser-chat.service.ts#L3599)?：函数，第?? 3599 ?? 行。
- [resetBrowserChatPreviewTarget](../../src/server/ai/agents/browser-chat.service.ts#L3604)?：函数，第?? 3604 ?? 行。
- [clearBrowserChatBlockedSubagent](../../src/server/ai/agents/browser-chat.service.ts#L3609)?：函数，第?? 3609 ?? 行。
- [browserChatPreviewBrowser](../../src/server/ai/agents/browser-chat.service.ts#L3625)?：函数，第?? 3625 ?? 行。
- [selectBrowserChatSubagentPreview](../../src/server/ai/agents/browser-chat.service.ts#L3631)?：函数，第?? 3631 ?? 行。
- [closeBlockedBrowserChatSubagents](../../src/server/ai/agents/browser-chat.service.ts#L3655)?：函数，第?? 3655 ?? 行。
- [stopBrowserChatRuntime](../../src/server/ai/agents/browser-chat.service.ts#L3676)?：函数，第?? 3676 ?? 行。
- [preserveInterruptedSubagents](../../src/server/ai/agents/browser-chat.service.ts#L3725)?：函数，第?? 3725 ?? 行。
- [closeBrowserChatSession](../../src/server/ai/agents/browser-chat.service.ts#L3737)?：函数，第?? 3737 ?? 行。
- [closeBrowserChatRuntimeBrowser](../../src/server/ai/agents/browser-chat.service.ts#L3748)?：函数，第?? 3748 ?? 行。
- [deleteBrowserChatSession](../../src/server/ai/agents/browser-chat.service.ts#L3783)?：函数，第?? 3783 ?? 行。
- [switchBrowserChatTab](../../src/server/ai/agents/browser-chat.service.ts#L3808)?：函数，第?? 3808 ?? 行。
- [startBrowserChatScreencast](../../src/server/ai/agents/browser-chat.service.ts#L3835)?：函数，第?? 3835 ?? 行。
- [dispatchBrowserChatPreviewInput](../../src/server/ai/agents/browser-chat.service.ts#L3898)?：函数，第?? 3898 ?? 行。
- [deleteBrowserChatSessionFromMemory](../../src/server/ai/agents/browser-chat.service.ts#L3963)?：函数，第?? 3963 ?? 行。
- [flowInputRecord](../../src/server/ai/agents/browser-chat.service.ts#L3979)?：函数，第?? 3979 ?? 行。
- [deleteBrowserChatSessions](../../src/server/ai/agents/browser-chat.service.ts#L3985)?：函数，第?? 3985 ?? 行。
- [generateBrowserChatMessagesSkill](../../src/server/ai/agents/browser-chat.service.ts#L4031)?：函数，第?? 4031 ?? 行。
- [nextBrowserChatMessageTimestamp](../../src/server/ai/agents/browser-chat.service.ts#L4108)?：函数，第?? 4108 ?? 行。
- [startNextQueuedBrowserChatTurn](../../src/server/ai/agents/browser-chat.service.ts#L4116)?：函数，第?? 4116 ?? 行。
- [sendBrowserChatMessage](../../src/server/ai/agents/browser-chat.service.ts#L4229)?：函数，第?? 4229 ?? 行。
- [deleteQueuedBrowserChatMessage](../../src/server/ai/agents/browser-chat.service.ts#L4486)?：函数，第?? 4486 ?? 行。
- [latestManualVerificationAssistant](../../src/server/ai/agents/browser-chat.service.ts#L4523)?：函数，第?? 4523 ?? 行。
- [resumeBrowserChatHumanVerification](../../src/server/ai/agents/browser-chat.service.ts#L4541)?：函数，第?? 4541 ?? 行。
- [updateAssistantMessage](../../src/server/ai/agents/browser-chat.service.ts#L4620)?：函数，第?? 4620 ?? 行。
- [upsertBrowserChatOutputCycle](../../src/server/ai/agents/browser-chat.service.ts#L4643)?：函数，第?? 4643 ?? 行。
- [browserChatStreamingOutputCycleId](../../src/server/ai/agents/browser-chat.service.ts#L4679)?：函数，第?? 4679 ?? 行。
- [upsertBrowserChatSubagent](../../src/server/ai/agents/browser-chat.service.ts#L4687)?：函数，第?? 4687 ?? 行。
- [stringifyJsonSafe](../../src/server/ai/agents/browser-chat.service.ts#L4699)?：函数，第?? 4699 ?? 行。
- [warnPersistFailure](../../src/server/ai/agents/browser-chat.service.ts#L4723)?：函数，第?? 4723 ?? 行。
- [runningAssistantActivity](../../src/server/ai/agents/browser-chat.service.ts#L4731)?：函数，第?? 4731 ?? 行。
- [toolNameFromLogMessage](../../src/server/ai/agents/browser-chat.service.ts#L4751)?：函数，第?? 4751 ?? 行。
- [runningActivityFromLog](../../src/server/ai/agents/browser-chat.service.ts#L4755)?：函数，第?? 4755 ?? 行。
- [isActiveBrowserChatTurn](../../src/server/ai/agents/browser-chat.service.ts#L4803)?：函数，第?? 4803 ?? 行。
- [toolConfirmationLog](../../src/server/ai/agents/browser-chat.service.ts#L4818)?：函数，第?? 4818 ?? 行。
- [toolConfirmationInputSignature](../../src/server/ai/agents/browser-chat.service.ts#L4830)?：函数，第?? 4830 ?? 行。
- [browserChatToolConfirmationScope](../../src/server/ai/agents/browser-chat.service.ts#L4847)?：函数，第?? 4847 ?? 行。
- [createBrowserChatTurnToolConfirmation](../../src/server/ai/agents/browser-chat.service.ts#L4881)?：函数，第?? 4881 ?? 行。
- [cancelPendingToolConfirmation](../../src/server/ai/agents/browser-chat.service.ts#L4950)?：函数，第?? 4950 ?? 行。
- [cancelOrphanToolConfirmationsForSession](../../src/server/ai/agents/browser-chat.service.ts#L4962)?：函数，第?? 4962 ?? 行。
- [captureBrowserChatToolConfirmationScreenshot](../../src/server/ai/agents/browser-chat.service.ts#L4969)?：函数，第?? 4969 ?? 行。
- [requestBrowserChatToolConfirmation](../../src/server/ai/agents/browser-chat.service.ts#L4997)?：函数，第?? 4997 ?? 行。
- [resolveBrowserChatToolConfirmation](../../src/server/ai/agents/browser-chat.service.ts#L5113)?：函数，第?? 5113 ?? 行。
- [interruptBrowserChatSession](../../src/server/ai/agents/browser-chat.service.ts#L5145)?：函数，第?? 5145 ?? 行。
- [runBrowserChatSubagents](../../src/server/ai/agents/browser-chat.service.ts#L5248)?：函数，第?? 5248 ?? 行。
- [browserChatSubagentBatchRecords](../../src/server/ai/agents/browser-chat.service.ts#L5367)?：函数，第?? 5367 ?? 行。
- [browserChatVersionedSubagentResult](../../src/server/ai/agents/browser-chat.service.ts#L5373)?：函数，第?? 5373 ?? 行。
- [browserChatUpdatedSubagentRawResult](../../src/server/ai/agents/browser-chat.service.ts#L5382)?：函数，第?? 5382 ?? 行。
- [browserChatSubagentToolResult](../../src/server/ai/agents/browser-chat.service.ts#L5394)?：函数，第?? 5394 ?? 行。
- [browserChatSubagentResultsForTurn](../../src/server/ai/agents/browser-chat.service.ts#L5410)?：函数，第?? 5410 ?? 行。
- [readBrowserChatSubagentResult](../../src/server/ai/agents/browser-chat.service.ts#L5541)?：函数，第?? 5541 ?? 行。
- [browserChatStepWithSubagentResults](../../src/server/ai/agents/browser-chat.service.ts#L5566)?：函数，第?? 5566 ?? 行。
- [publishBrowserChatSubagentBatchResult](../../src/server/ai/agents/browser-chat.service.ts#L5580)?：函数，第?? 5580 ?? 行。
- [clearBrowserChatSubagentBatches](../../src/server/ai/agents/browser-chat.service.ts#L5613)?：函数，第?? 5613 ?? 行。
- [stopBrowserChatSubagentsForReleasedTurn](../../src/server/ai/agents/browser-chat.service.ts#L5619)?：函数，第?? 5619 ?? 行。
- [browserChatSubagentSessionRegistry](../../src/server/ai/agents/browser-chat.service.ts#L5632)?：函数，第?? 5632 ?? 行。
- [updateBrowserChatStoredSubagent](../../src/server/ai/agents/browser-chat.service.ts#L5641)?：函数，第?? 5641 ?? 行。
- [stopBrowserChatSubagent](../../src/server/ai/agents/browser-chat.service.ts#L5703)?：函数，第?? 5703 ?? 行。
- [recordBrowserChatSubagentConfirmation](../../src/server/ai/agents/browser-chat.service.ts#L5779)?：函数，第?? 5779 ?? 行。
- [createBrowserChatSubagentBrowser](../../src/server/ai/agents/browser-chat.service.ts#L5795)?：函数，第?? 5795 ?? 行。
- [browserChatSubagentAuthPrompt](../../src/server/ai/agents/browser-chat.service.ts#L5865)?：函数，第?? 5865 ?? 行。
- [browserChatBranchContextOptions](../../src/server/ai/agents/browser-chat.service.ts#L5870)?：函数，第?? 5870 ?? 行。
- [executeBrowserChatSubagentBatch](../../src/server/ai/agents/browser-chat.service.ts#L5927)?：函数，第?? 5927 ?? 行。
- [resumeBlockedBrowserChatSubagent](../../src/server/ai/agents/browser-chat.service.ts#L6305)?：函数，第?? 6305 ?? 行。
- [runBrowserChatMessage](../../src/server/ai/agents/browser-chat.service.ts#L6570)?：函数，第?? 6570 ?? 行。
- [requestBrowserChatMemoryExtraction](../../src/server/ai/agents/browser-chat.service.ts#L7061)?：函数，第?? 7061 ?? 行。


## 完整输入 JSON Schema

直接由当前 memoryCandidateSchema 与工具 inputSchema 提取。候选写入必须通过正文所述业务验证与独立审核。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "global",
        "domain"
      ]
    },
    "domain": {
      "type": "string",
      "maxLength": 253
    },
    "type": {
      "type": "string",
      "enum": [
        "alias",
        "preference",
        "workflow",
        "domain_fact"
      ]
    },
    "key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "aliases": {
      "default": [],
      "maxItems": 8,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 120
      }
    },
    "value": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "evidence": {
      "maxItems": 8,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 2,
        "maxLength": 500
      }
    },
    "durability": {
      "type": "string",
      "enum": [
        "explicit_preference",
        "explicit_workflow",
        "explicit_alias",
        "explicit_remember",
        "user_correction",
        "verified_procedure"
      ]
    },
    "applicability": {
      "type": "object",
      "properties": {
        "when": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "contextTerms": {
          "maxItems": 8,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 2,
            "maxLength": 120
          }
        }
      },
      "required": [
        "when",
        "contextTerms"
      ],
      "additionalProperties": false
    },
    "utility": {
      "type": "string",
      "minLength": 8,
      "maxLength": 300
    },
    "recall": {
      "default": "relevant",
      "type": "string",
      "enum": [
        "always",
        "relevant"
      ]
    },
    "verification": {
      "default": [],
      "maxItems": 4,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "stepIndex": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "toolIndex": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "quote": {
            "type": "string",
            "minLength": 8,
            "maxLength": 600
          },
          "check": {
            "type": "string",
            "minLength": 8,
            "maxLength": 300
          }
        },
        "required": [
          "stepIndex",
          "toolIndex",
          "quote",
          "check"
        ],
        "additionalProperties": false
      }
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
    },
    "action": {
      "type": "string",
      "enum": [
        "search",
        "save",
        "update",
        "disable"
      ]
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20
    },
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 160
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false
}
```
