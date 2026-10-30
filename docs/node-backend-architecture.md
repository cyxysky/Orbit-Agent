# Node 后端与 Agent 执行进程

公开端口、basePath 和已有 API 地址保持不变。所有启动方式都使用同一套进程边界，旧的 `WEBPILOT_SPLIT_RUNTIME=false` 不再关闭隔离。

| 进程 | 入口 | 职责 |
| --- | --- | --- |
| 公开网关及 Next UI | `server/webpilot-server.js` | 身份校验、CSRF、页面、静态资源、刷新 WebSocket、浏览器预览 WebSocket 转发 |
| Node API | `server/start-backend.js` | 标准 HTTP 路由、设置及数据接口、执行进程监管、中止超时处理和持久化恢复 |
| Agent 执行 | 同一入口，带 `--execution-worker` | Browser Chat、自动化、通信接入、浏览器会话、任务事件流及后台调度 |

内部 HTTP 服务只绑定 `127.0.0.1`，端口由启动器分配。内部请求必须携带进程生命周期令牌；用户身份和嵌入令牌仍由已有校验逻辑处理。内部端口不应作为客户端入口。

## 路由与页面

原有 71 个 API 路由移至 `src/backend/routes`，新增两个页面初始化接口。另有两个嵌入 SDK 脚本入口，总计 75 个显式注册路由模块。新增路由需要同时加入 `src/backend/route-manifest.ts`。

Node 路由使用标准 `Request`、`Response` 和 `URL`。适配器负责动态及 catch-all 参数、HEAD/OPTIONS、405/404、Cookie、多部分上传、流式响应和背压。客户端断开时会取消响应读取并触发 Request 的 abort signal；业务是否停止仍遵循原有路由语义，已提交的持久化任务不会因页面断开而自动重放或取消。

网页对话通过同一消息地址 `/api/browser-chat/:sessionId/message` 升级为 WebSocket，网关把原有 AI SDK 响应字节转发给客户端的流解析器。HTTP POST/SSE 仍供已有接口客户端使用。网页不再为每个活跃会话长期占用 HTTP/1.1 连接，避免六个标签页占满同站点连接后，普通接口和中止请求在浏览器内排队。WebSocket 必须通过同源检查和现有用户身份校验；断线不自动重新提交消息。

反向代理需允许上述消息路径的 WebSocket Upgrade，除了原有的 `/refresh` 和 `/browser-preview`。WebSocket 未接通时网页会显示连接错误，不会自动退回可能再次占满连接的长轮询或 SSE。

会话列表、bootstrap、工具目录以及会话的 state/history/logs/context GET/HEAD 在 API 进程读取数据库，不依赖执行进程响应。API 通过 IPC 任务归属判断活跃状态，避免因自身没有 Agent 注册表而把仍在执行的会话判成孤儿任务。浏览器选择、预览和业务修改仍由执行进程处理。

设置、管理及工作区页面通过 Node API 读取初始化数据。Next 不再导入后端服务。开发 API 目录镜像、React 别名、Next API 404 绕行和 Next instrumentation 后台启动已删除。

## 开发与生产

- `npm run dev`：公开启动器启动 Next UI，Node 源码加载器处理后端 TypeScript 和路径别名。API、执行进程均不加载 Next。
- **后端源码变更后需重启启动器**；Next 页面继续使用自己的 HMR。加载器不自动重启正在执行任务的进程。
- `npm run backend:typecheck`：独立后端类型检查。
- `npm run backend:check`：检查运行依赖图及导入重写，不生成产物。
- `npm run build`：先独立编译后端至 `dist-backend`，再构建 Next UI。
- `npm start`：使用 Next UI 产物和 `dist-backend/src/backend/http-server.js`，后端不依赖 Next 编译或 TS 路径别名。

Docker、Electron、server 包均包含 `dist-backend`、原生启动脚本、生产依赖和能力运行资源。Electron/server 的打包前检查要求后端入口及清单存在。生产入口不会使用源码加载器。工作区 SDK 源码会随运行依赖图编译；npm SDK 模式保留对应的包导入。

## 中止、崩溃与退出

当前是**一个共享执行进程**，不是每个会话一个进程。Agent 的同步计算和序列化不会堵住 API 事件循环，但同一执行进程中的其他任务仍可能受到影响。

普通中止沿用现有业务逻辑。API 会独立校验任务所有者和轮次，只有符合当前任务的中止请求才启用超时升级。默认 5 秒未收到执行进程响应时，API 强制终止该进程树，返回 `503 / execution_restarted`。API 持久化受影响任务的中断状态，再启动新执行进程；不会自动重放已开始的工具调用。子 Agent 的单独停止不会升级为杀死整个执行进程。

强制终止会影响该进程中所有正在运行的会话和自动化任务。队列中的聊天消息会标记中断，已完成记录保持不变。自动化过期执行租约会标记取消，不再自动重跑；尚未执行的持久化自动化队列仍由调度器处理。

执行进程通过 IPC 报告正在执行的任务，父进程负责异常退出后的状态落库。若整个主机同时退出，聊天的既有孤儿任务恢复和自动化的租约过期处理仍会在下次访问或调度时生效。进程终止不能撤销外部系统已完成的操作。

正常退出先逐层发送 shutdown，停止后台调度并关闭浏览器；超时后终止进程树。Windows 使用 `taskkill /T /F`，Linux 在 `/proc` 中捕获后代进程后清理，覆盖独立进程组中的子进程。

可配置：`ORBIT_API_HEAP_MB`（默认 1024）、`ORBIT_EXECUTION_HEAP_MB`（默认 4096）、`ORBIT_INTERRUPT_GRACE_MS`（默认 5000，最少 500）。内存采样、内存日志、自动和手动堆快照已移除；启动器不再因内存阈值自动重启。堆大小配置只设置 Node 的容量上限。

## 本轮验证边界

已执行独立后端类型检查、依赖图检查、普通 Node 直接加载全部路由、既有网关及打包布局测试。临时隔离检查覆盖动态路由、上传、多个 Cookie、SSE、断连取消、下载，以及模拟执行进程卡死后的所有权校验、中止、持久化恢复和重启；未调用模型或外部通信服务。

六会话连接修复另用真实 Chromium 的六个标签页验证：旧 SSE 使第七个 HTTP 请求无法到达服务端；六条 WebSocket 流保持打开时，普通 HTTP 请求约 1 ms 返回。还验证了协议头与字节保持、4 MiB 传输、跨来源及身份拒绝、断连清理和不重放。模拟执行进程卡死时，列表、bootstrap 和历史读取仍成功，六个活跃会话状态保持正确。这些是本地隔离验证，不是实际模型并发压力测试。

按本次要求，未运行 dev/build，未构建或启动 Docker、Electron、server 发布产物。这些检查证明代码边界与所测行为，不代表三种发布产物已经实际验收通过。此前浏览器启动竞争的修复仍保留；架构迁移不能替代对真实浏览器环境的验证。
