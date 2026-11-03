# 本地终端 terminal：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.terminal`。公开工具名：`terminal`。动作覆盖：`create`、`list`、`run`、`read`、`wait`、`write`、`interrupt`、`resize`、`rename`、`close`、`delete`。并发边界：parallel；每个 PTY 单独检查忙闲状态。

## 运行模型

terminal 控制宿主 PTY，会话中的 shell/cwd/进程保持存在，区别于每次新建临时目录的 codeSandbox。AGENT_TERMINAL_ENABLED 控制可用性。Node 管理器维护 UUID 终端、starting/ready/running/closed 状态、当前 command、滚动输出、几何变化和事件订阅。Orbit 按会话复用管理器，能力快照释放不立即销毁仍由用户终端面板持有的 PTY。

## 动作链

| 动作 | 实现逻辑 |
| --- | --- |
| create | 校验同时打开与累计终端数，realpath 校验 cwd 为目录，选择 PowerShell/pwsh/bash，创建临时 shell 集成与 PTY，等待 ready；失败关闭并删除临时资源 |
| list | 返回现有终端摘要，不读取全部输出 |
| run | 只接受 ready 终端；创建 command UUID、开始时刻和超时设置；编译 shell 集成命令，写 PTY；按 yieldMs 等待完成或返回当前状态 |
| read | 从 cursor 读取保留窗口；游标超出已保留头部时标记 truncated，并返回最新 cursor |
| wait | 等待终端状态或输出更新/最长 yieldMs，然后增量读取，不重复提交命令 |
| write | 将原始输入发给 PTY；ready 状态输入含回车/换行才标记交互命令运行，焦点/设备回应不让终端误变 busy |
| interrupt | 中断当前命令，更新执行状态；具体过程由 shell/进程树管理承担 |
| resize | 修改 PTY 行列，并记录输出对应的几何变化供客户端重放 |
| rename | 修改终端显示名并发状态事件 |
| close | 结束 PTY，保留可查看的终端记录和输出 |
| delete | 先关闭，再删除该终端临时目录和会话记录，发布 deleted |

Windows 不使用 bash 路径，按宿主版本记录 ConPTY/WinPTY 后端；Unix 使用支持的 shell。shell 集成带不可猜测 nonce，解析启动/完成/退出标记，避免普通输出被误认作命令结束。未知或已关闭终端、忙碌终端再 run 返回明确错误。

## 输出和客户端

滚动缓冲用 UTF-16 字符游标维护 startCursor/cursor，并按配置截断；原始 ANSI/几何序列用于 xterm，工具读取默认转为普通文本。客户端通过认证 HTTP/WebSocket 订阅输出、状态、关闭和删除事件，并发送键盘、尺寸变化。输出订阅不是代码执行授权。取消 run 会中断其仍在运行的 command，命令截止时间和 wait 的等待时间是不同字段。

## 资源释放

manager dispose 阻止新建、等待在途创建、中断/关闭 PTY、释放 host/子进程和临时目录。创建计数在 finally 归还，防止初始化失败耗尽配额。删除只针对该终端的受管理临时目录。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `AGENT_TERMINAL_ENABLED` | false | runtime | 允许 Agent 在运行服务所在的机器上执行命令，操作受宿主权限控制。 |
| `AGENT_TERMINAL_CWD` | 空 | runtime | 命令的默认目录；留空使用应用工作目录。工作目录不是文件系统隔离边界。 |
| `AGENT_TERMINAL_SHELL` | auto | runtime | 新建终端使用的 Shell；auto 在 Windows 使用 PowerShell，在其他系统使用 Bash。已打开的终端保持原 Shell。 |
| `AGENT_TERMINAL_TIMEOUT_MS` | 0 | runtime | 单位毫秒，0 表示不设上限；单次命令可覆盖。超时先中断前台命令，无响应时关闭终端。终端在多轮对话间保留，关闭对话或服务时清理。 |
| `AGENT_TERMINAL_MAX_OUTPUT_CHARS` | 50000 | runtime | 每个终端保留的输出字符数；读取采用独立游标，超出时保留尾部并标记截断。 |
| `AGENT_TERMINAL_MAX_PROCESSES` | 4 | runtime | 每个用户在同一对话中可以同时打开的终端数量。关闭终端后释放名额。 |

权限契约：`process:terminal`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/execution/terminal/index.ts](../../packages/capability-sdk/src/execution/terminal/index.ts)

- [createTerminalTool](../../packages/capability-sdk/src/execution/terminal/index.ts#L78)?：函数，第?? 78 ?? 行。
- [createTerminalCapability](../../packages/capability-sdk/src/execution/terminal/index.ts#L104)?：函数，第?? 104 ?? 行。

### [packages/capability-sdk/src/execution/terminal/node.ts](../../packages/capability-sdk/src/execution/terminal/node.ts)

- [plainOutput](../../packages/capability-sdk/src/execution/terminal/node.ts#L17)?：函数变量，第?? 17 ?? 行。
- [nodeTerminalOptions](../../packages/capability-sdk/src/execution/terminal/node.ts#L41)?：函数，第?? 41 ?? 行。
- [createNodeTerminalOperations](../../packages/capability-sdk/src/execution/terminal/node.ts#L52)?：函数，第?? 52 ?? 行。
- [createNodeTerminalCapability](../../packages/capability-sdk/src/execution/terminal/node.ts#L344)?：函数，第?? 344 ?? 行。

### [packages/capability-sdk/src/execution/terminal/shell-integration.ts](../../packages/capability-sdk/src/execution/terminal/shell-integration.ts)

- [quotePowerShell](../../packages/capability-sdk/src/execution/terminal/shell-integration.ts#L6)?：函数变量，第?? 6 ?? 行。
- [quoteBash](../../packages/capability-sdk/src/execution/terminal/shell-integration.ts#L7)?：函数变量，第?? 7 ?? 行。
- [terminalShellInvocation](../../packages/capability-sdk/src/execution/terminal/shell-integration.ts#L9)?：函数，第?? 9 ?? 行。
- [terminalCommandInvocation](../../packages/capability-sdk/src/execution/terminal/shell-integration.ts#L48)?：函数，第?? 48 ?? 行。

### [packages/capability-sdk/src/execution/terminal/workspaces.ts](../../packages/capability-sdk/src/execution/terminal/workspaces.ts)

- [createTerminalWorkspaceRegistry](../../packages/capability-sdk/src/execution/terminal/workspaces.ts#L8)?：函数，第?? 8 ?? 行。

### [packages/capability-sdk/src/execution/terminal/windows-job.ts](../../packages/capability-sdk/src/execution/terminal/windows-job.ts)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。

### [packages/capability-sdk/src/execution/terminal/client.ts](../../packages/capability-sdk/src/execution/terminal/client.ts)

- [errorMessage](../../packages/capability-sdk/src/execution/terminal/client.ts#L10)?：函数变量，第?? 10 ?? 行。
- [createHttpTerminalClient](../../packages/capability-sdk/src/execution/terminal/client.ts#L12)?：函数，第?? 12 ?? 行。

### [packages/capability-sdk/src/execution/terminal/http.ts](../../packages/capability-sdk/src/execution/terminal/http.ts)

- [terminalHttpResponse](../../packages/capability-sdk/src/execution/terminal/http.ts#L6)?：函数，第?? 6 ?? 行。

### [packages/capability-sdk/src/execution/terminal/react.tsx](../../packages/capability-sdk/src/execution/terminal/react.tsx)

- [identity](../../packages/capability-sdk/src/execution/terminal/react.tsx#L14)?：函数变量，第?? 14 ?? 行。
- [drainTerminal](../../packages/capability-sdk/src/execution/terminal/react.tsx#L23)?：函数，第?? 23 ?? 行。
- [writeTerminal](../../packages/capability-sdk/src/execution/terminal/react.tsx#L42)?：函数，第?? 42 ?? 行。
- [restoreTerminal](../../packages/capability-sdk/src/execution/terminal/react.tsx#L49)?：函数，第?? 49 ?? 行。
- [disposeTerminal](../../packages/capability-sdk/src/execution/terminal/react.tsx#L57)?：函数，第?? 57 ?? 行。
- [TerminalListItem](../../packages/capability-sdk/src/execution/terminal/react.tsx#L63)?：函数，第?? 63 ?? 行。
- [TerminalWorkspace](../../packages/capability-sdk/src/execution/terminal/react.tsx#L127)?：函数，第?? 127 ?? 行。

### [packages/capability-sdk/src/execution/terminal/geometry.ts](../../packages/capability-sdk/src/execution/terminal/geometry.ts)

- [geometryMarkers](../../packages/capability-sdk/src/execution/terminal/geometry.ts#L6)?：函数变量，第?? 6 ?? 行。
- [parseTerminalGeometry](../../packages/capability-sdk/src/execution/terminal/geometry.ts#L8)?：函数，第?? 8 ?? 行。
- [terminalGeometrySequence](../../packages/capability-sdk/src/execution/terminal/geometry.ts#L16)?：函数，第?? 16 ?? 行。
- [splitTerminalOutput](../../packages/capability-sdk/src/execution/terminal/geometry.ts#L23)?：函数，第?? 23 ?? 行。
- [terminalGeometryAt](../../packages/capability-sdk/src/execution/terminal/geometry.ts#L38)?：函数，第?? 38 ?? 行。
- [retainTerminalOutput](../../packages/capability-sdk/src/execution/terminal/geometry.ts#L49)?：函数，第?? 49 ?? 行。

### [src/server/capabilities/terminal-manager.ts](../../src/server/capabilities/terminal-manager.ts)

该模块以契约、数据、脚本入口或对象方法为主；直接按上方源码链接阅读。

### [packages/capability-sdk/runtime/terminal/pty-host.cjs](../../packages/capability-sdk/runtime/terminal/pty-host.cjs)

- [send](../../packages/capability-sdk/runtime/terminal/pty-host.cjs#L8)?：函数，第?? 8 ?? 行。
- [finish](../../packages/capability-sdk/runtime/terminal/pty-host.cjs#L12)?：函数，第?? 12 ?? 行。
- [stop](../../packages/capability-sdk/runtime/terminal/pty-host.cjs#L18)?：函数，第?? 18 ?? 行。
- [resize](../../packages/capability-sdk/runtime/terminal/pty-host.cjs#L30)?：函数，第?? 30 ?? 行。

### [packages/capability-sdk/runtime/terminal/pty-host-client.cjs](../../packages/capability-sdk/runtime/terminal/pty-host-client.cjs)

- [spawnTerminal](../../packages/capability-sdk/runtime/terminal/pty-host-client.cjs#L6)?：函数，第?? 6 ?? 行。

## 完整输入 JSON Schema

以下内容直接来自当前源码导出，并不是手写参数示例。运行时的跨字段校验不由 JSON Schema 完全表达，仍以正文和 input.parse 为准。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "create"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "cwd": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "cols": {
          "type": "integer",
          "minimum": 20,
          "maximum": 500
        },
        "rows": {
          "type": "integer",
          "minimum": 5,
          "maximum": 200
        }
      },
      "required": [
        "action",
        "reason"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "list"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        }
      },
      "required": [
        "action",
        "reason"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "run"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "terminalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "command": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100000
        },
        "timeoutMs": {
          "description": "Command timeout; 0 means no deadline. Timeout interrupts the foreground command.",
          "type": "integer",
          "minimum": 0,
          "maximum": 3600000
        },
        "yieldMs": {
          "description": "Maximum wait for this call. The terminal and its command continue after this call returns.",
          "type": "integer",
          "minimum": 0,
          "maximum": 30000
        }
      },
      "required": [
        "action",
        "reason",
        "terminalId",
        "command"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "read"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "terminalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "cursor": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "action",
        "reason",
        "terminalId"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "wait"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "terminalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "cursor": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "yieldMs": {
          "description": "Maximum wait for this call. The terminal and its command continue after this call returns.",
          "type": "integer",
          "minimum": 0,
          "maximum": 30000
        }
      },
      "required": [
        "action",
        "reason",
        "terminalId"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "write"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "terminalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "input": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100000
        }
      },
      "required": [
        "action",
        "reason",
        "terminalId",
        "input"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "interrupt"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "terminalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      },
      "required": [
        "action",
        "reason",
        "terminalId"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "resize"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "terminalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "cols": {
          "type": "integer",
          "minimum": 20,
          "maximum": 500
        },
        "rows": {
          "type": "integer",
          "minimum": 5,
          "maximum": 200
        }
      },
      "required": [
        "action",
        "reason",
        "terminalId",
        "cols",
        "rows"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "rename"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "terminalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      },
      "required": [
        "action",
        "reason",
        "terminalId",
        "name"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "close"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "terminalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      },
      "required": [
        "action",
        "reason",
        "terminalId"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "delete"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "terminalId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      },
      "required": [
        "action",
        "reason",
        "terminalId"
      ],
      "additionalProperties": false
    }
  ]
}
```
