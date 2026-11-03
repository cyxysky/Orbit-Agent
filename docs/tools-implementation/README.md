# 项目各工具完整实现逻辑

基于 2026-10-06 当前工作区源码，包含 **18 个公开/运行时工具的独立文档**、执行总览及 bug 修复记录，共 **21 份 Markdown 文件**。每类能力文档提供动作分支、参数验证、实际后端、持久化/产物、并发取消、错误结果、全部配置默认值、源码函数索引和源码直接导出的完整输入 JSON Schema。运行时工具附准确输入定义；浏览器同时记录 SDK 默认输入和宿主四种模式输入。

先读 [运行时总览](00-runtime.md)，再按工具阅读。

所有工具共用 [统一文本错误码](../error-codes.md)；代码定义集中在 [errors.ts](../../packages/capability-sdk/src/errors.ts)。

| 工具 | 实现逻辑文档 | 完整动作覆盖 |
| --- | --- | --- |
| `browser` | [浏览器 browser](browser.md) | state / snapshot / code / dismissSurface / observe / act / images / navigate / tabs / waitForHumanVerification / requestUserInput / mcp |
| `file` | [文件与 Office file](file.md) | list / readSource / readContent / download / write / convert / plan / generate / edit / unoApi / jsApi / render / visualIndex / visualRead / visualReport / read（兼容别名） |
| `chart` | [图表与画布 chart](chart.md) | api / create / read / update |
| `maps` | [地图 maps](maps.md) | request.action=search / request.action=route / request.action=show / mapId 读取 |
| `codeSandbox` | [代码沙箱 codeSandbox](codeSandbox.md) | run / readFile |
| `terminal` | [本地终端 terminal](terminal.md) | create / list / run / read / wait / write / interrupt / resize / rename / close / delete |
| `connectors` | [外部连接器 connectors](connectors.md) | list / describe / call |
| `communication` | [通信 communication](communication.md) | channels / draft / readDraft / send |
| `knowledge` | [知识库 knowledge](knowledge.md) | ingest / search / get / list / delete |
| `data` | [结构化数据 data](data.md) | sources / schema / query |
| `media` | [多媒体 media](media.md) | listModels / inspect / extractFrames / ocr / transcribe / composeVideo / generateImage / generateVideo / generateSpeech |
| `computer` | [电脑操作 computer](computer.md) | observe / launch / click / type / key / scroll / wait |
| `textEditor` | [文本编辑 textEditor](textEditor.md) | create / list / read / write / edit / append / delete / export |
| `skill` | [技能读取](skill.md) | read |
| `finalResponse` | [最终响应](finalResponse.md) | 校验 / 审核 / 接受 / 顺序渲染 |
| `subagent` | [子代理](subagent.md) | spawn / read |
| `memory` | [个人记忆](memory.md) | search / save / update / disable |
| `contextRead` | [历史上下文检索](contextRead.md) | 列表 / 关键词检索 / 准确读取 |

[BUG 修复及验证结果](audit-and-fixes.md)记录本轮确认的问题、改动和检查局限。

范围说明：18 是本目录覆盖的工具名数量，是否启用依运行入口而异；不把 file 的每个 action 或浏览器代码中的每个 API 算作独立工具。computer/media/communication 等实际可用性依配置与宿主；敏感数据过滤、渲染、MCP 协议和 WebSocket 是支撑模块，见运行时总览。
