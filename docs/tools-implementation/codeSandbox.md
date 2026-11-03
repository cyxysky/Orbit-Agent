# 代码沙箱 codeSandbox：完整实现逻辑

源码基准：2026-10-06，当前工作区。共用执行协议见 [运行时总览](00-runtime.md)，所有字段、类型、枚举和静态上限见本文末尾的真实输入 Schema。Schema 以实际模块导出的 jsonSchema 自动提取；动作特有 superRefine/业务验证由正文说明。

能力 ID：`com.webpilot.code-sandbox`。公开工具名：`codeSandbox`。动作覆盖：`run`、`readFile`。并发边界：parallel / code-sandbox；本地引擎另有最大并发控制。

## 入口、配置与参数

run 要求 language=javascript/python、code、reason；工具先检查 AGENT_CODE_SANDBOX_ENABLED，归一化运行时长、安装时长、输出、内存、CPU、PID、工作区和网络策略。依赖数量和代码大小受限，npm 必须 package@精确版本，Python 必须 package==精确版本；不会用任意命令行字符串拼接安装命令。

Orbit 默认 remote，AGENT_CODE_SANDBOX_BACKEND=local 时使用本地引擎。远端 URL 在创建 executor 时校验为 HTTP(S)，Bearer token 仅在传输请求头使用。local/remote 都经 withCodeSandboxArtifacts 绑定本轮产物，不把内部 base64 文件载荷直接展示给模型。

## run 的完整生命周期

1. 解析/验证输入，匹配允许的依赖格式，归一化配置上限。
2. 宿主将准确 artifactId 输入解析为本轮拥有的文件，验证 realpath、文件类型、单文件/总大小，转成 inputs/ 下的 transport 文件。
3. 本地引擎获取并发名额，为每次执行创建独立临时目录，写 JS .mjs 或 Python 源文件；按需安装固定版本依赖并建立输入/输出目录。
4. 在有界子进程中运行，收集 stdout/stderr、退出码、信号、耗时、超时、取消和输出超限状态。Unix 用进程组、Windows 用进程树终止，等待进程结束后清理临时目录并释放名额。
5. 收集 outputs/ 和明确请求的输出文件；拒绝软链接、越界路径、特殊文件、超深目录和过多文件。最多 16 文件，单文件 10 MiB，总计 32 MiB。
6. 宿主解码验证输出，保存到本轮 code-artifacts，返回真实 artifactId、文件名、MIME 和下载 URL；即使执行失败，已生成的合法产物仍可随错误详情返回。

成功要求退出码 0 且未超时、取消或输出超限。失败返回对应 code-execution-* 错误与 stderr；JS 的 require-in-ESM 错误给出 import/createRequire 修复提示。工具返回失败后不能把部分 stdout 当作执行成功。

## 远端 Runner 的传输与取消

POST /v1/execute 带 invocationId 和完整执行契约，禁止自动重定向。外层响应截止时间是代码 timeoutMs + 有依赖时的 installTimeoutMs + 10 秒。连接失败区分明确未送达和远端结果未知，避免自动重复执行。响应正文流式读取，最多 48 MiB，容纳 32 MiB 文件的 base64 膨胀和日志；正文读取期间超时与等待 HTTP 头超时使用同一 runner-timeout 分类。健康响应最多 8,000,000 字节。

Runner 校验认证和请求大小，调用同一 execution engine，返回内部传输文件。该协议不是直接访问宿主任意文件的接口。本地执行的隔离程度来自宿主/容器设置，工具契约和资源上限本身不等于完整系统隔离。

## readFile

要求准确的本轮 artifactId；realpath 校验阻止跨 run 和目录逃逸。文本默认 utf8，二进制默认 base64。offset 为字节偏移，读取 limit 有上限；UTF-8 尾部不足一个字符时延迟到下一页，小页必要时扩展到完整字符，返回 nextOffset 与 totalBytes。可识别图片附本地 imagePath 给宿主图像通道。SDK 默认本地 executor 没有 readFile，Orbit 包装器提供此动作。

## 配置与默认值

| 配置键 | 默认值 | 何时生效 | 实现中的说明 |
| --- | --- | --- | --- |
| `AGENT_CODE_SANDBOX_ENABLED` | false | runtime | 启用受限代码执行。生产环境推荐使用独立 runner。 |
| `AGENT_CODE_SANDBOX_BACKEND` | remote | runtime | remote 通过独立 runner 执行；local 仅适合可信的单机开发环境。 |
| `AGENT_CODE_SANDBOX_RUNNER_URL` | http://127.0.0.1:18100 | runtime | 主服务可访问的 Runner HTTP 地址。启用后，本机根路径 HTTP 地址由应用管理启动和退出；Docker Compose 管理独立容器；其他远程地址需预先部署。 |
| `AGENT_CODE_SANDBOX_RUNNER_TOKEN` | 空 | runtime | 主服务调用 runner 使用的共享认证令牌。 |
| `AGENT_CODE_SANDBOX_TIMEOUT_MS` | 300000 | runtime | 最长执行时间（毫秒）。 |
| `AGENT_CODE_SANDBOX_INSTALL_TIMEOUT_MS` | 600000 | runtime | 依赖安装的最长时间（毫秒）；代码执行另计执行超时。大体积 Python wheel 在慢速网络下可能需要数分钟。 |
| `AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS` | 30000 | runtime | 标准输出与标准错误的合计字符上限。超出部分截断，计算继续；工具参数不能超过此上限。 |
| `AGENT_CODE_SANDBOX_NETWORK_MODE` | full | runtime | full 允许 runner 访问网络；none 需要单独部署无网络 runner，local 后端无法实现隔离。 |
| `AGENT_CODE_SANDBOX_ALLOW_PACKAGE_INSTALL` | true | runtime | 允许任务在临时环境中安装固定版本的 Python/npm 包。 |
| `AGENT_CODE_SANDBOX_MAX_PACKAGES` | 16 | runtime | 单次执行最多安装的依赖数量。只接受固定版本。 |
| `AGENT_CODE_SANDBOX_MAX_CONCURRENCY` | 2 | runtime | 单机 local 后端同时运行的最大任务数；remote runner 由 runner 容器统一限制。 |
| `AGENT_CODE_SANDBOX_MEMORY_MB` | 512 | runtime | 发送给 runner 的任务策略值；真正的硬上限由 runner 容器 mem_limit 决定。 |
| `AGENT_CODE_SANDBOX_CPU_LIMIT` | 1 | runtime | 发送给 runner 的任务策略值；真正的硬上限由 runner 容器 cpus 决定。 |
| `AGENT_CODE_SANDBOX_PIDS_LIMIT` | 128 | runtime | 发送给 runner 的任务策略值；真正的硬上限由 runner 容器 pids_limit 决定。 |
| `AGENT_CODE_SANDBOX_WORKSPACE_MB` | 256 | runtime | 发送给 runner 的任务策略值；真正的硬上限由 runner 容器 tmpfs 决定。 |

权限契约：`process:execute`、`workspace:temporary`、`network:egress`、`package:install`、`artifact:read`、`artifact:write`。权限清单由宿主授权器处理，不等于每次自动弹出确认。

## 源码与函数定位

### [packages/capability-sdk/src/execution/code/index.ts](../../packages/capability-sdk/src/execution/code/index.ts)

- [CodeSandboxRunnerError](../../packages/capability-sdk/src/execution/code/index.ts#L67)?：类，第?? 67 ?? 行。
- [invalidCodeSandboxPackageSpecs](../../packages/capability-sdk/src/execution/code/index.ts#L108)?：函数，第?? 108 ?? 行。
- [createCodeSandboxTool](../../packages/capability-sdk/src/execution/code/index.ts#L125)?：函数，第?? 125 ?? 行。
- [createCodeSandboxCapability](../../packages/capability-sdk/src/execution/code/index.ts#L221)?：函数，第?? 221 ?? 行。

### [packages/capability-sdk/src/execution/code/node.ts](../../packages/capability-sdk/src/execution/code/node.ts)

- [createNodeProcessCodeSandbox](../../packages/capability-sdk/src/execution/code/node.ts#L13)?：函数，第?? 13 ?? 行。
- [createNodeCodeSandboxCapability](../../packages/capability-sdk/src/execution/code/node.ts#L22)?：函数，第?? 22 ?? 行。

### [packages/capability-sdk/src/execution/code/remote.ts](../../packages/capability-sdk/src/execution/code/remote.ts)

- [runnerUrl](../../packages/capability-sdk/src/execution/code/remote.ts#L9)?：函数，第?? 9 ?? 行。
- [readJson](../../packages/capability-sdk/src/execution/code/remote.ts#L15)?：函数，第?? 15 ?? 行。
- [connectionError](../../packages/capability-sdk/src/execution/code/remote.ts#L20)?：函数，第?? 20 ?? 行。
- [createHttpCodeSandboxExecutor](../../packages/capability-sdk/src/execution/code/remote.ts#L46)?：函数，第?? 46 ?? 行。
- [createHttpCodeSandboxCapability](../../packages/capability-sdk/src/execution/code/remote.ts#L95)?：函数，第?? 95 ?? 行。

### [src/server/capabilities/agent-infrastructure.ts](../../src/server/capabilities/agent-infrastructure.ts)

- [safeSegment](../../src/server/capabilities/agent-infrastructure.ts#L42)?：函数，第?? 42 ?? 行。
- [createAgentCodeSandboxCapability](../../src/server/capabilities/agent-infrastructure.ts#L47)?：函数，第?? 47 ?? 行。
- [configuredConnectors](../../src/server/capabilities/agent-infrastructure.ts#L65)?：函数，第?? 65 ?? 行。
- [configuredCommunicationChannels](../../src/server/capabilities/agent-infrastructure.ts#L71)?：函数，第?? 71 ?? 行。
- [configuredDataSources](../../src/server/capabilities/agent-infrastructure.ts#L77)?：函数，第?? 77 ?? 行。
- [createConfiguredMediaOperations](../../src/server/capabilities/agent-infrastructure.ts#L90)?：函数，第?? 90 ?? 行。
- [agentMediaToolTimeoutMs](../../src/server/capabilities/agent-infrastructure.ts#L167)?：函数，第?? 167 ?? 行。
- [createAgentInfrastructureProviders](../../src/server/capabilities/agent-infrastructure.ts#L176)?：函数，第?? 176 ?? 行。

### [src/server/capabilities/code-sandbox-artifacts.ts](../../src/server/capabilities/code-sandbox-artifacts.ts)

- [withCodeSandboxArtifacts](../../src/server/capabilities/code-sandbox-artifacts.ts#L14)?：函数，第?? 14 ?? 行。

### [server/code-sandbox-runner.js](../../server/code-sandbox-runner.js)

- [shutdown](../../server/code-sandbox-runner.js#L31)?：函数，第?? 31 ?? 行。
- [authorized](../../server/code-sandbox-runner.js#L46)?：函数，第?? 46 ?? 行。
- [sendJson](../../server/code-sandbox-runner.js#L51)?：函数，第?? 51 ?? 行。
- [readBody](../../server/code-sandbox-runner.js#L57)?：函数，第?? 57 ?? 行。

### [packages/capability-sdk/runtime/execution/engine.cjs](../../packages/capability-sdk/runtime/execution/engine.cjs)

- [createCodeExecutionEngine](../../packages/capability-sdk/runtime/execution/engine.cjs#L7)?：函数，第?? 7 ?? 行。

### [packages/capability-sdk/runtime/execution/files.cjs](../../packages/capability-sdk/runtime/execution/files.cjs)

- [relativeFile](../../packages/capability-sdk/runtime/execution/files.cjs#L8)?：函数，第?? 8 ?? 行。
- [decodeFile](../../packages/capability-sdk/runtime/execution/files.cjs#L16)?：函数，第?? 16 ?? 行。
- [stageFiles](../../packages/capability-sdk/runtime/execution/files.cjs#L27)?：函数，第?? 27 ?? 行。
- [collectFiles](../../packages/capability-sdk/runtime/execution/files.cjs#L43)?：函数，第?? 43 ?? 行。

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
          "const": "run"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "language": {
          "type": "string",
          "enum": [
            "javascript",
            "python"
          ]
        },
        "code": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100000
        },
        "args": {
          "maxItems": 32,
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 2000
          }
        },
        "packages": {
          "description": "Exact versions only: Python [\"matplotlib==3.10.1\"], JavaScript [\"lodash@4.17.21\"]. Python packages must provide binary wheels for the runner Python version and platform.",
          "maxItems": 32,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "outputFiles": {
          "description": "Additional relative files to save. Files under outputs/ are saved automatically, separately from stdout.",
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          }
        },
        "inputFiles": {
          "description": "Mount previously saved sandbox artifacts under inputs/, e.g. {artifactId, path:\"inputs/chart.png\"}.",
          "maxItems": 16,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "artifactId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000
              },
              "path": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              }
            },
            "required": [
              "artifactId",
              "path"
            ],
            "additionalProperties": false
          }
        },
        "timeoutMs": {
          "type": "integer",
          "minimum": 1000,
          "maximum": 300000
        },
        "maxOutputChars": {
          "description": "Combined stdout/stderr character budget (1000..200000); use a JSON number. Clamped to the host output limit. Excess output is truncated, not a file transfer channel.",
          "anyOf": [
            {
              "type": "number"
            },
            {
              "type": "string",
              "pattern": "^\\d+$"
            }
          ]
        }
      },
      "required": [
        "action",
        "reason",
        "language",
        "code"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "readFile"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "artifactId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "offset": {
          "description": "Byte offset from the previous nextOffset.",
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 24000
        },
        "encoding": {
          "type": "string",
          "enum": [
            "utf8",
            "base64"
          ]
        }
      },
      "required": [
        "action",
        "reason",
        "artifactId"
      ],
      "additionalProperties": false
    }
  ]
}
```
