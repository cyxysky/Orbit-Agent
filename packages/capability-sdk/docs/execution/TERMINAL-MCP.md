# Terminal over MCP

Install @cjfclonedeep/capability-sdk/execution/terminal, matching SDK/host packages and tsx as shown in [README](TERMINAL.md). Save server.ts in the consuming ESM project. This example explicitly grants a single user's local terminal access.

This guide describes a subpath of `@cjfclonedeep/capability-sdk@0.2.1`, not a separate npm package. The tools package includes the dependencies used by these examples.

```ts
// server.ts
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';
import { serveTerminalMcpStdio } from '@cjfclonedeep/capability-sdk/execution/terminal/mcp';

serveTerminalMcpStdio({
  provider: createNodeTerminalCapability({ cwd: process.cwd() }),
  configurations: {
    'com.webpilot.terminal': { AGENT_TERMINAL_ENABLED: 'true' },
  },
  skillMode: 'eager',
  policy: {
    authorize(permissions) {
      if (permissions.some(permission => permission !== 'process:terminal')) {
        throw new Error('Permission denied.');
      }
    },
  },
});
```

```sh
npx tsx server.ts
```

```json
{
  "mcpServers": {
    "terminal": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/server.ts"]
    }
  }
}
```

Configure the client's process cwd as your project directory, and use an absolute server path. On Windows use npx.cmd if the client requires an executable name. Keep stdout reserved for MCP; diagnostic logs go to stderr.

The server publishes terminal with run/read/write/stop. Forward server instructions and full structured results to the model. Keep one server/runtime for the whole process interaction. Configure client operation approval for run/write; permission hooks do not inspect command arguments. A shared server needs authenticated user identity and server-side action authorization.

createTerminalMcpServer returns an unconnected server; createTerminalMcpHandler returns an HTTP handler, not a listening server. The convenience HTTP handler has a per-request lifecycle and cannot retain process sessions. For stateful HTTP, create one server per authenticated MCP session, keep it until disconnection, and close it to terminate processes. See the [listening stateful HTTP example](../../../capability-sdk/docs/adapters/MCP-ADAPTER-MCP.md). No helper provides authentication, isolation or file hosting automatically.
