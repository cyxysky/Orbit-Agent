# Executable extensions

`@cjfclonedeep/capability-sdk/extensions/node` supplies an extension manager and ordinary SDK capability providers. The host binds a fixed workspace, read-only project root, permission ceiling and authorization callbacks. Extensions do not need the terminal, browser or knowledge tools.

```ts
import { createExtensionManager } from '@cjfclonedeep/capability-sdk/extensions/node';

const extensions = createExtensionManager({
  directory: '/application-data/extensions',
  projectRoot: '/application',
  projectDeniedPaths: ['runtime', 'node_modules'],
  allowedPermissions: ['storage:read', 'storage:write', 'project:read'],
  authorizeManagement(context) { /* Require the host's owner/admin grant here. */ },
  authorizeInvocation(context) { /* Apply the host's invocation policy here. */ },
});
// Include extensions.capability() to expose selfBootstrap.
// At the NEXT Agent execution boundary:
const snapshot = await extensions.snapshot();
// Mount snapshot.providers with the existing SDK registry/adapters.
```

The manager accepts TypeScript or JavaScript modules. These are executable modules, unlike registered configuration fields.

```ts
export const manifest = {
  name: 'Text statistics', version: '1.0.0',
  description: 'Count Unicode characters in supplied text', permissions: [],
};
export default function (api) {
  api.registerTool({
    name: 'count', description: 'Count characters',
    parameters: {
      type: 'object', properties: { text: { type: 'string' } },
      required: ['text'], additionalProperties: false,
    },
    async execute(input, ctx) {
      return { summary: 'Counted characters', data: { characters: Array.from(input.text).length } };
    },
  });
}
```

Tools are exposed as `ext_<extension-id>__<tool-name>`, with at most 64 characters including the namespace. Return JSON data or `{summary, data}`; throw on failure. Tool input JSON Schema is checked when validating the module and is mounted unchanged through the SDK. Schemas support bounded structural objects/arrays, primitive types, enums, required fields and numeric/length limits, with at most eight nested levels and 64 properties per object. Regex, references and executable/custom validation keywords are rejected so validation cannot escape guest execution limits. Input is capped at 256,000 characters. Type-only imports of `ExtensionAPI`/`ExtensionContext` from the SDK are erased during TypeScript compilation; runtime imports are unavailable.

## Lifecycle

1. `selfBootstrap {action:'write',id,source}` saves a draft. Replacing one requires its `expectedRevision` from `read`/`list`.
2. `{action:'validate',id}` checks syntax, initializes the isolated module, and validates manifest/tool definitions. It explicitly does **not** assert functional acceptance.
3. `{action:'probe',id,tool,input,expectedRevision}` invokes the current validated draft. Declared storage writes are real, per-user effects.
4. `{action:'activate',id,expectedRevision}` publishes that exact immutable revision. New Agent executions see its providers; existing providers keep their captured revision and source.
5. `{action:'disable',id,expectedRevision}` removes the active pointer. `{action:'rollback',id,revision,expectedRevision}` selects a retained version. Neither changes a running execution.
6. `{action:'remove',id}` requires an inactive extension, then removes its drafts, retained versions and private state. `list` reports the current revisions and retained history.

Rollback selects code; it does not undo private storage changes made by probes or earlier tool invocations. Cancellation and execution-budget termination can interrupt guest cleanup hooks. Declare and inspect storage effects separately from code activation.

The latest eight validated revisions plus an older currently active revision are retained. Registration for identical source must be deterministic. Listing is paginated (five extensions by default, at most twenty); history lists metadata without repeating source or parameter schemas. At most sixteen extensions and sixty-four extension tools can be active. There is no automatic deployment, service restart, core source patching, or background self-improvement loop.

`api.on('load', handler)`, `beforeInvoke`, `afterInvoke`, and `unload` are invocation lifecycle hooks. Each invocation uses a fresh runtime; retain state with `ctx.storage`, not process globals. `load`/`unload` receive `ctx`; `beforeInvoke` receives `{tool,input}, ctx`; `afterInvoke` receives `{tool,result}, ctx`.

## Execution boundary

The host compiles TypeScript in a worker, then evaluates it in QuickJS/WASM. Extension code never runs as a Node module. Node globals, process/environment, module imports, arbitrary shell, network and native modules are not exposed. A module may not access host data while registering tools.

Only these explicit APIs cross the boundary:

| API | Required permission | Scope |
| --- | --- | --- |
| `ctx.storage.get(key)` | `storage:read` | Extension and application-user private JSON state |
| `ctx.storage.set(key,value)`, `.remove(key)` | `storage:write` | The same private state; values capped at 256 KB |
| `ctx.project.readText(relativePath)`, `.list(relativePath='')` | `project:read` | Read-only pinned project root, excluding host-protected paths |

Absolute paths, traversal, symbolic links and junctions are rejected by the file bridge. Project hidden paths are protected. No API writes core project files. The initial limits are 128,000 source characters, a 16 MiB QuickJS heap, 1.5 seconds of guest execution, a 15 second worker wall deadline, 100 host operations and 512 KB of result JSON. Abort signals terminate workers. Workers are created lazily and terminated after each invocation; a manager runs at most two workers concurrently and queues at most sixteen. Immutable source snapshots share a bounded revision cache across executions.

Keep application data in a directory protected from unrelated host processes. This execution boundary governs extension code and its exposed APIs; it does not isolate other independently enabled host tools.

## Distribution

The SDK publishes the extension manager, worker and runtime dependencies. A packaged host can load external extension sources without the application's development source tree, npm install, or rebuilding the application. Updating the core frontend/backend remains the host's normal release/update workflow.
