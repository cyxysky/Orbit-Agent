# Unified MCP CLI

[English](MCP-CLI.md) | [简体中文](MCP-CLI.zh-CN.md)

The CLI is available since 0.3.0 and needs no server file, TypeScript, tsx, or additional MCP dependency.

Tool configuration lives in project-root `capability.config.json`, automatically loaded at startup. `capability-mcp init config` creates a complete template; `init cursor` also creates this file when missing. Read [the detailed field reference](MCP-CONFIG.zh-CN.md), or run `capability-mcp --describe-config` for the machine-readable schema with descriptions. JSON uses real booleans/numbers and rejects unknown fields, invalid ranges and incompatible browser options. Explicit JSON settings override corresponding environment variables. Restart MCP after edits.

From the consuming project:

```sh
npm install @cjfclonedeep/capability-sdk
npx --no-install capability-mcp init cursor
```

Enable `capability-sdk` in Cursor's MCP settings. The initializer merges `.cursor/mcp.json`, preserves other settings, and refuses to overwrite a different existing `capability-sdk` entry. Repeating identical setup is a no-op. It neither installs runtimes nor starts tools. Cursor launches Node directly from the local dependency, without downloading another package:

```json
{
  "mcpServers": {
    "capability-sdk": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/node_modules/@cjfclonedeep/capability-sdk/scripts/mcp.mjs",
        "--project", "${workspaceFolder}"
      ]
    }
  }
}
```

See [Cursor configuration](https://cursor.com/docs/mcp). Node >=22.16 must be on PATH, or set `command` to its absolute executable path. Other MCP clients use `node`, the absolute script path, `--project`, and the absolute project directory in their own stdio configuration; `${workspaceFolder}` is specific to Cursor.

Manual stdio startup: `npx --no-install capability-mcp --project .`. The process waits for MCP requests. The client owns model access and tool selection; the server needs no model key. For remote clients, use the [HTTP integration](MCP.md); this CLI serves local stdio.

Default groups: `browser`, `terminal`, `code`, `file`, `chart`, `knowledge`, `media`, plus `computer` on Windows or when `AGENT_COMPUTER_ENDPOINT` is configured. These expose browser sessions, local terminal and JavaScript/Python, file/Office operations, charts, persistent knowledge, media inspection/frame extraction, and desktop control. Windows exposes 8 tool entries. Browser uses one browser tool with action=open/code/snapshot/close. The media provider does not implement OCR, transcription or generation without custom operations. Databases and business integrations need configured providers. Sensitive-data models are middleware, and do not automatically intercept the MCP client's model requests.

Options:

- `--list`: show groups and platform defaults without loading tools.
- `--tools browser,terminal,file`: select groups; `all` selects platform defaults.
- `--project <directory>`: takes precedence over `CAPABILITY_PROJECT_DIR` and current directory. Resolved before importing tools.
- `--skill-mode eager|lazy`: eager instructions by default; lazy adds a `skill` reader.
- `--config ./capability.mcp.mjs`: explicitly load project-relative MCP options. Default export may be an object or async factory receiving `{ projectRoot, stateDirectory, providers }`. Return `{ providers: [...providers, yourProvider], configurations, policy }` to extend the server. An explicit `providers` array replaces defaults. `--tools none --config ...` serves only custom providers. No configuration code is auto-discovered.

`init cursor` also accepts tool, skill and config options. When not explicitly overridden in JSON, built-in settings can still be supplied as environment variables; e.g. `BROWSER_HEADLESS=false` or `AGENT_TERMINAL_ENABLED=false`. Local terminal/code and supported computer control are enabled by default and run with the current user's permissions. Project selection sets paths; it is not OS isolation.

Existing runtimes stay under `<project>/.capability-sdk/<platform>-<arch>` (unless `CAPABILITY_RUNTIME_HOME` explicitly overrides it). Persistent MCP state is under `<project>/.capability-sdk/mcp`: `artifacts`, `code`, and `knowledge`. Gitignore `.capability-sdk/`. Startup never installs or downloads runtimes; diagnose/install from the project with `npx --no-install capability-runtime doctor` / `install`.

Custom logs belong on stderr, not the protocol stdout. Closing stdin or sending SIGINT/SIGTERM closes providers and Office workers before the CLI exits.
