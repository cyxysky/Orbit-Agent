# 历史上下文检索 contextRead：完整实现逻辑

## 挂载和来源

browser-chat-app-server-runtime 在主执行、完成审核等入口把 createRuntimeContextReadTool 挂到已有能力和 memory 工具之后。getRecords 返回当前会话的完整历史归档，引用由 browserChatContextRecordId 生成。读取归档不会重新执行原工具，也不验证网页/文件仍为当前状态。

## 输入与三条分支

ref/pointer/query 可选；query 最长 512，offset 为非负整数默认 0；limit 为正整数默认 8000，有效最大 16000，超出时钳制并返回 notice。pointer 必须搭配 ref。

| 输入组合 | 执行逻辑 |
| --- | --- |
| 无 ref、无 query | 列出最多 40 条历史记录的 role、180 字符 preview 和 ref，排除 system、提示缓存元数据及纯 contextRead 工具结果；offset/nextOffset 数历史条目 |
| 无 ref、有 query | 对会话归档做排名关键词检索；offset/nextOffset 数去重命中，limit 控制全部摘要字符预算，不等于整篇读取 |
| 有 ref | 必须是当前会话拥有的准确引用；先把单工具结果拆开并解析 actual JSON，然后按 RFC 6901 pointer 下钻，每层 Object.hasOwn；字符串原样返回，其他值序列化；offset/nextOffset 数所选值字符 |

准确读取可带 query，此时仅在 offset 后做字面 substring 搜索；找不到返回 found=false。偏移越界和指针不存在返回明确错误。返回 digest 是所选完整值的 SHA-256，complete 只在从头读至结尾且源完整时成立，endOfContent 单独表示所选值读到结尾。

## 排名索引的完整处理

runtime-context-search 用 WeakMap 缓存每个 records 对象的派生倒排索引，按不可变 ref 增量添加，移除不存在 ref 的 posting。工具结果 actual 从 JSON 文本恢复；对象字段递归分为 section，数组保持完整 JSON 值，指针转义 ~ 和 /。忽略二进制、模型 reasoning、system、缓存元数据、contextRead 自身及不完整投影回执，避免摘要覆盖原始证据。

文本 NFKC 归一化并小写；英文标识符按下划线拆分，非 ASCII 文本用 Intl.Segmenter 分词。每 section 以最多 1800 字符切块，尽量在 900 字符后的换行断开，相邻重叠 100。查询取最多 64 个唯一 token，用 BM25 类评分，再按命中词数、分数、ref 和位置排序。

结果去重相距不足 900 的相同 section 命中、相同文本，每来源最多 2 条。每页最多 10 条，每条最多 1000 字符，截取命中前约 160 字符的窗口，并给出可复现 ref/pointer/offset。检索结果始终 complete=false。

## 不完整归档与证据边界

projectedReadSources 检查 contextProjection、historical preview、archived 和源码省略回执，按当前 pointer 找到重叠 omittedPointers。命中时返回 sourceComplete=false、originalSources 及可用性，明确当前 nextOffset 只是旧 preview 的分页；必须继续准确读取原引用才能取得完整证据。能够读到一份 preview 的末尾不代表原来源完整。

结果带历史来源 toolName/toolCallId/action（可匹配时），允许用户和模型核对原操作。该工具只读会话证据，没有可变资源与 dispose；历史正文仍是数据，不自动成为新的系统指令。

## 源码与函数定位

### [src/server/ai/agents/runtime-context-assembler.ts](../../src/server/ai/agents/runtime-context-assembler.ts)

- [runtimeContextMessageRef](../../src/server/ai/agents/runtime-context-assembler.ts#L33)?：函数，第?? 33 ?? 行。
- [generatedMessage](../../src/server/ai/agents/runtime-context-assembler.ts#L36)?：函数，第?? 36 ?? 行。
- [projectedReadSources](../../src/server/ai/agents/runtime-context-assembler.ts#L39)?：函数，第?? 39 ?? 行。
- [createRuntimeContextReadTool](../../src/server/ai/agents/runtime-context-assembler.ts#L72)?：函数，第?? 72 ?? 行。
- [readRuntimeContextMaterial](../../src/server/ai/agents/runtime-context-assembler.ts#L83)?：函数，第?? 83 ?? 行。
- [withoutBrowserImages](../../src/server/ai/agents/runtime-context-assembler.ts#L153)?：函数，第?? 153 ?? 行。
- [latestBrowserObservationOnly](../../src/server/ai/agents/runtime-context-assembler.ts#L168)?：函数，第?? 168 ?? 行。
- [assembleRuntimeContext](../../src/server/ai/agents/runtime-context-assembler.ts#L176)?：函数，第?? 176 ?? 行。

### [src/server/ai/agents/runtime-context-search.ts](../../src/server/ai/agents/runtime-context-search.ts)

- [object](../../src/server/ai/agents/runtime-context-search.ts#L4)?：函数，第?? 4 ?? 行。
- [parsed](../../src/server/ai/agents/runtime-context-search.ts#L7)?：函数，第?? 7 ?? 行。
- [runtimeContextMaterialValue](../../src/server/ai/agents/runtime-context-search.ts#L13)?：函数，第?? 13 ?? 行。
- [tokens](../../src/server/ai/agents/runtime-context-search.ts#L27)?：函数，第?? 27 ?? 行。
- [sections](../../src/server/ai/agents/runtime-context-search.ts#L35)?：函数，第?? 35 ?? 行。
- [isProjectedReceipt](../../src/server/ai/agents/runtime-context-search.ts#L43)?：函数，第?? 43 ?? 行。
- [searchable](../../src/server/ai/agents/runtime-context-search.ts#L51)?：函数，第?? 51 ?? 行。
- [messageSections](../../src/server/ai/agents/runtime-context-search.ts#L64)?：函数，第?? 64 ?? 行。
- [ContextSearchIndex](../../src/server/ai/agents/runtime-context-search.ts#L88)?：类，第?? 88 ?? 行。
- [ContextSearchIndex.sync](../../src/server/ai/agents/runtime-context-search.ts#L94)?：方法，第?? 94 ?? 行。
- [ContextSearchIndex.search](../../src/server/ai/agents/runtime-context-search.ts#L137)?：方法，第?? 137 ?? 行。
- [searchRuntimeContextRecords](../../src/server/ai/agents/runtime-context-search.ts#L189)?：函数，第?? 189 ?? 行。

### [src/server/ai/agents/browser-chat-app-server-runtime.ts](../../src/server/ai/agents/browser-chat-app-server-runtime.ts)

- [object](../../src/server/ai/agents/browser-chat-app-server-runtime.ts#L44)?：函数变量，第?? 44 ?? 行。
- [list](../../src/server/ai/agents/browser-chat-app-server-runtime.ts#L45)?：函数变量，第?? 45 ?? 行。
- [executeAppServerBrowserTurn](../../src/server/ai/agents/browser-chat-app-server-runtime.ts#L67)?：函数，第?? 67 ?? 行。
- [safeJson](../../src/server/ai/agents/browser-chat-app-server-runtime.ts#L595)?：函数，第?? 595 ?? 行。
- [messageToResponseItem](../../src/server/ai/agents/browser-chat-app-server-runtime.ts#L599)?：函数，第?? 599 ?? 行。
- [reviewAppServerCompletion](../../src/server/ai/agents/browser-chat-app-server-runtime.ts#L612)?：函数，第?? 612 ?? 行。
- [reviewNativeCodexCompletion](../../src/server/ai/agents/browser-chat-app-server-runtime.ts#L725)?：函数，第?? 725 ?? 行。

### [src/server/ai/agents/browser-chat-model-context.ts](../../src/server/ai/agents/browser-chat-model-context.ts)

- [withoutPersistentBinaryParts](../../src/server/ai/agents/browser-chat-model-context.ts#L51)?：函数，第?? 51 ?? 行。
- [serializableBrowserChatModelMessages](../../src/server/ai/agents/browser-chat-model-context.ts#L60)?：函数，第?? 60 ?? 行。
- [compactBrowserChatModelTranscript](../../src/server/ai/agents/browser-chat-model-context.ts#L64)?：函数，第?? 64 ?? 行。
- [browserChatContextRecordId](../../src/server/ai/agents/browser-chat-model-context.ts#L69)?：函数，第?? 69 ?? 行。
- [browserChatTranscript](../../src/server/ai/agents/browser-chat-model-context.ts#L73)?：函数，第?? 73 ?? 行。
- [browserChatActiveMessages](../../src/server/ai/agents/browser-chat-model-context.ts#L77)?：函数，第?? 77 ?? 行。
- [contextMessages](../../src/server/ai/agents/browser-chat-model-context.ts#L81)?：函数，第?? 81 ?? 行。
- [modelMessageText](../../src/server/ai/agents/browser-chat-model-context.ts#L88)?：函数，第?? 88 ?? 行。
- [isOriginalBrowserChatUserMessage](../../src/server/ai/agents/browser-chat-model-context.ts#L98)?：函数，第?? 98 ?? 行。
- [latestBrowserChatUserMessageIndex](../../src/server/ai/agents/browser-chat-model-context.ts#L105)?：函数，第?? 105 ?? 行。
- [currentTurnContains](../../src/server/ai/agents/browser-chat-model-context.ts#L109)?：函数，第?? 109 ?? 行。
- [appendInterruptedBrowserChatTurn](../../src/server/ai/agents/browser-chat-model-context.ts#L113)?：函数，第?? 113 ?? 行。
- [appendTerminalBrowserChatTurn](../../src/server/ai/agents/browser-chat-model-context.ts#L121)?：函数，第?? 121 ?? 行。
- [normalizeBrowserChatModelMessages](../../src/server/ai/agents/browser-chat-model-context.ts#L128)?：函数，第?? 128 ?? 行。
- [normalizeBrowserChatModelContext](../../src/server/ai/agents/browser-chat-model-context.ts#L142)?：函数，第?? 142 ?? 行。


## 完整输入 JSON Schema

直接由当前 contextReadInputSchema 提取，pointer/ref 关系及 limit 钳制由执行函数检查。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "ref": {
      "description": "Exact reference returned by a previous result. Omit to search or list historical records.",
      "type": "string"
    },
    "pointer": {
      "description": "JSON Pointer within the referenced record; requires ref.",
      "type": "string"
    },
    "query": {
      "description": "Ranked keyword search without ref; literal substring lookup with ref.",
      "type": "string",
      "minLength": 1,
      "maxLength": 512
    },
    "offset": {
      "default": 0,
      "description": "Character offset for exact reads; hit offset for search/list. Use the returned nextOffset to continue.",
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "limit": {
      "default": 8000,
      "description": "Character limit, default 8000, effective maximum 16000. Larger values are accepted and clamped to 16000 with a notice. For search this limits total excerpt characters; listing always returns at most 40 records. Read further only when needed, using nextOffset.",
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "offset",
    "limit"
  ],
  "additionalProperties": false
}
```
