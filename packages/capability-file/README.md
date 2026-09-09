# @webpilot/capability-file

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Read and publish files, generate and edit Office documents, and manage artifact workspaces.

This README is a complete integration entrypoint. Follow steps 1–4 for any TypeScript Agent framework, or use the AI SDK/MCP routes below. All named source files are created in **your consuming project**, not inside this package.

## 1. Install and prepare

Use Node.js >=22.16 and ESM TypeScript. These examples match the 0.1.0 workspace contracts. Install matching Capability versions from your configured npm registry. If a version is unpublished, obtain the matching release tarballs/workspace packages from the maintainer; a registry 404 is not a runtime failure. Do not mix unrelated releases. For a new project:

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-file @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

The first call only writes UTF-8 text; it needs no Office installation. `plan → generate → render` creates Office artifacts; read the package Skill and the plan's engine/API guidance before authoring. Local Office conversion needs LibreOffice; UNO authoring additionally needs a Python interpreter that can import `uno`. JavaScript authoring and conversion are separate requirements. Set `OFFICE_GENERATION_MODE` deliberately.

`readSource(documentId)` reads generation code; `readContent(artifactId)` reads published content. `edit` uses the exact `patchBaseDigest` returned by `readSource`; render again after an edit. Enable visual input only when your host supplies `readFileVisuals` and actually passes images to the model. Attachments require `attachmentBindings` or a host `readFile` implementation.

The default artifact URL is a server-local `file:` URL. Remote clients cannot download it. Supply `workspace.artifactUrl({ absolutePath, relativePath })` and an authenticated download route/object store that serves the corresponding bytes; generating a URL alone does not serve a file. Keep the same run ID while accessing a run's drafts and artifacts.

## 2. Create the provider

Save as `provider.ts`. This file creates the provider and exports the first valid call, explicit configuration overrides and host cleanup.

```ts
import { createNodeFileCapability, disposeUnoRuntime } from '@webpilot/capability-file/node';
 const provider = createNodeFileCapability({
   workspace: { artifactsRoot: './agent-data/files' },
   visualInputAvailable: false,
 });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "file",
  "input": {
    "action": "write",
    "fileName": "hello.md",
    "content": "# Hello\n\nCreated by the file capability.\n"
  }
};
export async function cleanup() { await disposeUnoRuntime(); }
```

## 3. Mount, validate and execute

Save as `integration.ts`. There is one shared executor per run, preserving serial concurrency groups. Parsing, cancellation, policy hooks and cleanup are part of the integration, not optional model behavior.

```ts
import { randomUUID } from 'node:crypto';
import { mountCapabilities, EnvironmentCapabilityConfigStore } from '@webpilot/capability-host';
import { createCapabilityExecutor, disposeOnce,
  type CapabilityExecutionPolicyOptions } from '@webpilot/capability-sdk';
import { providers, configurations, cleanup } from './provider.js';

export async function openCapabilities(options: {
  policy: CapabilityExecutionPolicyOptions;
  signal?: AbortSignal;
  beforeInvoke?: (name: string, input: unknown) => void | Promise<void>;
}) {
  const mounted = await mountCapabilities({
    providers, configurations,
    context: { runId: randomUUID(), abortSignal: options.signal },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
  }).catch(async error => { await cleanup(); throw error; });
  const execute = createCapabilityExecutor(options.policy);
  const tools = Object.values(mounted.tools).map(resolved => ({
    name: resolved.publicName,
    description: resolved.tool.description,
    inputSchema: resolved.tool.input.jsonSchema,
    inputExamples: resolved.tool.inputExamples,
    async execute(rawInput: unknown, call: { id?: string; signal?: AbortSignal } = {}) {
      const signals = [mounted.abortSignal, call.signal].filter(
        (value): value is AbortSignal => Boolean(value));
      const context = { invocationId: call.id || randomUUID(),
        abortSignal: signals.length ? AbortSignal.any(signals) : undefined };
      try {
        const input = resolved.tool.input.parse(rawInput);
        await options.beforeInvoke?.(resolved.publicName, input);
        return await execute(resolved, context,
          execution => resolved.tool.execute(input, execution));
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        return { ok: false as const, error: {
          code: 'host-tool-invocation-failed',
          message: error instanceof Error ? error.message : String(error),
        } };
      }
    },
  }));
  return {
    tools,
    instructions: mounted.skillCatalog.instructions('eager'),
    snapshot: mounted,
    dispose: disposeOnce(async () => {
      try { await mounted.dispose(); } finally { await cleanup(); }
    }),
  };
}
```

Save as `policy.ts`. This explicitly configured single-user example grants its selected providers. In a shared Agent, connect these hooks to your existing authenticated permission and action approval logic. Prerequisites declared by a tool need a `policy.prerequisite` handler; it must verify the named condition or throw.

```ts
import type { CapabilityExecutionPolicyOptions } from '@webpilot/capability-sdk';
import { providers } from './provider.js';

// This sample host grants the permissions of its explicitly configured providers.
// Replace this set with your authenticated user's grants in a shared service.
const grants = new Set(providers.flatMap(provider => [...(provider.manifest.permissions || [])]));
export const policy: CapabilityExecutionPolicyOptions = {
  authorize(permissions) {
    for (const permission of permissions) {
      if (!grants.has(permission)) throw new Error(`Permission denied: ${permission}`);
    }
  },
  reportProgress(event) { console.error(event.phase, event.message); },
};

// Put your existing action/draft approval check here, before calling the tool.
// No additional action-level approval is configured by this single-user example.
export async function beforeInvoke(_name: string, _input: unknown): Promise<void> {}
```

Save as `first-call.ts`, then run `npx tsx first-call.ts`. No model/API key is needed for this first call; the provider-specific prerequisites above still apply.

```ts
import { openCapabilities } from './integration.js';
import { exampleCall } from './provider.js';
import { policy, beforeInvoke } from './policy.js';
const runtime = await openCapabilities({ policy, beforeInvoke });
try {
  const tool = runtime.tools.find(tool => tool.name === exampleCall.name);
  if (!tool) throw new Error(`Tool not mounted: ${exampleCall.name}`);
  const result = await tool.execute(exampleCall.input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally { await runtime.dispose(); }
```

## 4. Attach to your Agent

Map the returned objects to your framework's native tool registration. These are real fields, not a dependency on a hypothetical `createAgent` API:

| This integration | Your Agent |
| --- | --- |
| `runtime.tools[].name` | Tool name |
| `.description` | Model-visible description |
| `.inputSchema` | JSON Schema / native schema converter |
| `.execute(input, { id, signal })` | Tool callback; pass the model call ID and cancellation |
| `runtime.instructions` | Append to the system/Agent instructions before the first model call |
| `runtime.dispose()` | Await after the entire run/session finishes |

On each model step: send the tools and instructions → receive a tool call → parse its JSON arguments once if the framework supplies a string → find the tool by its exact name → await `execute` → append the **complete result** as a tool-result message associated with that same call ID → call the model again. Stop when the model returns a final answer or your step/cancellation limit is reached. Keep the mounted runtime alive through this loop.

Preserve `ok`, `data`, `content`, and `error` (including code/retryable/details), not just summary. For text-only results use `JSON.stringify(result)`. For vision, map image bytes to your model's native image parts; a stored path or JSON serialization is not an image input. Use artifact URLs without inventing IDs or URLs. Lazy Skill loading needs an explicit Skill reader and host-owned loaded-state/availability rules; the eager example avoids that additional integration.

The next section is a complete concrete Agent implementation using AI SDK. For other frameworks only the native tool/model/message mapping changes; the capability execution boundary above stays the same.

## AI SDK: complete model-driven Agent

```sh
npm install @webpilot/capability-adapter-ai-sdk "ai@>=7 <8" @ai-sdk/openai-compatible
```

Use a chat-completions-compatible provider that supports tools. Set `AGENT_MODEL_BASE_URL` (including its API prefix), `AGENT_MODEL_ID`, and optionally `AGENT_MODEL_API_KEY` in the process environment. Save as `agent.ts` alongside `provider.ts` and `policy.ts`, then run `npx tsx agent.ts "your task"`. This is an alternative to first-call.ts, not a second mount inside it. The initial prompt only asks for tool descriptions; supply your intended task to execute operations.

```ts
import { randomUUID } from 'node:crypto';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { mountAISDKCapabilities, EnvironmentCapabilityConfigStore } from '@webpilot/capability-adapter-ai-sdk';
import { providers, configurations, cleanup } from './provider.js';
import { policy, beforeInvoke } from './policy.js';

const baseURL = process.env.AGENT_MODEL_BASE_URL;
const modelId = process.env.AGENT_MODEL_ID;
if (!baseURL || !modelId) throw new Error('Set AGENT_MODEL_BASE_URL and AGENT_MODEL_ID');
const modelProvider = createOpenAICompatible({ name: 'agent-provider', baseURL,
  apiKey: process.env.AGENT_MODEL_API_KEY });
const abort = new AbortController();
const cancel = () => abort.abort(new Error('Agent interrupted'));
process.once('SIGINT', cancel);
let runtime: Awaited<ReturnType<typeof mountAISDKCapabilities>> | undefined;
try {
  runtime = await mountAISDKCapabilities({
    providers, configurations,
    context: { runId: randomUUID(), abortSignal: abort.signal },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
    skills: { mode: 'eager' },
    adapter: { policy, async execute(call) {
      await beforeInvoke(call.resolvedTool.publicName, call.input);
      return call.invoke();
    } },
  });
  const agent = new ToolLoopAgent({ model: modelProvider.chatModel(modelId),
    ...runtime.agentOptions, stopWhen: stepCountIs(10) });
  const result = await agent.generate({
    prompt: process.argv[2] || 'Describe the available tools and their intended usage.',
    abortSignal: abort.signal,
  });
  console.log(result.text);
} finally {
  process.removeListener('SIGINT', cancel);
  try { await runtime?.dispose(); } finally { await cleanup(); }
}
```

## MCP: stdio, HTTP server and client

Use the self-contained [MCP tutorial](MCP.md) shipped with this package. It includes dependency installation, a stdio process, a listening stateful HTTP server, client discovery/calls, a model-driven client Agent, cancellation, authentication boundaries and shutdown. Reuse provider.ts and policy.ts above. A remote client needs only the MCP URL and client dependencies; it does not import this capability.

Do not expose a server-local file URL as a remote download. Follow this package's artifact/storage requirements above. The MCP server owns the execution environment; the caller's local files, browser and desktop are not automatically available there.

## Configuration and lifecycle

Settings belong to `provider.manifest.configuration.settings`. Inspect each definition for key, defaultValue, control, secret, range/options and applyMode; generate your settings UI from these definitions. Values are strings. Environment values are read only when you supply EnvironmentCapabilityConfigStore; explicit configurations[capabilityId] override stored/environment values. Configuration is injected when mounting. Use a stable user/workspace scope for durable state and remount when applicable settings change. Await disposal, including after model failure/cancellation.

The following table lists literal defaults from the package settings; dynamic definitions remain available through the manifest. `runtime` means remount for the new run; `startup` also requires restarting the owning driver/service.

| Key | Default | Apply mode |
| --- | --- | --- |
| `OFFICE_GENERATION_MODE` | `uno` | `runtime` |

## Troubleshooting and completion criteria

- Module not found: check published exports, aligned versions and Node/ESM setup; install the selected entrypoint's optional peers.
- Tool missing: inspect `runtime.tools`, enabled capability IDs and allowed names; do not guess names from folder names.
- Validation failure: use the actual inputSchema and parser error, not a copied schema from a different entrypoint.
- Disabled/unavailable operation: check normalized settings, selected backend, installed binaries and supplied host callbacks.
- Skill not followed: append eager instructions before the model call, or implement the lazy reader and availability policy.
- A timeout is not proof that a side effect did not happen. Inspect stored/live state before retrying.
- Integration is complete when the first call returns `ok: true`, the Agent receives the same tool schema and full result, required artifacts/images are usable by the caller, and the owning runtime closes without leaked resources.

## Published entrypoints

- `@webpilot/capability-file`
- `@webpilot/capability-file/node`
- `@webpilot/capability-file/formats`
- `@webpilot/capability-file/office`
- `@webpilot/capability-file/runtime-skill`
- `@webpilot/capability-file/settings`
- `@webpilot/capability-file/mcp`
- `@webpilot/capability-file/node/artifacts`
- `@webpilot/capability-file/node/convert`
- `@webpilot/capability-file/node/download`
- `@webpilot/capability-file/node/generate`
- `@webpilot/capability-file/node/office`
- `@webpilot/capability-file/node/read`
- `@webpilot/capability-file/node/text-extraction`
- `@webpilot/capability-file/node/workspace`

## Serve generated files to remote clients

For a complete single-principal download path, save the following as artifact-server.ts and run `npx tsx artifact-server.ts` in a separate terminal. It serves the same File workspace root, verifies resolved paths (including symlinks), and streams bytes. Use an absolute FILE_ARTIFACTS_DIR shared by both processes when their working directories differ. Configure FILE_BIND_ADDRESS/FILE_PORT and put HTTPS in front for remote use. FILE_DOWNLOAD_TOKEN is an optional local / required remote Bearer token. This route treats one root as one principal; a multi-user application must look up artifact ownership before resolving a path.

Replace the provider creation with the second block, retaining the existing exports and cleanup. FILE_PUBLIC_URL is the origin or mounted base path reachable by the client. If download authentication is enabled, clients must send the Bearer header; for browser links, integrate your application session or generate short-lived signed URLs. The tool does not embed credentials in the URL.

```ts
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { artifactContentType } from '@webpilot/capability-file/formats';
const directory = path.resolve(process.env.FILE_ARTIFACTS_DIR || './agent-data/files');
await mkdir(directory, { recursive: true });
const root = await realpath(directory);
const port = Number(process.env.FILE_PORT || 3101);
const hostname = process.env.FILE_BIND_ADDRESS || '127.0.0.1';
const token = process.env.FILE_DOWNLOAD_TOKEN;
if (!['127.0.0.1', '::1'].includes(hostname) && !token) throw new Error('Set FILE_DOWNLOAD_TOKEN');
const server = createServer((req, res) => { void (async () => {
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end(); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const url = new URL(req.url || '/', 'http://localhost');
  if (!url.pathname.startsWith('/artifacts/')) { res.writeHead(404).end(); return; }
  const relativePath = decodeURIComponent(url.pathname.slice('/artifacts/'.length));
  const candidate = await realpath(path.resolve(root, relativePath));
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    res.writeHead(403).end(); return;
  }
  const info = await stat(candidate);
  if (!info.isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {
    'content-type': artifactContentType(candidate),
    'content-length': String(info.size), 'x-content-type-options': 'nosniff',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(candidate))}`,
    'cache-control': 'private, no-store',
  });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(candidate), res);
})().catch(error => {
  console.error(error);
  if (!res.headersSent) res.writeHead(404).end(); else res.destroy();
}); });
server.listen(port, hostname, () => console.error(`Artifact server listening on ${hostname}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.close(); server.closeAllConnections(); });
}
```

```ts
import { createNodeFileCapability, disposeUnoRuntime } from '@webpilot/capability-file/node';
const publicBase = process.env.FILE_PUBLIC_URL || 'http://127.0.0.1:3101';
const provider = createNodeFileCapability({
  workspace: {
    artifactsRoot: process.env.FILE_ARTIFACTS_DIR || './agent-data/files',
    artifactUrl: ({ relativePath }) => publicBase.replace(/\/$/, '') + '/artifacts/'
      + relativePath.split(/[\\/]/).map(encodeURIComponent).join('/'),
  },
  visualInputAvailable: false,
});
// Retain provider.ts's providers, configurations, exampleCall and cleanup exports.
```

## Additional package reference

The following pre-existing reference includes focused API fragments and application integration notes. The complete runnable entrypoints are the numbered tutorial above; do not concatenate unrelated snippets.

## @webpilot/capability-file

An agent-framework-neutral file artifact capability.

The package owns one public `file` contract with a dynamically configured JSON Schema,
transport normalization, validation, manifests, action dispatch, runtime skill,
Office document model, and shared file-format/MIME registry. Agent frameworks
are optional: call the exported operations directly, or expose them as tools
through `FileCapabilityOperations` and `@webpilot/capability-sdk`.

`@webpilot/capability-file/node` includes reusable filesystem-backed adapters:

- artifact path safety, metadata, URL mapping, unique naming, and hashing;
- a downloader with bounded streaming, per-origin concurrency, retry handling,
  URL caching, AbortSignal support, and lifecycle disposal;
- configurable LibreOffice discovery, UNO-compatible Python discovery, and
  cancellable Office conversion;
- an Office-to-PDF artifact converter with injected artifact URL, conversion,
  runtime-health, and preview-rendering contracts;
- JavaScript and Python/UNO Office authoring runtimes with package-owned workers;
- semantic Word, PowerPoint, and Excel templates with versioned themes, default
  layout repair, and deterministic compilation into the validated UNO pipeline;
- DOCX structure inspection and DOCX/XLSX/PPTX generation;
- Office source analysis, artifact validation, rendering validation, preview
  generation, attachment reading, and bounded worker-based text extraction.

The default converter runs local LibreOffice. Hosts may instead inject a remote
conversion function, so consumers are not tied to Orbit, AI SDK, or a local
Office installation.

### Diagram design references

The main File Artifact Runtime Skill routes diagram work to five optional references
published in the same capability manifest: `system-file-diagram-design` (layout and
Office mapping), `system-file-diagram-structure`, `system-file-diagram-process`,
`system-file-diagram-time`, and `system-file-diagram-data`.
Read a relevant reference through the host's existing `skill` action using its exact
ID. Reference bodies are not embedded in the main Skill and do not add activation
gates to ordinary file operations. The shared capability adapters expose the full
manifest Skill list; Browser Chat registers the same list.

The guidance adapts selected Diagram Design principles to native JavaScript/UNO
authoring and existing file QA. It adds no HTML-to-Office converter, drawing API,
font dependency or fixed visual theme. The package's current license material is included under [licenses/](licenses/).

### PDF and notebook authoring references

`system-file-pdf-authoring` adds page-layout and final-PDF inspection guidance.
`system-file-jupyter-notebook` provides experiment/tutorial structure, a valid
notebook JSON starter, and reproducibility checks. Both are optional Skills in
the capability manifest and are read on demand through the existing Skill tool.
Notebook files use `file.write` with `.ipynb` JSON and the shared format registry;
writing a notebook does not execute a kernel. PDF uses the existing Office/export
and visual QA workflow. OpenAI source revision, adaptation details and Apache-2.0
license are included in [license material](licenses/).

### Source, content, and visual reads

Create downloadable text, code, or configuration files with
`file({ action: 'write', fileName: 'notes.md', content: '# Notes\n' })`.
The shared Node adapter saves UTF-8 bytes verbatim, preserving indentation,
line endings, trailing whitespace, and empty files (up to 1,000,000 characters).
Markdown, TXT, HTML, JS, CSS, JSON, YAML, CSV, SVG and custom text extensions use
the same operation. No Office runtime or draft is needed, and code is not executed.
Each write creates an immutable artifact and returns its `artifactId` and download
URL; read it with `readContent`. Known binary formats need their own generator.

The model-facing actions deliberately use different names and identities:

| Purpose | Call |
| --- | --- |
| Find an existing draft | `file({ action: 'list' })` |
| Read generation code | `file({ action: 'readSource', documentId, startLine: 1, endLine: 80 })` |
| Read Excel cells / Word text / PDF text | `file({ action: 'readContent', artifactId, offset: 0, limit: 2000 })` |
| Read an upload's content | `file({ action: 'readContent', attachmentId })` |
| Inspect rendered pages | `visualIndex` then `visualRead`, using the current `artifactId` and returned `screenshotIds` |

`readSource` returns `program` and `patchBaseDigest`; pass that exact digest as
`edit.baseDigest`. `readContent` is not the generator source and cannot supply
code to patch. Its limits count characters, not source lines; the default is
8,000 characters, and an explicit smaller limit is honored. Page previews are
opt-in (`includeVisuals: true`), not a side effect of ordinary text reads.

Content reads can select `sheet` and an A1 `range` for spreadsheets, `contentPages`
for one-based PDF text pages, or `section` for an exact, unique DOCX heading.
`pages` retains its visual-preview meaning. Character offsets apply within the
selected content. A range requires a sheet name for multi-sheet workbooks and is
limited to 100,000 cells; ambiguous headings return an error instead of choosing one.

Text extraction caches results by SHA-256, parser version and content selection.
Changing only offset/limit reuses the extraction. Worker slots remain warm for
`CPU_WORKER_IDLE_TIMEOUT_MS` (default 30 seconds). Limits are configurable through
`CPU_WORKER_COUNT`, `CPU_WORKER_MAX_QUEUED`, `CPU_WORKER_QUEUE_TIMEOUT_MS`,
`CPU_WORKER_TASK_TIMEOUT_MS`, `CPU_WORKER_MAX_FILE_BYTES`, `CPU_WORKER_MAX_HEAP_MB`
and `CPU_WORKER_TEXT_CACHE_BYTES`. Queued reads support cancellation, and running
reads release their slot only after worker cleanup. The worker ships in `runtime/`.

UNO and JavaScript authoring, draft locks and per-origin downloads also use bounded,
cancellable queues. Host resources, draft transactions, source editing, result
formatting and visual QA are implemented in separate internal modules while keeping
the existing workspace exports.

`createNodeFileDownloadReceiver` accepts browser download streams and persists them
under the run's `downloads/` directory. It does not refetch the source URL. The Node
provider's default `readContent` reads artifacts within its run and explicitly
registered attachments; a host `readFile` adapter can override that behavior.

Source reads return one copy of the exact code, source coordinates, the patch
digest, validation status and diagnostic counts. Use `includeDiagnostics: true`
only to retrieve missing saved validation details; it does not rerun validation.
Capability `summary` is a short label, never a second serialized copy of `data`.
Calc setters can reuse an element ID for updates to the same cell/range, format,
row height or column width. Different targets and object creation still receive
collision warnings; ordinary property updates retain the ID and latest source location.

Mixed source/content identities are rejected with corrective instructions.
`reason` never changes routing. Old `read` calls remain accepted at the transport
boundary, but normalize to `readSource` or `readContent` and are not advertised
in the model action enum. Legacy host adapters implementing only `read` remain
usable through the dispatcher. New adapters should implement the explicit actions.

Draft catalogs and render results expose `sourceRead`; published artifacts also
expose `contentRead`. Preserve these distinctions in host file registries and
context-compaction summaries. Repair workflow: `readSource → edit → render`;
do not regenerate unchanged source to reread data or previews.

Use the package directly with any agent framework, or register it with
`@webpilot/capability-sdk` and adapt the resolved tools to the framework used by
the application. The
[TypeScript Agent framework integration guide](../capability-sdk/FRAMEWORK_INTEGRATION.md)
shows the complete `mountCapabilities()` registration, tool conversion, Skill
injection, execution, result handling, and disposal flow.

Import only the layer an application needs:

```ts
import { createFileCapability } from '@webpilot/capability-file';
import { createNodeFileDownloader } from '@webpilot/capability-file/node/download';
import { readFileAttachment } from '@webpilot/capability-file/node/read';
import { generateUnoProgramDocument } from '@webpilot/capability-file/node/office';
import { createNodeFileWorkspace } from '@webpilot/capability-file/node/workspace';
```

#### Safe source editing

`edit` accepts either exact `replacements` or Codex-format `patch`, with the
current `readSource.patchBaseDigest`. Both modes locate every target on the
same original source snapshot. Targets must be unique and non-overlapping;
whitespace and punctuation are never fuzzy-matched. Optional source-unit paths
scope the edit. The entire batch commits or none of it does, including related
helper/caller changes. Conflict results identify `failed` and withheld `blocked`
hunks, with `changed=false` and `saved=false`.

Stale revisions are rejected, not automatically rebased. A persisted receipt
deduplicates only the identical latest request at its exact resulting source
revision. Finding the new text elsewhere is not evidence that an edit happened.
Validation-failed source remains an editable buffer: `saved=true` does not mean
`validation=passed`. Structured model results preserve these states and the new
`patchBaseDigest`, including conflict information from historical partial edits.

UNO API lookup prioritizes exact versioned/unversioned module IDs. Unknown
versions return the module index, not unrelated search matches. Keyword searches
ignore numeric version tokens and require all terms. Catalog caching includes
the worker digest; metadata writes use the same document lock as source edits.

New Office documents can use the compact semantic path instead of authoring a
raw program. The default layout policy enforces readable type and safe margins,
uses contained images, splits long slide text/lists/tables, repeats table
headers, and configures spreadsheet widths, frozen headers, and print layout:

```ts
import { generateFileBuffer } from '@webpilot/capability-file/node/generate';

const result = await generateFileBuffer({
  schemaVersion: '1.0',
  documentType: 'presentation',
  fileName: 'review.pptx',
  document: { title: 'Quarterly review', language: 'en' },
  theme: 'executive',
  blocks: [
    { id: 'cover', type: 'page', template: 'cover', title: 'Quarterly review' },
    { id: 'summary', type: 'page', template: 'kpi', title: 'At a glance', children: [
      { id: 'revenue', type: 'metric', title: 'Revenue', text: '$4.2M' },
      { id: 'growth', type: 'metric', title: 'Growth', text: '+18%' },
    ] },
  ],
});
```

The workspace tool exposes the same path as `action=generate` with `spec` when
the preceding plan returns `semanticGeneration.available=true`. Follow
`semanticGeneration.recommended` when selecting this path: availability is not
a recommendation to use fixed geometry for original design.

#### Content-led design

Initial `plan` calls may include a compact `design` brief:

- `mode: "template"`: conventional fast documents. Preset colors, fonts and
  typography are editable starting tokens, even without supplied brand assets.
- `mode: "bespoke"`: audience, objective, 2–3 directions (each with `id`,
  `concept`, `composition`, `typography`, `imagery`), `selectedDirection`,
  `selectionReason`, and `rhythm`. A binding user `reference` allows one
  direction. Optional `preserve`/`avoid` lists record constraints and unwanted
  motifs; do not duplicate the full content in the brief.

The brief is validated and saved with the draft. Plan results, including the
model-facing compact result, preserve the brief and `designGuidance`.
Bespoke work is recommended to use custom `program` authoring, with blank
slides, grids/stacks and content-led geometry rather than the semantic
compiler's fixed slots. Bounds, native object, font and render validation
remain in force. No engine switch or fixed theme is implied. High-design
intent can recommend this route for older callers, but keyword matching does
not reject existing workflows or override an explicit mode.

Resolve representative compositions before expanding, inspect them first in
the first valid render, and reuse the same draft. If feature validation needs
the full document, do not force a partial prototype through it. Final review
still covers every page. Bespoke plans additionally require
`deckReview.checks.designIntent` and `compositionRhythm`; consistency means
coherent visual rules, not identical page layouts or a quota of variations.
This records an evidence-backed model review, not an automatic aesthetic score.

Authored-workspace re-planning remains idempotent: it does not overwrite the
original brief or source. Bounded source reads do not repeat the brief;
unbounded `readSource` can recover it after context compaction. Existing-file
modification still preserves the original unless the user requests redesign.

For a ready-to-register Node provider:

```ts
import { createNodeFileCapability } from '@webpilot/capability-file/node';

const provider = createNodeFileCapability({
  workspace: { artifactsRoot: './artifacts' },
  visualInputAvailable: false,
});
```

For the optional AI SDK adapter, install `@webpilot/capability-file` and
`@webpilot/capability-adapter-ai-sdk`, then mount the provider in one call:

```ts
import { createNodeFileCapability } from '@webpilot/capability-file/node';
import { mountAISDKCapabilities } from '@webpilot/capability-adapter-ai-sdk';

const fileRuntime = await mountAISDKCapabilities({
  providers: [createNodeFileCapability({
    workspace: { artifactsRoot: './artifacts' },
    visualInputAvailable: false,
  })],
  context: { runId: crypto.randomUUID() },
  configurations: {
    'com.webpilot.file': { OFFICE_GENERATION_MODE: 'auto' },
  },
  skills: { mode: 'lazy' },
});
```

`@webpilot/capability-host` is not a dependency of the File core. The AI SDK
adapter brings it transitively for one-call mounting; direct Provider consumers
can continue to use File without the host API.

Set `visualInputAvailable` from the active model's image-input capability. When
it is false, the `file` schema omits `visualIndex`, `visualRead`,
`visualReport`, and their visual-only parameters.

The host may inject attachment readers, visual readers, URL mapping, download,
conversion, preview, and storage behavior. `@webpilot/capability-file/mcp`
exposes the same provider through stdio or Streamable HTTP; the included
`webpilot-file-mcp` executable uses `CAPABILITY_FILE_ARTIFACTS_DIR` (or
`ARTIFACTS_DIR`).

The package resolves its Office workers from the published `runtime/` directory.
Packaged hosts may instead set `CAPABILITY_FILE_RUNTIME_DIR`, and may override the
individual Python worker with `LIBREOFFICE_UNO_PROGRAM_WORKER_PATH`.
