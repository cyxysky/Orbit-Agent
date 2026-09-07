# @webpilot/capability-code-sandbox

Bounded Python and JavaScript execution for agents. The portable core accepts
an injected executor. The local Node adapter is only for trusted single-machine
development; production deployments should use the HTTP runner in
`Dockerfile.code-sandbox`.

## TypeScript Agent framework integration

```ts
import { createNodeCodeSandboxCapability } from '@webpilot/capability-code-sandbox/node';

const provider = createNodeCodeSandboxCapability({
  workspaceDirectory: './agent-workspaces/code',
});
```

Register this provider with `mountCapabilities()`, expose the resolved
`codeSandbox` tool through the consuming framework, and inject the package Skill
before execution.

The tool accepts exact-version dependencies through `packages`, for example
`lodash@4.17.21` or `requests==2.32.3`. JavaScript dependencies are installed
with npm lifecycle scripts disabled; Python dependencies are installed into a
disposable target directory. The host must enforce the declared process,
network, and workspace policy in addition to the package's bounded runner.

JavaScript runs as Node.js ESM (`.mjs`): use `import`, including for installed
packages. Bare `require` is not defined; use `createRequire(import.meta.url)`
explicitly if needed. Each execution has a disposable directory. Write files
under `outputs/` (created by the runner), or list extra relative `outputFiles`.
The runner exports them before cleanup over a separate file channel: 16 files,
10 MB per file, 32 MB total. Symlinks and workspace escapes are rejected.
The application host persists them and returns `artifacts` with IDs, preview
URLs and download URLs. `readFile` reads content in bounded byte pages;
`inputFiles: [{ artifactId, path: 'inputs/file.png' }]` mounts a full saved file
in a later execution. Files remain available after runner cleanup and refresh.

Standalone framework hosts must persist the executor's internal `files` payload
and return artifact metadata, and implement `readFile` / artifact input lookup.
Never send the internal Base64 transport payload into the model transcript.

`maxOutputChars` optionally requests 1,000–200,000 combined stdout/stderr
characters, capped by `AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS` (default 30,000).
Excess output is discarded while the process continues under its timeout;
`truncated` and `outputLimitExceeded` mark incomplete captured output. Successful
process completion does not imply complete output. Return compact logs and use
file exports for binary data; stdout truncation does not truncate exported files.
Older remote runners
that kill on output overflow must be restarted/upgraded to use truncation.

## Production runner

For an existing trusted local HTTP-runner setup, run `npm run code-sandbox:start`
from the application root. This loads `.env.local` / `.env`, binds to the loopback
`AGENT_CODE_SANDBOX_RUNNER_URL`, and uses `AGENT_CODE_SANDBOX_RUNNER_TOKEN` (or
`CODE_SANDBOX_RUNNER_TOKEN`). Keep the runner process running alongside Orbit;
starting Orbit alone does not start this separate service. A refused connection
to its port means the runner is unavailable, not that the submitted code failed.
This local launcher does not provide container isolation.

Build and start the isolated runner beside the Orbit service:

```sh
docker compose up -d --build
```

Set `CODE_SANDBOX_RUNNER_TOKEN` to a long random value. The runner has no
Orbit artifacts or application environment mounted, runs as a non-root user,
uses a read-only root filesystem, and has container-level CPU, memory, process,
and temporary-space limits. Its outbound network is enabled so code and package
installation can use the network. This is intentionally full outbound network
access, not a domain allowlist; add an egress proxy/firewall before exposing
the runner to untrusted tenants. Use the `local` backend only in a trusted
development environment.
