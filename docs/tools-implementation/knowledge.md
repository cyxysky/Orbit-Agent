# 知识库 knowledge：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.knowledge`。公开工具名：`knowledge`。动作覆盖：`ingest`、`search`、`get`、`list`、`delete`。并发边界：serial / knowledge-store。

## 动作处理

| 动作 | 实现逻辑 |
| --- | --- |
| ingest | 要求 title/content，可带 documentId/source/metadata；put 保存参考文档并更新已经建立的块索引；返回元数据和 contentChars |
| search | 要求 query；按 limit 和配置 chunkChars 建立/查询全文块索引，返回 documentId/title/source/chunkIndex/text/score |
| get | 精确读取 documentId，返回整份参考正文；不存在返回 knowledge-document-not-found |
| list | 按更新时刻和 ID 降序分页，只返回元数据和 contentChars |
| delete | 同一事务删除文档及对应知识块；不存在保持明确错误 |

## 数据库和索引

knowledge.db 使用独立 records/store_meta 表以及 FTS5 knowledge_chunks、knowledge_sizes。旧 knowledge.json 仅首次导入；SQLite WAL、busy_timeout 和 BEGIN IMMEDIATE 保证本地事务。默认 ID 来自 source + 空字符 + title 的 SHA-256 前 20 位，同一来源标题重复 ingest 更新同一文档，保留 createdAt。

tokens 将字符转小写，提取字母/数字/下划线/连字符；英文保留长度大于 1 的词，含汉字的词展开为相邻双字 token，单汉字保留。chunkChars 限制 400–8000，块间重叠不超过 120 字符且不超过块长十分之一。

搜索最多使用前 100 个去重 token，用带引号 OR 表达式避免原查询被当作 FTS 语法。每次不同块长配置会清空旧块索引并从持久文档重建，防止多配置持续累积索引；以后 put 同步当前尺寸索引。按 bm25、文档和块序排序，分数映射为 1/(1+exp(rank))。这是一套本地全文搜索，不是 embedding 向量检索。

## 宿主和错误

Orbit 按用户保存 agent-infrastructure/knowledge 的独立 store。limit 默认取配置（search 默认 8；list 默认 50），offset 用于目录分页。参考资料与个人偏好 memory 分开存储；保存知识不会自动变成全局行为指令。存储/索引异常返回 knowledge-operation-failed；health 通过初始化索引检查数据库，dispose 关闭连接。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `AGENT_KNOWLEDGE_CHUNK_CHARS` | 1800 | runtime | 每个索引分块的大致字符数。 |
| `AGENT_KNOWLEDGE_SEARCH_LIMIT` | 8 | runtime | 单次搜索返回的最大分块数。 |

权限契约：`knowledge:read`、`knowledge:write`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/knowledge/index.ts](../../packages/capability-sdk/src/knowledge/index.ts)

- [createKnowledgeTool](../../packages/capability-sdk/src/knowledge/index.ts#L37)?：函数，第?? 37 ?? 行。
- [createKnowledgeCapability](../../packages/capability-sdk/src/knowledge/index.ts#L52)?：函数，第?? 52 ?? 行。

### [packages/capability-sdk/src/knowledge/node.ts](../../packages/capability-sdk/src/knowledge/node.ts)

- [tokens](../../packages/capability-sdk/src/knowledge/node.ts#L8)?：函数，第?? 8 ?? 行。
- [createFileKnowledgeStore](../../packages/capability-sdk/src/knowledge/node.ts#L17)?：函数，第?? 17 ?? 行。
- [createNodeKnowledgeCapability](../../packages/capability-sdk/src/knowledge/node.ts#L105)?：函数，第?? 105 ?? 行。

### [packages/capability-sdk/src/node.ts](../../packages/capability-sdk/src/node.ts)

- [createCapabilityDocumentDatabase](../../packages/capability-sdk/src/node.ts#L9)?：函数，第?? 9 ?? 行。

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
        "ingest",
        "search",
        "get",
        "list",
        "delete"
      ]
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "documentId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "source": {
      "type": "string",
      "maxLength": 8000
    },
    "content": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000000
    },
    "metadata": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1000000
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```
