# 通信 communication：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.communication`。公开工具名：`communication`。动作覆盖：`channels`、`draft`、`readDraft`、`send`。并发边界：outbound-communication。

## 通道、内容和目标

CommunicationChannel 声明支持的 targetKinds/contentFormats、是否需要明确目标、是否支持附件和媒体。宿主构造 webhook、企业微信或其他自定义通道；渠道凭据来自配置 vault。文本、Markdown、文件/媒体及目标字段先经 schema，再经 channelDraftError 与真实通道能力校验。

| 动作 | 实现逻辑 |
| --- | --- |
| channels | 返回每个通道的 ID、名称、driverId、capabilities，以及通道可提供的 availableTargets |
| draft | 校验 channelId、目标和 content；持久化内容、目标、metadata，返回 draftId；这一步不发送 |
| readDraft | 按准确 draftId 读取内容与发送状态，不访问发送端 |
| send | 读取既有草稿，检查 AGENT_COMMUNICATION_ALLOW_SEND=true 与通道能力；原子 claimDelivery 后才调用通道；保存 sent/failed/unknown 和 receipt |

## 防止重复发送

草稿存储必须实现原子 claimDelivery 与 finishDelivery。已经 sent 且有 receipt 的草稿再次 send 返回原回执；正在发送或 unknown 的草稿返回 delivery-pending，避免未知结果自动重发。通道收到 metadata.idempotencyKey=draftId。明确 CommunicationDeliveryError(outcome=not-sent) 记录 failed 并允许可识别的重试；其他异常记录 unknown，因为远端可能已经收取消息。

SDK 默认提供内存 store；Node 通道使用独立 SQLite 草稿 store，能跨重启保留发送状态。SQLite 事务声明处理原子领取，避免多个 runtime 同发草稿。状态记录失败不能证明远端未发送，因此仍保持不确定处理。

## Webhook 和企业微信

JSON webhook 发送 POST，idempotency-key 为草稿 ID，正文可由宿主 mapBody 适配；取消信号与默认 30 秒超时合并。正文流式读取最多 8,000,000 字节，避免一个发送回执无限占用内存。HTTP 失败抛有限错误；自定义 verifyResponse 可验证业务返回。默认检查 ok/accepted=false 明确拒绝，成功从 id/messageId/x-request-id 提取 deliveryIds 并记录 acceptedAt。

企业微信适配在 wecom.ts 与 wecom-bot.ts 校验目标和消息格式，处理 WebSocket 连接、入站消息/附件、请求相关性和回执；Orbit 外部驱动继续绑定真实通道目标、图像/文件产物读取及企业微信能力。这里的 draft/send 工具与后台入站消息服务、自动回复生命周期分别实现。

## 健康与释放

runtime 汇总各通道健康，任一 unhealthy 时返回 degraded；dispose 并行释放通道和草稿 store 并收集清理错误。发送返回“通道已接受”及真实 receipt，不把它推断成收件人已读。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `AGENT_COMMUNICATION_ALLOW_SEND` | false | runtime | 允许将已确认的草稿发送到配置渠道。 |
| `AGENT_COMMUNICATION_TIMEOUT_MS` | 30000 | runtime | 单次对外发送请求的最长持续时间。 |

权限契约：`communication:draft`、`communication:send`、`network:external`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/integrations/communication/index.ts](../../packages/capability-sdk/src/integrations/communication/index.ts)

- [CommunicationDeliveryError](../../packages/capability-sdk/src/integrations/communication/index.ts#L51)?：类，第?? 51 ?? 行。
- [createMemoryCommunicationDraftStore](../../packages/capability-sdk/src/integrations/communication/index.ts#L116)?：函数，第?? 116 ?? 行。
- [channelDraftError](../../packages/capability-sdk/src/integrations/communication/index.ts#L202)?：函数，第?? 202 ?? 行。
- [createCommunicationTool](../../packages/capability-sdk/src/integrations/communication/index.ts#L224)?：函数，第?? 224 ?? 行。
- [createCommunicationCapability](../../packages/capability-sdk/src/integrations/communication/index.ts#L318)?：函数，第?? 318 ?? 行。

### [packages/capability-sdk/src/integrations/communication/node.ts](../../packages/capability-sdk/src/integrations/communication/node.ts)

- [responseBody](../../packages/capability-sdk/src/integrations/communication/node.ts#L23)?：函数，第?? 23 ?? 行。
- [recordValue](../../packages/capability-sdk/src/integrations/communication/node.ts#L32)?：函数，第?? 32 ?? 行。
- [createJsonWebhookChannel](../../packages/capability-sdk/src/integrations/communication/node.ts#L38)?：函数，第?? 38 ?? 行。
- [connectorResultError](../../packages/capability-sdk/src/integrations/communication/node.ts#L97)?：函数，第?? 97 ?? 行。
- [connectorResultValues](../../packages/capability-sdk/src/integrations/communication/node.ts#L118)?：函数，第?? 118 ?? 行。
- [deliveryIdFromResult](../../packages/capability-sdk/src/integrations/communication/node.ts#L137)?：函数，第?? 137 ?? 行。
- [createConnectorCommunicationChannel](../../packages/capability-sdk/src/integrations/communication/node.ts#L167)?：函数，第?? 167 ?? 行。
- [createFileCommunicationDraftStore](../../packages/capability-sdk/src/integrations/communication/node.ts#L255)?：函数，第?? 255 ?? 行。
- [createNodeCommunicationCapability](../../packages/capability-sdk/src/integrations/communication/node.ts#L295)?：函数，第?? 295 ?? 行。

### [packages/capability-sdk/src/integrations/communication/wecom.ts](../../packages/capability-sdk/src/integrations/communication/wecom.ts)

- [requireByteLimit](../../packages/capability-sdk/src/integrations/communication/wecom.ts#L6)?：函数，第?? 6 ?? 行。
- [validateWeComMessageContent](../../packages/capability-sdk/src/integrations/communication/wecom.ts#L12)?：函数，第?? 12 ?? 行。
- [createWeComMessageArguments](../../packages/capability-sdk/src/integrations/communication/wecom.ts#L35)?：函数，第?? 35 ?? 行。

### [packages/capability-sdk/src/integrations/communication/wecom-bot.ts](../../packages/capability-sdk/src/integrations/communication/wecom-bot.ts)

- [normalizeWeComMessageText](../../packages/capability-sdk/src/integrations/communication/wecom-bot.ts#L25)?：函数，第?? 25 ?? 行。
- [normalizeWeComInboundMessage](../../packages/capability-sdk/src/integrations/communication/wecom-bot.ts#L30)?：函数，第?? 30 ?? 行。
- [createWeComBotConnection](../../packages/capability-sdk/src/integrations/communication/wecom-bot.ts#L60)?：函数，第?? 60 ?? 行。

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
        "channels",
        "draft",
        "readDraft",
        "send"
      ]
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "channelId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "targets": {
      "maxItems": 100,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "user",
              "group",
              "department",
              "email",
              "address"
            ]
          },
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "transport": {
            "description": "Copy the transport from availableTargets when the channel provides one.",
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "required": [
          "kind",
          "id"
        ],
        "additionalProperties": false
      }
    },
    "content": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "format": {
              "type": "string",
              "enum": [
                "text",
                "markdown"
              ]
            },
            "title": {
              "type": "string",
              "maxLength": 1000
            },
            "body": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200000
            }
          },
          "required": [
            "format",
            "body"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "format": {
              "type": "string",
              "enum": [
                "image",
                "file",
                "voice",
                "video"
              ]
            },
            "artifactId": {
              "description": "Artifact ID returned by the file or media tool. The host uploads its bytes only after send approval.",
              "type": "string",
              "minLength": 1,
              "maxLength": 2000
            },
            "mediaId": {
              "description": "An existing media ID returned by this channel provider, never a URL or a fabricated value.",
              "type": "string",
              "minLength": 1,
              "maxLength": 2000
            },
            "title": {
              "type": "string",
              "maxLength": 1000
            },
            "description": {
              "type": "string",
              "maxLength": 4000
            }
          },
          "required": [
            "format"
          ],
          "additionalProperties": false
        }
      ]
    },
    "metadata": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {}
    },
    "draftId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```
