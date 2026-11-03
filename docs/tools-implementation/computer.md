# 电脑操作 computer：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.computer`。公开工具名：`computer`。动作覆盖：`observe`、`launch`、`click`、`type`、`key`、`scroll`、`wait`。并发边界：computer-session。

## 工具与驱动

AGENT_COMPUTER_ENABLED=true 才执行。ComputerDriver 可由宿主注入或使用 HTTP driver；Node 在受支持 Windows 环境可启动带随机 Bearer 授权的回环驱动服务，启动使用共享 Promise/引用计数。内置服务仅接受认证 HEAD/POST，请求体上限 256 KiB，串行等待队列最多 32 项。外部驱动使用配置 endpoint 和 authorization。

| 动作 | 完整处理逻辑 |
| --- | --- |
| observe | 调用驱动截图与读取可操作元素，校验宽高/元素坐标，保存截图产物和最新观察缓存，返回截图左上角为原点的像素坐标空间 |
| launch | 根据已验证应用/路径参数请求驱动启动，然后依返回截图更新观察状态 |
| click | 要求上次成功截图；elementId 必须属于该截图，或使用非负 x/y；从元素 center 推导像素并检查不越界；驱动实际收到坐标而不是猜测 elementId |
| type | 将明确文本交给驱动输入，不在工具端执行 shell |
| key | 执行合法按键/组合键，由驱动映射到平台按键 |
| scroll | 使用 deltaX/deltaY 指定水平与垂直滚动量，后续 observe 确认结果 |
| wait | 等待指定毫秒，受调用取消/驱动超时约束 |

## 观察证据一致性

工具保存 latestObservation 的截图尺寸与可观察元素映射。点击返回 executedPoint：像素、来源为 element/coordinates、对应元素和参考截图宽高。动作执行前清空旧观察缓存；只有本次 driver 返回真实 artifactId 与有效宽高时才建立新缓存。失败 observe、空截图或执行期间失败不会保留可用旧坐标，下一次 click 必须先 observe。这避免部分输入已发生却继续基于旧画面操作。

## Windows 驱动和截图

内置驱动以 Base64 JSON 把动作传给 PowerShell -STA -File，参数不作为拼接 shell 命令执行。observe 在受管理临时路径生成 PNG，最多 32 MiB，通过 HTTP 转为截图传输；Node 解析结果并发布到配置 screenshotDirectory。Windows 锁屏/安全桌面捕获失败返回明确不可截图错误。具体 UI Automation 元素、应用启动、键盘鼠标操作由 windows-computer-driver.ps1 实现。

## 取消与释放

HTTP 连接关闭或请求中断会取消当前动作；运行子进程有驱动期限加 5 秒和 2 MiB 输出限制。失败清理临时截图；共享服务最后一个使用者释放时关闭服务。tool success 只说明输入动作完成，click 的目标结果仍须观察；健康检查与桌面解锁状态是不同检查。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `AGENT_COMPUTER_ENABLED` | false | runtime | 启用桌面观察与控制；Windows 会自动启动内置驱动。 |
| `AGENT_COMPUTER_TIMEOUT_MS` | 30000 | runtime | 单次桌面操作的最长时间。 |
| `AGENT_COMPUTER_ENDPOINT` | 空 | startup | 留空时由能力包自动启动内置 Windows 驱动；仅外部驱动部署需要覆盖。 |
| `AGENT_COMPUTER_AUTHORIZATION` | 空 | startup | 内置驱动自动生成进程内授权；仅外部驱动部署需要覆盖。 |

权限契约：`computer:observe`、`computer:input`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/computer/index.ts](../../packages/capability-sdk/src/computer/index.ts)

- [positiveDimension](../../packages/capability-sdk/src/computer/index.ts#L156)?：函数，第?? 156 ?? 行。
- [finiteInteger](../../packages/capability-sdk/src/computer/index.ts#L162)?：函数，第?? 162 ?? 行。
- [normalizeComputerElements](../../packages/capability-sdk/src/computer/index.ts#L166)?：函数，第?? 166 ?? 行。
- [createComputerTool](../../packages/capability-sdk/src/computer/index.ts#L209)?：函数，第?? 209 ?? 行。
- [createComputerCapability](../../packages/capability-sdk/src/computer/index.ts#L341)?：函数，第?? 341 ?? 行。

### [packages/capability-sdk/src/computer/node.ts](../../packages/capability-sdk/src/computer/node.ts)

- [optionalAuthorization](../../packages/capability-sdk/src/computer/node.ts#L36)?：函数，第?? 36 ?? 行。
- [record](../../packages/capability-sdk/src/computer/node.ts#L41)?：函数，第?? 41 ?? 行。
- [safeSegment](../../packages/capability-sdk/src/computer/node.ts#L47)?：函数，第?? 47 ?? 行。
- [disabledDriver](../../packages/capability-sdk/src/computer/node.ts#L52)?：函数，第?? 52 ?? 行。
- [json](../../packages/capability-sdk/src/computer/node.ts#L59)?：函数，第?? 59 ?? 行。
- [readJsonRequest](../../packages/capability-sdk/src/computer/node.ts#L69)?：函数，第?? 69 ?? 行。
- [windowsPowerShellPath](../../packages/capability-sdk/src/computer/node.ts#L97)?：函数，第?? 97 ?? 行。
- [windowsDriverScriptPath](../../packages/capability-sdk/src/computer/node.ts#L102)?：函数，第?? 102 ?? 行。
- [executeWindowsAction](../../packages/capability-sdk/src/computer/node.ts#L117)?：函数，第?? 117 ?? 行。
- [startBuiltInWindowsDriverService](../../packages/capability-sdk/src/computer/node.ts#L176)?：函数，第?? 176 ?? 行。
- [sharedBuiltInWindowsDriver](../../packages/capability-sdk/src/computer/node.ts#L250)?：函数，第?? 250 ?? 行。
- [resolveContextValue](../../packages/capability-sdk/src/computer/node.ts#L276)?：函数，第?? 276 ?? 行。
- [screenshotBuffer](../../packages/capability-sdk/src/computer/node.ts#L283)?：函数，第?? 283 ?? 行。
- [pngDimensions](../../packages/capability-sdk/src/computer/node.ts#L295)?：函数，第?? 295 ?? 行。
- [jpegDimensions](../../packages/capability-sdk/src/computer/node.ts#L303)?：函数，第?? 303 ?? 行。
- [screenshotDimensions](../../packages/capability-sdk/src/computer/node.ts#L330)?：函数，第?? 330 ?? 行。
- [persistScreenshot](../../packages/capability-sdk/src/computer/node.ts#L336)?：函数，第?? 336 ?? 行。
- [withScreenshotPersistence](../../packages/capability-sdk/src/computer/node.ts#L361)?：函数，第?? 361 ?? 行。
- [createRemoteComputerDriver](../../packages/capability-sdk/src/computer/node.ts#L375)?：函数，第?? 375 ?? 行。
- [createNodeComputerCapability](../../packages/capability-sdk/src/computer/node.ts#L407)?：函数，第?? 407 ?? 行。

### [src/server/capabilities/agent-infrastructure.ts](../../src/server/capabilities/agent-infrastructure.ts)

- [safeSegment](../../src/server/capabilities/agent-infrastructure.ts#L42)?：函数，第?? 42 ?? 行。
- [createAgentCodeSandboxCapability](../../src/server/capabilities/agent-infrastructure.ts#L47)?：函数，第?? 47 ?? 行。
- [configuredConnectors](../../src/server/capabilities/agent-infrastructure.ts#L65)?：函数，第?? 65 ?? 行。
- [configuredCommunicationChannels](../../src/server/capabilities/agent-infrastructure.ts#L71)?：函数，第?? 71 ?? 行。
- [configuredDataSources](../../src/server/capabilities/agent-infrastructure.ts#L77)?：函数，第?? 77 ?? 行。
- [createConfiguredMediaOperations](../../src/server/capabilities/agent-infrastructure.ts#L90)?：函数，第?? 90 ?? 行。
- [agentMediaToolTimeoutMs](../../src/server/capabilities/agent-infrastructure.ts#L167)?：函数，第?? 167 ?? 行。
- [createAgentInfrastructureProviders](../../src/server/capabilities/agent-infrastructure.ts#L176)?：函数，第?? 176 ?? 行。

### [packages/capability-sdk/runtime/computer/windows-computer-driver.ps1](../../packages/capability-sdk/runtime/computer/windows-computer-driver.ps1)



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
        "observe",
        "launch",
        "click",
        "type",
        "key",
        "scroll",
        "wait"
      ]
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "application": {
      "description": "Exact desktop or Start-menu application name to open. Use action=launch for named applications instead of locating an icon by pixels.",
      "type": "string",
      "minLength": 1,
      "maxLength": 260
    },
    "elementId": {
      "description": "Element id from the latest observe result. Prefer this for click when an exact UIA, desktop-accessibility, OCR, or visual element matches the requested target.",
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "x": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000,
      "description": "Exact horizontal pixel coordinate in the latest screenshot. Use the returned screenshot width; 0 is the left edge and width - 1 is the right edge."
    },
    "y": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100000,
      "description": "Exact vertical pixel coordinate in the latest screenshot. Use the returned screenshot height; 0 is the top edge and height - 1 is the bottom edge."
    },
    "text": {
      "type": "string",
      "maxLength": 20000
    },
    "keys": {
      "minItems": 1,
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      }
    },
    "deltaX": {
      "type": "integer",
      "minimum": -100000,
      "maximum": 100000
    },
    "deltaY": {
      "type": "integer",
      "minimum": -100000,
      "maximum": 100000
    },
    "durationMs": {
      "type": "integer",
      "minimum": 0,
      "maximum": 300000
    },
    "button": {
      "type": "string",
      "enum": [
        "left",
        "middle",
        "right"
      ]
    },
    "clickCount": {
      "type": "integer",
      "minimum": 1,
      "maximum": 3
    }
  },
  "required": [
    "action",
    "reason"
  ],
  "additionalProperties": false
}
```
