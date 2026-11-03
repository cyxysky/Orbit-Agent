# 文本编辑 textEditor：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.text-editor`。公开工具名：`textEditor`。动作覆盖：`create`、`list`、`read`、`write`、`edit`、`append`、`delete`、`export`。并发边界：text-editor。

## 对象模型和输入

独立 TextDocument 保存 id/title/format/content/createdAt/updatedAt，format 为 text/markdown/html，create 默认 markdown。documentId 使用 text_ 加 UUID；除 create/list 外必须传准确 ID。write 必须至少改变 content/title/format，append 必须有 content，edit 必须有 replacements。工具不实现章节、创作规划或审核确认流程。

| 动作 | 完整执行逻辑 |
| --- | --- |
| create | 事务中新建 UUID、时间和正文；默认标题“未命名文档”；保存，返回 documentId、saved 与无正文摘要 |
| list | 按 updated_at/id 降序返回摘要和 contentChars |
| read | 读准确文档，可全读或 UTF-16 offset/limit 分页；带 offset 时默认 2000；返回 contentRange/nextOffset |
| write | 事务读取文档，核对可选 expectedContent/Title/Format，再替换给出的字段；没有实际变化不更新时间 |
| edit | 事务按顺序执行精确 oldText/newText 替换；oldText 必须非空、存在且唯一，任何失败整个事务不保存 |
| append | 核对可选旧快照，末尾拼接给定字符串，返回修改后的摘要 |
| delete | 核对旧快照，删 records 以及存在时的相关 edit_proposals；返回 deleted |
| export | 从 store 读取真实保存正文，清理标题文件名，按 md/html/txt 扩展名发布文件和下载链接 |

## Unicode、冲突和原子性

read 拒绝偏移超过文末或落在 UTF-16 surrogate pair 中间。结尾若切开字符则调整到完整字符；一字符小页必要时扩展，保证 nextOffset 前进。complete 只在读取覆盖整篇时 true。局部读取不能用于 write 整文，应用精确 edit 保留未读内容。

数据库 documents.db 通过 BEGIN IMMEDIATE/WAL 持久化。expected* 任一不匹配返回“已在其他位置修改”；UI 与工具共用这份数据。replaceDocumentText 允许删除（空 newText），不允许歧义目标。变更只返回摘要，减少重复正文进入上下文。

## Orbit 迁移和导出

按规范 userId 保存 text-documents/<owner>。首次导入旧 novels 数据时只读旧库，将已有章节合并为 Markdown，把 plan 作为单独创作笔记；确定性 hash UUID 避免重复导入，prose-imported 元信息在事务中落盘，不删除旧数据。生成文件在本轮 text-documents 目录保存，MIME 对应 format。SQLite/store 或替换异常返回 text-editor-operation-failed，dispose 关闭连接。

## 配置与默认值

该 manifest 没有独立配置项；宿主、模型或驱动配置见正文与源码。

权限契约：`text:read`、`text:write`、`artifact:write`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/text-editor/index.ts](../../packages/capability-sdk/src/text-editor/index.ts)

- [createTextEditorCapability](../../packages/capability-sdk/src/text-editor/index.ts#L40)?：函数，第?? 40 ?? 行。

### [packages/capability-sdk/src/text-editor/node.ts](../../packages/capability-sdk/src/text-editor/node.ts)

- [createTextDocumentStore](../../packages/capability-sdk/src/text-editor/node.ts#L8)?：函数，第?? 8 ?? 行。
- [textDocumentSummary](../../packages/capability-sdk/src/text-editor/node.ts#L12)?：函数，第?? 12 ?? 行。
- [replaceDocumentText](../../packages/capability-sdk/src/text-editor/node.ts#L15)?：函数，第?? 15 ?? 行。
- [createFileTextEditorOperations](../../packages/capability-sdk/src/text-editor/node.ts#L26)?：函数，第?? 26 ?? 行。

### [packages/capability-sdk/src/node.ts](../../packages/capability-sdk/src/node.ts)

- [createCapabilityDocumentDatabase](../../packages/capability-sdk/src/node.ts#L9)?：函数，第?? 9 ?? 行。

### [src/server/capabilities/text-storage.ts](../../src/server/capabilities/text-storage.ts)

- [textOwner](../../src/server/capabilities/text-storage.ts#L11)?：函数，第?? 11 ?? 行。
- [textUserDirectory](../../src/server/capabilities/text-storage.ts#L16)?：函数，第?? 16 ?? 行。
- [importedId](../../src/server/capabilities/text-storage.ts#L17)?：函数，第?? 17 ?? 行。
- [importLegacyTextDocuments](../../src/server/capabilities/text-storage.ts#L22)?：函数，第?? 22 ?? 行。
- [createUserTextDocumentStore](../../src/server/capabilities/text-storage.ts#L48)?：函数，第?? 48 ?? 行。

### [src/server/capabilities/text-workspace.ts](../../src/server/capabilities/text-workspace.ts)

- [executeTextWorkspace](../../src/server/capabilities/text-workspace.ts#L23)?：函数，第?? 23 ?? 行。

### [src/server/capabilities/agent-infrastructure.ts](../../src/server/capabilities/agent-infrastructure.ts)

- [safeSegment](../../src/server/capabilities/agent-infrastructure.ts#L42)?：函数，第?? 42 ?? 行。
- [createAgentCodeSandboxCapability](../../src/server/capabilities/agent-infrastructure.ts#L47)?：函数，第?? 47 ?? 行。
- [configuredConnectors](../../src/server/capabilities/agent-infrastructure.ts#L65)?：函数，第?? 65 ?? 行。
- [configuredCommunicationChannels](../../src/server/capabilities/agent-infrastructure.ts#L71)?：函数，第?? 71 ?? 行。
- [configuredDataSources](../../src/server/capabilities/agent-infrastructure.ts#L77)?：函数，第?? 77 ?? 行。
- [createConfiguredMediaOperations](../../src/server/capabilities/agent-infrastructure.ts#L90)?：函数，第?? 90 ?? 行。
- [agentMediaToolTimeoutMs](../../src/server/capabilities/agent-infrastructure.ts#L167)?：函数，第?? 167 ?? 行。
- [createAgentInfrastructureProviders](../../src/server/capabilities/agent-infrastructure.ts#L176)?：函数，第?? 176 ?? 行。

## 完整输入 JSON Schema

以下内容直接来自当前源码导出，并不是手写参数示例。运行时的跨字段校验不由 JSON Schema 完全表达，仍以正文和 input.parse 为准。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "create",
        "list",
        "read",
        "write",
        "edit",
        "append",
        "delete",
        "export"
      ]
    },
    "reason": {
      "type": "string"
    },
    "documentId": {
      "description": "Exact documentId returned by create/list. Required for every existing-document action.",
      "type": "string",
      "pattern": "^text_[a-f0-9-]{36}$"
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 240
    },
    "format": {
      "description": "text, markdown or html; defaults to markdown for new documents.",
      "type": "string",
      "enum": [
        "text",
        "markdown",
        "html"
      ]
    },
    "content": {
      "description": "Source text for create/write, or the exact text to append. Empty content is valid. write replaces the complete source; use edit for local changes.",
      "type": "string"
    },
    "edits": {
      "description": "For edit: exact, unique oldText/newText replacements, applied atomically in order. Empty newText deletes the matched text.",
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "oldText": {
            "type": "string",
            "minLength": 1
          },
          "newText": {
            "type": "string"
          }
        },
        "required": [
          "oldText",
          "newText"
        ]
      }
    },
    "offset": {
      "description": "For read: UTF-16 source offset. Follow contentRange.nextOffset for the next page.",
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "limit": {
      "description": "For read: page length. Defaults to 2000 when offset is present; omit offset and limit for full content.",
      "type": "integer",
      "minimum": 1,
      "maximum": 8000
    },
    "expectedContent": {
      "description": "Optional exact source snapshot to prevent overwriting a document edited since it was read.",
      "type": "string"
    },
    "expectedTitle": {
      "type": "string"
    },
    "expectedFormat": {
      "type": "string",
      "enum": [
        "text",
        "markdown",
        "html"
      ]
    }
  },
  "required": [
    "action"
  ]
}
```
