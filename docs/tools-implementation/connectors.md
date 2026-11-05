# 外部连接器 connectors：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.connectors`。公开工具名：`connectors`。动作覆盖：`list`、`describe`、`call`。并发边界：parallel / external-connectors。

## 注册和三种动作

宿主从外部集成配置/凭据 vault 构造 AgentConnector，再用 createConnectorRegistry 按 id 注册。工具 list 只返回连接器 id、name、kind；describe 要求 connectorId 并读取其操作目录；call 要求 connectorId、operationId，先读取目录确认准确操作存在，再把 arguments 对象交给 connector.call。

返回数据受 AGENT_CONNECTOR_MAX_RESULT_CHARS 限制，超过上限用截断表达而不是把任意远端正文放进上下文。MCP 返回 isError=true 时提取 text 内容并返回 connector-operation-failed，不把 HTTP 成功误判为工具成功。未知连接器/操作和传输失败有不同错误代码。

## MCP Streamable HTTP

首次调用共享 initialization Promise：发送 initialize，协商 protocolVersion，记录 mcp-session-id，再发 notifications/initialized。请求用 JSON-RPC UUID，对应回复 ID 必须匹配。支持普通 JSON 与 SSE；SSE 按事件边界累积 data 行、忽略非本请求回应，处理 tools/list_changed 并取消流/释放 reader。响应累计上限 8 MB。

tools/list 支持 nextCursor 分页，拒绝重复 cursor、超过 100 分页或超过 10,000 操作。目录缓存 60 秒，进行中的目录读取用同一 Promise 合并；通知清空缓存。tools/call 使用准确 name 与 arguments。HTTP 404 清空 session/初始化/缓存，让下一次调用重新建立会话；429/5xx 标记可重试，调用本身不静默重发有副作用的操作。

dispose 先取消 lifetime，再以短截止时间 DELETE 会话；404/405 视为已经结束/服务不支持会话删除，其余异常报告清理失败。配置的 headers 和会话 headers 只用于该连接器地址。

## MCP 工具设置（2026-11-05）

入口：设置 → 工具能力 → MCP → 已保存服务旁的「工具设置」。管理接口仅允许管理员访问，并遵守管理员设置密码校验。

- **工具参数默认值**：从 `tools/list` 的 `inputSchema.properties` 生成字段，按工具名保存到 Orbit 的加密集成 vault；调用时按顶层键合并 `{ ...defaults, ...modelArguments }`。模型显式传入的值优先，嵌套对象整体替换。每次调用重新读取默认值，已有连接器也能使用新值。此配置不修改远端服务的环境变量或全局状态。
- **服务配置**：服务需要显式声明下述可选协议。普通 MCP 标准没有通用的 `/settings` 远端配置接口；没有声明的服务会显示「此服务未声明配置接口」。
- 字段支持布尔值、数字、枚举、文本、JSON；复杂结构由 JSON 编辑。`writeOnly: true` 或 `format: "password"` 为密钥字段；包含此类子字段的整个顶层字段作为密钥处理。密钥不回传，留空保留，显式清除并保存才删除。
- 配置表单最多 64 个顶层字段、8 层 JSON。工具默认值合计最多 20,000 字符。客户端做有界结构校验，完整 JSON Schema 语义与业务校验由 MCP 服务负责；不会执行远端正则或解析外部 `$ref`。
- 列表每页 20 项并支持搜索。保存携带读取时的 revision；冲突后重新读取。远端写操作不会自动重试，连接中断时应重新读取确认结果。

### 可选服务配置协议

使用标准 `tools/list` / `tools/call`，在管理工具的 `_meta` 中声明 Orbit 命名空间；这不是 MCP 的通用配置标准：

```json
{
  "name": "service_settings",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["get", "set"] },
      "values": { "type": "object" },
      "clearKeys": { "type": "array", "items": { "type": "string" } },
      "expectedRevision": { "type": "string" }
    },
    "required": ["action"]
  },
  "_meta": {
    "com.webpilot/configuration": {
      "version": 1,
      "title": "服务设置",
      "writable": true,
      "schema": {
        "type": "object",
        "properties": {
          "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
          "apiKey": { "type": "string", "writeOnly": true }
        }
      }
    }
  }
}
```

读取参数为 `{ "action": "get" }`；修改参数为 `{ "action": "set", "values": { "limit": 10 }, "clearKeys": [], "expectedRevision": "7" }`。两者都返回 `structuredContent: { values, configuredSecrets, revision }`，也可用一个文本块承载相同 JSON。`values` 中不含密钥，`configuredSecrets` 只包含已设置密钥的字段名。revision 必须是不包含敏感值的版本标识。管理工具不会出现在 Orbit 的模型工具目录，也不能通过普通 connector.call 调用；服务端仍必须独立校验读写权限。

Capability SDK 服务可以使用 `@cjfclonedeep/capability-sdk/integrations/connectors/configuration-mcp` 导出的 `registerMcpConfigurationTool(server, host)`。宿主提供 `name/title/schema/authorize/read`，可写时再提供 `write(values, expectedRevision, context)`。`read` 返回包含真实密钥的内部快照与 revision，SDK 在返回前脱敏。`write` 必须持久化配置、原子比较 revision，并应用配置到实际运行时；省略 `write` 即只读。SDK 会串行化同一注册实例的操作、保留未修改字段并在写入后读回，跨请求实例/进程的并发控制仍由持久层负责。不会隐式改写其他 MCP 工具的配置或重启服务。

相关入口：`src/server/settings/integration-tool-settings.ts`、`src/backend/routes/settings/integrations/configuration/route.ts`、`src/components/McpToolSettings.tsx`。

## OpenAPI

遍历 paths 的合法 HTTP method 建立 operationId 映射，没有 operationId 时由 method/path 派生。describe 返回 summary、description、readOnly 和 arguments 对象入口。call 用 args.path 替换路径变量并编码，args.query 支持数组重复键，args.body 对非 GET/HEAD 序列化为 JSON；拼接配置 baseUrl/servers，组合调用取消与 30 秒默认截止时间。

响应最多 8 MB，尝试解析 JSON，非 JSON 保留文本。非 2xx 抛出带有限正文的错误，成功返回 status、headers、body。当前 OpenAPI 入口公布的是通用 arguments，而不是完整推导每个参数 schema；业务字段约束由真实服务执行。SDK 也支持宿主注入 custom connector，操作目录和调用逻辑可替换。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `AGENT_CONNECTOR_TIMEOUT_MS` | 30000 | runtime | 外部操作的最长持续时间（毫秒）。 |
| `AGENT_CONNECTOR_MAX_RESULT_CHARS` | 50000 | runtime | 返回给模型的序列化结果最大字符数。 |

权限契约：`network:external`、`secrets:reference`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/integrations/connectors/index.ts](../../packages/capability-sdk/src/integrations/connectors/index.ts)

- [createConnectorRegistry](../../packages/capability-sdk/src/integrations/connectors/index.ts#L26)?：函数，第?? 26 ?? 行。
- [boundedResult](../../packages/capability-sdk/src/integrations/connectors/index.ts#L51)?：函数，第?? 51 ?? 行。
- [createConnectorsTool](../../packages/capability-sdk/src/integrations/connectors/index.ts#L56)?：函数，第?? 56 ?? 行。
- [createConnectorsCapability](../../packages/capability-sdk/src/integrations/connectors/index.ts#L83)?：函数，第?? 83 ?? 行。

### [packages/capability-sdk/src/integrations/connectors/node.ts](../../packages/capability-sdk/src/integrations/connectors/node.ts)

- [rpcResponse](../../packages/capability-sdk/src/integrations/connectors/node.ts#L10)?：函数，第?? 10 ?? 行。
- [createMcpStreamableHttpConnector](../../packages/capability-sdk/src/integrations/connectors/node.ts#L48)?：函数，第?? 48 ?? 行。
- [createOpenApiConnector](../../packages/capability-sdk/src/integrations/connectors/node.ts#L121)?：函数，第?? 121 ?? 行。
- [createNodeConnectorsCapability](../../packages/capability-sdk/src/integrations/connectors/node.ts#L151)?：函数，第?? 151 ?? 行。

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

### [src/server/integrations/external-integration-vault.ts](../../src/server/integrations/external-integration-vault.ts)

- [integrationAad](../../src/server/integrations/external-integration-vault.ts#L53)?：函数，第?? 53 ?? 行。
- [normalizedConfiguration](../../src/server/integrations/external-integration-vault.ts#L57)?：函数，第?? 57 ?? 行。
- [encryptConfiguration](../../src/server/integrations/external-integration-vault.ts#L73)?：函数，第?? 73 ?? 行。
- [decryptConfiguration](../../src/server/integrations/external-integration-vault.ts#L77)?：函数，第?? 77 ?? 行。
- [readStore](../../src/server/integrations/external-integration-vault.ts#L94)?：函数，第?? 94 ?? 行。
- [mutateStore](../../src/server/integrations/external-integration-vault.ts#L104)?：函数，第?? 104 ?? 行。
- [resolveStored](../../src/server/integrations/external-integration-vault.ts#L115)?：函数，第?? 115 ?? 行。
- [listExternalIntegrations](../../src/server/integrations/external-integration-vault.ts#L127)?：函数，第?? 127 ?? 行。
- [resolveExternalIntegrations](../../src/server/integrations/external-integration-vault.ts#L135)?：函数，第?? 135 ?? 行。
- [resolveExternalIntegration](../../src/server/integrations/external-integration-vault.ts#L142)?：函数，第?? 142 ?? 行。
- [upsertExternalIntegration](../../src/server/integrations/external-integration-vault.ts#L147)?：函数，第?? 147 ?? 行。
- [deleteExternalIntegration](../../src/server/integrations/external-integration-vault.ts#L179)?：函数，第?? 179 ?? 行。

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
        "list",
        "describe",
        "call"
      ]
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "connectorId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "operationId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "arguments": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```
