# BUG 修复与验证记录

审计日期：2026-10-06。范围为当前工作区的前端聊天、后端运行时与观测、Capability SDK 及各工具宿主实现。保留工作区已有的数据库迁移、工具重构和其他修改；本次没有启动 dev、执行 build 或新增测试文件。下面记录实际确认并修复的问题，不代表已经穷尽所有缺陷。

## 已修复的 6 类问题

### 1. 会话未准备好时读取空提交消息

位置：[BrowserChatWorkspace.tsx](../../src/components/BrowserChatWorkspace.tsx)，submittedClientMessageId 计算。

原表达式先比较 submittedMessage?.sessionId 与 session?.id；两个对象均不存在时，两边都是 undefined，比较仍成立，接着直接读取 submittedMessage.clientMessageId，可能在初始加载或切换会话时抛出异常。

现在先要求 submittedMessage 存在，再判断会话 ID 是否一致。没有提交消息时明确传 undefined，不会读取空对象属性。

### 2. 执行权限按钮的事件类型不兼容

位置：[BrowserChatWorkspace.tsx](../../src/components/BrowserChatWorkspace.tsx)，BrowserChatSafetySelector。

HoverCard 注入的是原生 DOM 的焦点/指针事件，原来直接传给 HeroUI Button，和其事件签名不兼容，导致生产源码类型检查失败。改用原生 button，沿用既有 class、aria-label、aria-pressed 和图标；disabled 与 onClick 采用原生属性，type=button 避免意外提交表单。按钮继续响应鼠标、键盘与悬浮/焦点提示。

### 3. 观测面板分页生成器的异步泛型不正确

位置：[ai-operations-dashboard.ts](../../src/server/observability/ai-operations-dashboard.ts)，dashboardRows。

异步生成器会对 yield 值做 Awaited 展开，原泛型承诺 AsyncGenerator<T>，与数据库泛型行的实际异步展开类型不一致，使后端类型检查失败。将生成器和查询行统一为 Awaited<T>，保留实际分页与统计逻辑，解决类型契约冲突。

### 4. 电脑操作失败后仍使用旧截图坐标

位置：[computer/index.ts](../../packages/capability-sdk/src/computer/index.ts)，createComputerTool。

原实现只在非 observe 动作成功返回且缺截图时清除缓存。observe 抛错、返回空截图或其他操作执行中抛错，都会留下旧 latestObservation；失败输入还可能已部分改变桌面，下一次点击仍被旧证据授权。

现在在调用驱动前清空旧缓存，只有当前返回有效 artifactId、width 和 height 时才建立新的观察。执行前的参数/边界校验仍保留缓存；真正尝试驱动操作后不再复用之前的画面。点击回执中的参考尺寸和实际坐标在清空前保存，仍能追踪本次操作。

受控验证覆盖首次直接点击、observe 抛错、空观察、点击执行中抛错、失败后再点击及成功重新 observe 后恢复。被阻止的点击没有调用驱动。

### 5. 沙箱 Runner 响应无界读取，正文超时分类丢失

位置：[remote.ts](../../packages/capability-sdk/src/execution/code/remote.ts)，readJson 与 createHttpCodeSandboxExecutor.run。

原 response.text() 无限制缓冲远端内容；异常/失控 Runner 可导致过量内存使用。同时 try/catch 只包 fetch 获取响应头，读取正文期间的超时/取消未走相同错误分类，可能丢失“远端状态未知，不可自动重试”的关键信息。

现在使用共用 readBoundedResponseText 增量读取。执行结果最大 48 MiB：已有输出文件总量允许 32 MiB，base64 编码约需 43 MiB，剩余空间容纳有界日志和元数据；健康响应为 8,000,000 字节。超限立即停止读取并取消流、释放 reader。正文读取异常优先保留调用者的取消 reason；内部超时保持 code-sandbox-runner-timeout 及任务状态未知提示。

受控验证覆盖超过通用 8 MB 但合法的执行响应、超过 48 MiB 的流停止读取、调用者取消原因保持原对象及正文读取超时分类。超时验证直接缩短 executor 内部截止时间，不改变公开工具的参数上限。

### 6. Webhook 发送回执无界读取

位置：[communication/node.ts](../../packages/capability-sdk/src/integrations/communication/node.ts)，createJsonWebhookChannel.send。

原 response.text() 会缓冲任意大小的接收端回执。现在使用共享流式读取器，最大 8,000,000 字节，保留 JSON/文本解析、HTTP 状态和业务接受判断，超限停止消费并释放 reader。

受控验证使用模拟响应确认超限拒绝及流取消，没有访问网络或发送真实消息。若接收端已经接受消息但回执读取失败，通信工具继续按既有 unknown 语义处理，不能自动推断消息未发送。

## SDK 两份源码同步

当前工作区含 web-app-test/packages/capability-sdk 与同级 capability-sdk。此前同步 computer/index.ts、execution/code/remote.ts、integrations/communication/node.ts 的缺陷修复。本次错误码迁移先比较两边的修改前内容，确认相关源码相同后同步错误码修改与新增 errors.ts；未覆盖两边其他独立改动。此前的 Excalidraw 卡片样式修改继续保留。

## 统一错误码更新

新增单一错误码定义文件 errors.ts，工具、API、专用异常、日志与 MCP 均引用其中的文本码。输入验证与工具执行边界归一化外部异常；contextRead 和 finalResponse 的失败返回补齐 code。浏览器/Office 独立执行环境从同一文件生成常量快照。沙箱正文超限明确保留 http-response-too-large，连接失败保留 code-sandbox-runner-unavailable，正文超时保留 code-sandbox-runner-timeout。外部数字协议码与 errno 保留为原因或上游信息。

实现与调用约定见 [统一文本错误码](../error-codes.md)。新增受控验证涵盖错误码登记、输入失败、原因链、取消身份、成功结果保持、流取消、沙箱错误码和独立 Office 环境。没有新增测试文件。

## 验证结果

| 检查 | 结果 | 范围与说明 |
| --- | --- | --- |
| 后端 TypeScript 检查 | 通过 | tsc -p tsconfig.backend.json --noEmit --incremental false；0 错误 |
| 生产源码 TypeScript 检查 | 通过 | 读取现有 tsconfig，内存中排除 test/spec 与旧 .next 生成缓存，648 个根文件，0 诊断；未修改项目配置，未输出编译文件 |
| 现有图表 Node 测试 | 6 项通过 | 使用 Node 原生 test runner，覆盖持久化/修订并发、旧数据、formatter、3D 和表格/CSV |
| 现有地图 Vitest 测试 | 6 项通过 | SDK 中的现有 Vitest 测试；图表 node:test 文件另用原生 runner 执行 |
| 受控错误场景 | 通过 | 模拟电脑驱动、Runner 与 Webhook；覆盖上述缓存/大小/超时/取消，不添加测试文件、不触发实际桌面或网络行为 |
| 文档核对 | 通过 | 18 个工具文档、运行时总览、目录和本报告；校验本地链接、JSON 语法、能力 Schema 与源码及浏览器模式动作覆盖 |
| 修改文件空白检查 | 通过 | git diff --check |

## 现有检查仍存在的失配

完整项目 tsc 仍会把旧测试和此前生成的 Next route 类型纳入；它们存在缺失模块和旧接口错误。本次没有通过删除测试、修改 tsconfig 或伪造返回值来隐藏这些问题。

抽取的三个应用测试文件共出现 **24 项通过、8 项失败、1 个测试文件加载失败**。失败原因包括：

| 现有测试内容 | 与当前实现的差异 |
| --- | --- |
| communication-chart-images 测试 | 引用已不存在的 src/server/integrations/communication-chart-images 模块；当前图片逻辑已进入 capability 宿主模块 |
| runtime-context-compression 测试 | 调用已经移除的 mergeRuntimeModelMessageChain 导出 |
| 文件源码摘要断言 | 期待 sourceDigest，当前来源单元返回 sourceUnitDigest |
| Office 格式化和下一步动作断言 | 期待已移除的 requiredNextAction 字段 |
| readSource 默认读取范围断言 | 期待 240，当前为 80 |
| 下载 User-Agent 断言 | 期待 WebPilot，当前产品为 Orbit |
| 保存修复但仍有语法错误的断言 | 期待 ok=true；当前设计明确区分 saved=true 与 validation 失败，整体仍返回失败 |

旧 .next-dev-ui/dev/types 中的 route 类型还指向已迁到后端、从前端移除的 API 文件。以上项目需要单独按当前接口更新测试/缓存；不能据此宣称整个测试套件已经全绿。Windows 真实桌面、外部服务以及完整浏览器交互没有做端到端验证。

## 文档范围

目录见 [README.md](README.md)，共 21 份文件，覆盖 18 个模型/运行时工具。每类能力包括动作分支、输入验证、后端执行、存储、错误、取消、默认配置和源码符号索引；实际 JSON Schema 从当前 SDK 导出。浏览器另有 DOM/visual/hybrid/MCP 四种宿主输入，运行时工具包含准确的输入定义或动态 Schema 构造。
