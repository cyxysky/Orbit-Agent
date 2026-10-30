# @cjfclonedeep/capability-sdk/execution

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

This guide describes a subpath of `@cjfclonedeep/capability-sdk@0.2.1`, not a separate npm package. The tools package includes the dependencies used by these examples.

Code execution and local terminal operations in one package. The two providers keep separate tools, configuration, Skills and permissions.

```sh
npm install @cjfclonedeep/capability-sdk
```

| Entry | Purpose |
| --- | --- |
| `@cjfclonedeep/capability-sdk/execution/code` | [JavaScript/Python contracts and provider](CODE.md) |
| `@cjfclonedeep/capability-sdk/execution/code/node` | [Local process executor](CODE.md) |
| `@cjfclonedeep/capability-sdk/execution/code/remote` | [HTTP runner executor](CODE.md) |
| `@cjfclonedeep/capability-sdk/execution/terminal` | [Terminal contracts and provider](TERMINAL.md) |
| `@cjfclonedeep/capability-sdk/execution/terminal/node` | [Local shell process sessions](TERMINAL.md) |

The root exports both framework-neutral providers; `/node` exports both Node factories. Each provider also exposes `/mcp`, `/settings` and `/runtime-skill` below its own entry. The runners share process-tree termination. Their environments, output policies and execution backends remain separate. A local code process is not OS isolation; use a suitable remote backend for isolation. Terminal sessions use the host account and last for the mounted runtime. A failed code backend never falls back to the terminal.
