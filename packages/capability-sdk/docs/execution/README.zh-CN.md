# @cjfclonedeep/capability-sdk/execution

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

本指南描述 `@cjfclonedeep/capability-sdk@0.2.1` 的子入口，不再是独立 npm 包。工具包已包含这些示例所需的工具依赖。

代码执行与本地终端合为一个包，两个 Provider 仍分别管理工具、配置、Skill 和权限。

```sh
npm install @cjfclonedeep/capability-sdk
```

| 入口 | 用途 |
| --- | --- |
| `@cjfclonedeep/capability-sdk/execution/code` | [JavaScript/Python 契约与 Provider](CODE.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/execution/code/node` | [本地进程执行器](CODE.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/execution/code/remote` | [HTTP Runner 执行器](CODE.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/execution/terminal` | [终端契约与 Provider](TERMINAL.zh-CN.md) |
| `@cjfclonedeep/capability-sdk/execution/terminal/node` | [本地 Shell 进程会话](TERMINAL.zh-CN.md) |

根入口导出两组无框架依赖的 Provider；`/node` 导出两个 Node 工厂。各组还提供自己的 `/mcp`、`/settings` 和 `/runtime-skill` 子入口。两个执行器共用进程树终止逻辑，但环境、输出策略与执行后端分别配置。本地代码进程不提供操作系统隔离；需要隔离时使用相应的远程后端。终端使用宿主账户权限，会话只持续到本次运行销毁。代码后端失败时不会回退到本地终端。
