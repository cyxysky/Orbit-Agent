# Capability SDK

**Give your existing agent browser, Office, terminal, code, charts and knowledge tools through one SDK or MCP server.**

[简体中文](README.zh-CN.md) · [Tool reference](TOOLS.md) · [Setup](SETUP.md) · [SDK development](SDK.md)

Capability SDK packages tool implementations, input schemas, operating instructions, structured results and local runtime preparation together. Connect a supported MCP client, or mount selected capabilities in your own agent process. Your agent keeps its model and orchestration.

The current standalone release is **0.3.10**, distributed through [GitHub Releases](https://github.com/cyxysky/capability-sdk/releases/tag/v0.3.10). The installer supports GitHub packages directly; npm publication is optional. npm 0.3.0 does not contain the unified setup command.

## What your agent can do

| Capability | Included work | Setup |
| --- | --- | --- |
| Browser | Playwright sessions, DOM reads, screenshots and interactions | Managed Chromium |
| Files and Office | Read, generate, edit, render and convert documents, spreadsheets, presentations and PDFs | LibreOffice/UNO and format libraries |
| Terminal and code | Run commands, manage terminal sessions and execute local code | Local processes and managed Python |
| Charts | Create ECharts and 3D visualizations, preview and export | Bundled visualization UI |
| Knowledge | Ingest content and retrieve relevant passages | Local storage; configure optional services |
| Media | Inspect media, extract frames, compose videos and generate images | FFmpeg; Codex login for built-in images, configurable video/speech providers |
| Computer | Observe and control a Windows desktop | Windows driver or a configured endpoint |
| Maps, data and integrations | Map tools, database adapters, connectors and enterprise communication | Opt-in configuration and service credentials |

Use [tool configuration](MCP-CONFIG.zh-CN.md) to select what you expose. Sensitive-data detection is a separate model middleware; adding an MCP connection does not automatically intercept model requests.

## Install into an existing agent

Requires **Node.js >=22.16 with npm**. Automatic runtime preparation supports Windows x64 and Ubuntu 22.04/24.04 or Debian 12/13 on x64/arm64. macOS automatic runtime preparation is not currently supported.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/cyxysky/capability-sdk/main/install.ps1 | iex
```

Supported Linux systems:

```sh
curl -fsSL https://raw.githubusercontent.com/cyxysky/capability-sdk/main/install.sh | sh
```

These scripts install release 0.3.10 into `~/.capability-tools`, prepare runtimes and merge supported user-level MCP configurations with backups. When the npm version is unavailable, they download the matching GitHub Release package and verify its SHA-256 checksum. Reload your client and enable the `capability-sdk` connection. The first full runtime preparation can download several GB; Linux system dependencies may need root or passwordless sudo. See [setup details](SETUP.md).

For a reviewed local clone, preview or select clients:

```sh
node install.mjs --dry-run --clients cursor,codex,claude-code
node install.mjs --clients cursor,codex,claude-code --project ./agent-tools
```

Supported configuration targets: Cursor, Codex, Claude Code, Claude Desktop, VS Code, Windsurf and Devin. This installs tools and prepares connections; client applications are installed separately.

## Use the tools in your own agent

Install the prepared release in your agent project:

```sh
npm install https://github.com/cyxysky/capability-sdk/releases/download/v0.3.10/cjfclonedeep-capability-sdk-0.3.10.tgz
```

Once the same version is available on npm, `npm install @cjfclonedeep/capability-sdk@0.3.10` is equivalent. Mount only the capabilities you need, then give their schemas, instructions and execution functions to your model adapter:

```js
import { createLocalCapabilities } from '@cjfclonedeep/capability-sdk/local';

const runtime = await createLocalCapabilities({ tools: ['browser', 'file', 'chart'] });
try {
  for (const { publicName, tool } of Object.values(runtime.snapshot.tools)) {
    console.log(publicName, tool.description, tool.input.jsonSchema);
  }
  // Pass runtime.snapshot and runtime.instructions to your agent integration.
} finally {
  await runtime.dispose();
}
```

Start the process with the tool project as its working directory. Native adapters are available at `/ai-sdk`, `/openai` and `/mcp`. See [agent integration examples](AGENT-INTEGRATIONS.zh-CN.md), [framework integration](FRAMEWORK_INTEGRATION.md) and the runnable [browser example](examples/browser-read.mjs).

Browser code uses the provided Node-side `page` binding. Read DOM inside the page callback:

```js
var info = await page.evaluate(() => ({ title: document.title }));
nodeRepl.write(info);
```

## Develop and release

The source package has its own TypeScript configuration and dependencies. It does not require the original agent application. Maintainers can typecheck without building or downloading the tool runtimes:

```sh
CAPABILITY_SKIP_RUNTIME_INSTALL=1 npm install
npm run typecheck
```

For the independent repository export and manual release workflow, see [maintainer notes](RELEASING.zh-CN.md). Source code is licensed under [MIT](LICENSE). Dependencies and downloaded third-party runtimes retain their own licenses.
