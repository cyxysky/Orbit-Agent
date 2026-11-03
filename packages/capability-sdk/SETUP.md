# Install local tools and configure MCP clients

Requires Node.js >=22.16 and npm. This installer ships with the current source; older installed SDKs must be upgraded to a prepared release containing `scripts/setup.mjs`. See [the Chinese guide](SETUP.zh-CN.md) for full details and configuration paths.

From a reviewed standalone SDK clone, run `install.cmd` on Windows, or:

```sh
node install.mjs --clients cursor,codex,claude-code
```

The standalone launcher installs the pinned prepared release into `~/.capability-tools` by default; it requires an SDK release with unified setup (0.3.1 or later), available from npm or GitHub Releases. It installs/repairs managed runtimes, creates missing tool configuration, and merges user-level MCP configuration for Cursor, Codex, Claude Code, Claude Desktop, VS Code, legacy Windsurf, and Devin. It does not install those applications or run Orbit, dev, or build. Source without `dist` requires a prepared SDK release. In the original Orbit workspace, `install-mcp.cmd` / `npm run mcp:setup` still reuse its prepared SDK.

To install a prepared SDK tarball into a separate tools directory:

```sh
node scripts/setup.mjs --project /path/to/tools --package /path/to/capability-sdk.tgz
```

An explicit `--package @cjfclonedeep/capability-sdk@<published-version>` also works. Without `--package`, existing SDKs are reused; a new directory installs the bootstrap package's matching version from npm. Unpublished versions require a prepared tarball. Explicit package selection installs/upgrades; existing local patches are not implicitly replaced. The published `capability-setup` executable provides the same bootstrap.

For projects with the SDK already installed:

```sh
npx --no-install capability-mcp setup
npx --no-install capability-mcp init all
npx --no-install capability-mcp setup --clients cursor,codex --dry-run
npx --no-install capability-mcp init all --scope project
```

`setup` installs runtimes and configures clients; `init` only configures clients. Both `setup` and `init all` default to user scope. Individual client initializers default to project scope where supported. Project scope supports Cursor, Codex, Claude Code and VS Code; desktop-only clients are skipped by `all`. Unsupported platforms are also skipped for client configuration. Runtime installation supports Windows x64 and the documented Debian/Ubuntu platforms, not macOS.

`all` means the supported client list, including configurations for applications not yet installed. Custom profiles/remote environments are not auto-discovered. `--project` fixes tool execution and artifact paths independently of configuration scope. Configuration uses absolute Node and SDK paths. Restart/reload clients and enable/trust MCP where required.

`--dry-run` performs no downloads or writes. Before the SDK is available it prints the installation plan; full client-file validation runs once dependencies are available. Existing SDK configuration is preflighted before runtime downloads. Existing unrelated settings and JSONC/TOML comments are preserved, changed files receive adjacent backups, and identical registrations are not rewritten. Conflicting server names fail; use `--name another-name` or edit that entry explicitly. Inline TOML server maps that cannot be appended safely require manual conversion to table sections. Concurrent edits abort; files are saved individually, so a later filesystem failure can leave earlier files completed with backups.

Node and tool runtimes are shared by client configurations; each client starts its own stdio server. Runtime downloads may take several GB. Linux OS packages may require root/passwordless sudo. API keys, databases, business providers and client-side approvals still need configuration. See [runtime details](RUNTIME.md) and [tool configuration](MCP-CONFIG.zh-CN.md).

Model downloads use resumable HTTP by default to avoid Xet transport stalls behind some proxies. Set `HF_HUB_DISABLE_XET=0` explicitly to opt into Xet.
