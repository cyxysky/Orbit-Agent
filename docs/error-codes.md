# 统一文本错误码

## 定义与使用

项目自有错误码统一定义在 [errors.ts](../packages/capability-sdk/src/errors.ts)，由 SDK 主入口导出。业务模块引用 `ERROR_CODES`，不再自行定义错误码字符串。

```ts
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';

throw new CodedError(ERROR_CODES.HTTP_RESPONSE_TOO_LARGE, '响应正文超过大小上限。');
```

`code` 是供程序判断的稳定文本标识；`message` 保留可读说明。保留已有错误码的拼写，兼容调用端、历史记录和集成。新增错误码先加入 `ERROR_CODES`，再从业务模块引用。

## 传递逻辑

| 位置 | 实现 |
| --- | --- |
| 项目异常 | `CodedError` / `CodedAggregateError` 提供 `code`；原有专用异常类同样引用统一常量 |
| 输入解析 | `defineCapabilityInput`、AI SDK 参数验证将未知异常转换为带码异常，校验失败归入 `validation_failed` |
| 能力工具 | `defineCapabilityTool` 保留成功结果，给失败结果补码，将执行异常转换为带码异常 |
| API | `ApiRequestError`、`apiError`、`noStoreJson` 和 embed JSON 返回保留状态与错误说明，并统一错误码 |
| 宿主工具 | `record` 归一化失败结果；独立的 `contextRead` 和 `finalResponse` 也返回文本码 |
| MCP | 完整文本以 JSON 包含错误码，摘要文本包含 `[code]`；结构化结果保留 `error.code`，异常和未知 Skill 同样走此路径 |
| 日志 | 运行时日志和 Codex 异常序列化输出统一 `code` |
| 独立进程 | 浏览器代码内核、Office HTML 工作进程从同一 TS 定义生成常量快照，不依赖宿主进程的模块变量 |

典型能力失败结果如下；顶层 `code` 由归一化层补充，`error.code` 与它一致。

```json
{
  "ok": false,
  "code": "http-response-too-large",
  "error": {
    "code": "http-response-too-large",
    "message": "Response exceeds 50331648 bytes."
  }
}
```

`getErrorCode` 读取已登记的 `code`、`failureCategory` 和有限深度的 `cause` 链，识别取消、超时和参数校验；没有匹配时使用调用方指定的工具或模块错误码。`withErrorCode` 保留现有结果字段、错误说明、产物与重试信息，不改变成功结果。

## 外部错误与诊断

系统 errno、第三方服务错误码和 JSON-RPC 数字码属于外部证据，不作为项目公开错误码。异常转换保留原始 `cause`；结果与 Codex 序列化在适用时保留 `upstreamCode` / `rpcCode`。调用方根据项目文本码判断行为，原始信息供排查使用。

有编号的 JavaScript 诊断、Office 运行时诊断和地图 HTTP 状态通过 `javascriptDiagnosticCode`、`officeRuntimeDiagnosticCode`、`mapsHttpErrorCode` 生成。前缀、类型与校验均在同一个 `errors.ts` 文件中定义。

调用者主动取消时保留原始取消原因与既有生命周期；该取消原因在输出结果或日志时归一化，不改变取消对象身份。

## 沙箱远端响应为什么限制大小

Runner 执行响应可能含 stdout、stderr、产物内容和元数据。以前 `response.text()` 会完整缓冲任意大小的响应；异常 Runner 持续返回数据时，主服务可能占用过多内存。

现在在读取流时累计**实际接收字节**，执行响应超过 **48 MiB** 即抛出 `HTTP_RESPONSE_TOO_LARGE`，取消流并释放 reader。已有产物总量上限为 32 MiB，Base64 编码约占 43 MiB，因此执行响应的上限预留了编码、日志与元数据空间。健康检查响应上限为 8,000,000 字节。

这是主服务接收 Runner 响应的限制，与沙箱进程内存、磁盘配额和 stdout 字符数限制分别控制不同资源。等待响应正文时超时继续使用 `CODE_SANDBOX_RUNNER_TIMEOUT`；远端执行状态可能未知，不能据此自动重复提交。

## 本次验证

生产源码与后端 TypeScript 检查通过；现有图表、地图测试共 12 项通过。受控检查覆盖错误码登记、异常 cause、取消对象身份、成功结果保持、输入校验、流超限取消、沙箱错误码传递和独立执行环境中的 Office 异常。未启动 dev、运行 build 或新增测试文件。

全项目旧测试与 Next 生成缓存仍存在此前的接口失配，见 [审计记录](tools-implementation/audit-and-fixes.md)。
