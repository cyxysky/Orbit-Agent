# 结构化数据 data：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.data`。公开工具名：`data`。动作覆盖：`sources`、`schema`、`query`。并发边界：structured-data。

## 工具入口

sources 返回配置数据源的 id/name/dialect/readOnly，readOnly 默认 true。schema 要求准确 sourceId，调用 source.schema。query 要求 sourceId/statement，可带参数数组与 maxRows；先判定 SQL 只读，只有 AGENT_DATA_ALLOW_WRITES=true 且 source.readOnly=false 同时成立才允许写入。查询默认 500 行，工具上限 10,000 行。

## SQL 解析和行上限

sql.ts 跳过空白、普通行注释及可嵌套块注释；字符串、双引号/backtick/方括号标识符、PostgreSQL dollar quote 被整体识别，不把其内容当成命令。拒绝未闭合文本、可执行 MySQL 注释和多个 SQL 语句。只读入口包括 SELECT/WITH/EXPLAIN/SHOW/DESCRIBE 与受限只读 PRAGMA，排除写入关键字。PRAGMA 仅允许明确列表且禁止赋值。

SELECT/WITH 被包为子查询并加 LIMIT maxRows+1，从数据库执行阶段限制返回行；多取的一行用于判断 truncated。其他受支持只读命令由驱动控制。纯 SQL 文本分类只是第一层，驱动只读事务/只读文件访问继续执行约束。

## TypeORM 数据源

schema 优先真实数据库 introspection：SQLite 查询 sqlite_master/PRAGMA，PostgreSQL 查询元数据；其他场景可使用 EntityMetadata。默认 Node 有界查询支持 PostgreSQL 和文件 SQLite，其他引擎须提供定制 AgentDataSource。未初始化、内存 SQLite/file URI 和非支持驱动会拒绝执行。

SQLite 在独立受限查询 worker/子进程打开指定数据库，校验参数和只读模式；有限时间、行数、输出及取消管理防止主线程长期阻塞。PostgreSQL 使用 QueryRunner 开事务；禁止写入时 SET TRANSACTION READ ONLY；SET LOCAL statement_timeout 使用配置期限。取消触发独立连接向原 backend 发送 cancel；等取消结束后回滚/释放，防止取消报文命中连接池中下一位使用者。执行成功再提交。

## 结果和资源

提取合法对象行，截取 maxRows，按实际行键汇总 columns，返回 rows、rowCount、truncated、elapsedMs。写入语句的返回表达依赖驱动，不能将 rowCount 当作所有 SQL 的 affectedRows。未知数据源、禁止写入、数据库异常分别报告。源 registry 及 provider 释放自有数据源；宿主配置创建中途失败会释放已经创建的 source。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `AGENT_DATA_MAX_ROWS` | 500 | runtime | 单次查询返回的最大行数。 |
| `AGENT_DATA_ALLOW_WRITES` | false | runtime | 经宿主确认后允许执行非只读语句。 |

权限契约：`data:read`、`data:write`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/data/index.ts](../../packages/capability-sdk/src/data/index.ts)

- [createDataSourceRegistry](../../packages/capability-sdk/src/data/index.ts#L21)?：函数，第?? 21 ?? 行。
- [createDataTool](../../packages/capability-sdk/src/data/index.ts#L29)?：函数，第?? 29 ?? 行。
- [createDataCapability](../../packages/capability-sdk/src/data/index.ts#L33)?：函数，第?? 33 ?? 行。

### [packages/capability-sdk/src/data/sql.ts](../../packages/capability-sdk/src/data/sql.ts)

- [parseSql](../../packages/capability-sdk/src/data/sql.ts#L2)?：函数，第?? 2 ?? 行。
- [sqlTokens](../../packages/capability-sdk/src/data/sql.ts#L37)?：函数，第?? 37 ?? 行。
- [isReadOnlyStatement](../../packages/capability-sdk/src/data/sql.ts#L41)?：函数，第?? 41 ?? 行。
- [boundedReadStatement](../../packages/capability-sdk/src/data/sql.ts#L57)?：函数，第?? 57 ?? 行。

### [packages/capability-sdk/src/data/typeorm.ts](../../packages/capability-sdk/src/data/typeorm.ts)

- [tableFromMetadata](../../packages/capability-sdk/src/data/typeorm.ts#L10)?：函数，第?? 10 ?? 行。
- [quoteSqliteIdentifier](../../packages/capability-sdk/src/data/typeorm.ts#L21)?：函数，第?? 21 ?? 行。
- [introspectSchema](../../packages/capability-sdk/src/data/typeorm.ts#L25)?：函数，第?? 25 ?? 行。
- [createTypeOrmAgentDataSource](../../packages/capability-sdk/src/data/typeorm.ts#L65)?：函数，第?? 65 ?? 行。
- [createTypeOrmDataCapability](../../packages/capability-sdk/src/data/typeorm.ts#L121)?：函数，第?? 121 ?? 行。

### [packages/capability-sdk/src/data/sqlite-query.ts](../../packages/capability-sdk/src/data/sqlite-query.ts)

- [querySqliteFile](../../packages/capability-sdk/src/data/sqlite-query.ts#L29)?：函数，第?? 29 ?? 行。

### [packages/capability-sdk/src/data/postgres-cancel.ts](../../packages/capability-sdk/src/data/postgres-cancel.ts)

- [cancelPostgresQuery](../../packages/capability-sdk/src/data/postgres-cancel.ts#L9)?：函数，第?? 9 ?? 行。

### [src/server/capabilities/agent-infrastructure.ts](../../src/server/capabilities/agent-infrastructure.ts)

- [safeSegment](../../src/server/capabilities/agent-infrastructure.ts#L42)?：函数，第?? 42 ?? 行。
- [createAgentCodeSandboxCapability](../../src/server/capabilities/agent-infrastructure.ts#L47)?：函数，第?? 47 ?? 行。
- [configuredConnectors](../../src/server/capabilities/agent-infrastructure.ts#L65)?：函数，第?? 65 ?? 行。
- [configuredCommunicationChannels](../../src/server/capabilities/agent-infrastructure.ts#L71)?：函数，第?? 71 ?? 行。
- [configuredDataSources](../../src/server/capabilities/agent-infrastructure.ts#L77)?：函数，第?? 77 ?? 行。
- [createConfiguredMediaOperations](../../src/server/capabilities/agent-infrastructure.ts#L90)?：函数，第?? 90 ?? 行。
- [agentMediaToolTimeoutMs](../../src/server/capabilities/agent-infrastructure.ts#L167)?：函数，第?? 167 ?? 行。
- [createAgentInfrastructureProviders](../../src/server/capabilities/agent-infrastructure.ts#L176)?：函数，第?? 176 ?? 行。

### [src/server/integrations/external-integration-drivers.ts](../../src/server/integrations/external-integration-drivers.ts)

- [httpEndpoint](../../src/server/integrations/external-integration-drivers.ts#L95)?：函数，第?? 95 ?? 行。
- [endpointPreview](../../src/server/integrations/external-integration-drivers.ts#L107)?：函数，第?? 107 ?? 行。
- [authenticationConfiguration](../../src/server/integrations/external-integration-drivers.ts#L113)?：函数，第?? 113 ?? 行。
- [authorizationHeader](../../src/server/integrations/external-integration-drivers.ts#L121)?：函数，第?? 121 ?? 行。
- [accessConfiguration](../../src/server/integrations/external-integration-drivers.ts#L127)?：函数，第?? 127 ?? 行。
- [boundedPort](../../src/server/integrations/external-integration-drivers.ts#L133)?：函数，第?? 133 ?? 行。
- [requiredText](../../src/server/integrations/external-integration-drivers.ts#L139)?：函数，第?? 139 ?? 行。
- [resultRecord](../../src/server/integrations/external-integration-drivers.ts#L146)?：函数，第?? 146 ?? 行。
- [decodedOperationResultValues](../../src/server/integrations/external-integration-drivers.ts#L152)?：函数，第?? 152 ?? 行。
- [compactOperationResult](../../src/server/integrations/external-integration-drivers.ts#L171)?：函数，第?? 171 ?? 行。
- [verifyWeComMessageSendResult](../../src/server/integrations/external-integration-drivers.ts#L179)?：函数，第?? 179 ?? 行。
- [assertWeComOperationSucceeded](../../src/server/integrations/external-integration-drivers.ts#L222)?：函数，第?? 222 ?? 行。
- [weComRecentSessions](../../src/server/integrations/external-integration-drivers.ts#L243)?：函数，第?? 243 ?? 行。
- [resolveWeComTargets](../../src/server/integrations/external-integration-drivers.ts#L265)?：函数，第?? 265 ?? 行。
- [weComTargetBinding](../../src/server/integrations/external-integration-drivers.ts#L285)?：函数，第?? 285 ?? 行。
- [verifiedWeComTarget](../../src/server/integrations/external-integration-drivers.ts#L294)?：函数，第?? 294 ?? 行。
- [weComBotTargets](../../src/server/integrations/external-integration-drivers.ts#L305)?：函数，第?? 305 ?? 行。
- [createWeComWebSocketChannel](../../src/server/integrations/external-integration-drivers.ts#L312)?：函数，第?? 312 ?? 行。
- [createWeComAiBotChannel](../../src/server/integrations/external-integration-drivers.ts#L389)?：函数，第?? 389 ?? 行。
- [connectorDriver](../../src/server/integrations/external-integration-drivers.ts#L473)?：函数，第?? 473 ?? 行。
- [sqliteDataDriver](../../src/server/integrations/external-integration-drivers.ts#L525)?：函数，第?? 525 ?? 行。
- [postgresDataDriver](../../src/server/integrations/external-integration-drivers.ts#L599)?：函数，第?? 599 ?? 行。
- [canonicalWebhookDriver](../../src/server/integrations/external-integration-drivers.ts#L694)?：函数，第?? 694 ?? 行。
- [weComAiBotDriver](../../src/server/integrations/external-integration-drivers.ts#L747)?：函数，第?? 747 ?? 行。
- [listExternalIntegrationDrivers](../../src/server/integrations/external-integration-drivers.ts#L855)?：函数，第?? 855 ?? 行。
- [externalIntegrationDriver](../../src/server/integrations/external-integration-drivers.ts#L869)?：函数，第?? 869 ?? 行。
- [resolveExternalIntegrationConfiguration](../../src/server/integrations/external-integration-drivers.ts#L875)?：函数，第?? 875 ?? 行。
- [publicExternalIntegrationSummary](../../src/server/integrations/external-integration-drivers.ts#L902)?：函数，第?? 902 ?? 行。
- [createExternalIntegrationConnector](../../src/server/integrations/external-integration-drivers.ts#L922)?：函数，第?? 922 ?? 行。
- [createExternalCommunicationChannel](../../src/server/integrations/external-integration-drivers.ts#L928)?：函数，第?? 928 ?? 行。
- [createExternalDataSource](../../src/server/integrations/external-integration-drivers.ts#L934)?：函数，第?? 934 ?? 行。
- [testExternalIntegration](../../src/server/integrations/external-integration-drivers.ts#L940)?：函数，第?? 940 ?? 行。

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
        "sources",
        "schema",
        "query"
      ]
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "sourceId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "statement": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100000
    },
    "parameters": {
      "maxItems": 500,
      "type": "array",
      "items": {}
    },
    "maxRows": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```
