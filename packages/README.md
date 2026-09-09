# Capability packages: integration guide

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

For package development, relative imports must name the actual source file (for
example, `./types.ts` or `./react.tsx`). The shared TypeScript configuration enables
`rewriteRelativeImportExtensions`, so package compilation emits JavaScript paths
such as `./types.js`. This lets Turbopack and Webpack consume the same source without
extension aliases. Consumers continue to import the published `@webpilot/*` entries.

Start with the README of the capability you need. Every package now includes an English, Simplified Chinese and Japanese integration tutorial. The named examples belong in the consuming project. Ordinary capabilities share SDK contracts; host mounts them; AI SDK and MCP are optional adapters. Sensitive-data instead wraps the final model call.

| Package | Purpose |
| --- | --- |
| [capability-adapter-ai-sdk](capability-adapter-ai-sdk/README.md) | Adapt Capability providers to AI SDK 7 tools and Agent instructions. |
| [capability-adapter-mcp](capability-adapter-mcp/README.md) | Publish Capability providers through MCP, independently of the consuming Agent framework. |
| [capability-browser](capability-browser/README.md) | Control a Playwright browser with a persistent JavaScript environment and page observations. |
| [capability-chart](capability-chart/README.md) | Create, persist and edit ECharts/Three.js chart records; optionally render them in React. |
| [capability-code-sandbox](capability-code-sandbox/README.md) | Run bounded JavaScript/Python computations with a replaceable executor. |
| [capability-communication](capability-communication/README.md) | Create message drafts and send them through configured channels with delivery receipts. |
| [capability-computer](capability-computer/README.md) | Observe and operate an interactive desktop through a local or remote driver. |
| [capability-connectors](capability-connectors/README.md) | Discover and call external MCP, OpenAPI or custom operations. |
| [capability-data](capability-data/README.md) | Discover SQL sources and execute bounded queries through injected drivers. |
| [capability-file](capability-file/README.md) | Read and publish files, generate and edit Office documents, and manage artifact workspaces. |
| [capability-git](capability-git/README.md) | Inspect and explicitly modify one host-selected Git repository. |
| [capability-host](capability-host/README.md) | Mount providers with normalized configuration, tool selection and a portable Skill catalog. |
| [capability-knowledge](capability-knowledge/README.md) | Persist reference documents and search their indexed text. |
| [capability-media](capability-media/README.md) | Inspect media, extract frames, and connect host-selected OCR, transcription and generation engines. |
| [capability-sdk](capability-sdk/README.md) | Define portable Capability contracts and shared execution/lifecycle primitives. |
| [capability-workflow](capability-workflow/README.md) | Persist dependency-aware workflows and verified checkpoints. |
| [capability-sensitive-data](capability-sensitive-data/README.md) | Final model-boundary redaction middleware |

## Choose an integration path

1. Custom TypeScript Agent: concrete provider → host.mountCapabilities → native tool/schema mapping → Agent loop. The [complete framework guide](capability-sdk/FRAMEWORK_INTEGRATION.md) includes a working provider, parser, execution policies, Skills, first call and model-driven Agent.
2. AI SDK 7: install capability-adapter-ai-sdk and use mountAISDKCapabilities.
3. MCP: publish one or more providers using the [server/client guide](capability-adapter-mcp/MCP.md). Both stdio and a listening stateful HTTP server are included. Remote consumers install only their client dependencies.
4. Direct operations: use a package's public low-level exports and manage configuration/lifetime yourself. SDK is already a package dependency; declare it directly if your code imports it.
5. Sensitive data: filter after assembling the entire prompt, including MCP tool results, immediately before each model call.

## Distribution and maintenance

Each folder is an independently versioned npm package. Use aligned released Capability versions; these examples match the current 0.1.0 contracts. README*.md, MCP*.md and SDK FRAMEWORK_INTEGRATION*.md are included in package files. In a source checkout, npm workspaces and root TypeScript path mappings consume local packages. Framework-neutral cores do not import Orbit application code; specialized adapters have explicit entrypoints.

Package manifests own settings and Skills. The Agent host owns tool visibility, Skill preloading, action approval, storage identity and the model loop. Changing frameworks should only change the adapter. Update all three languages when public contracts or examples change. Preserve code identifiers and configuration keys across translations. Each local README is self-contained for direct integration and ships its own MCP guide; links to sibling packages provide optional further reading.

## Workspace and release reference

## Capability packages

Each folder is an independently versioned and publishable npm package. Concrete
capability cores do not import Orbit application code; framework-specific
dependencies are isolated behind explicit adapter entrypoints.

### TypeScript Agent framework integration

The primary integration path is framework-neutral:

```text
CapabilityProvider -> mountCapabilities() -> runtime tools and Skills -> Agent framework adapter
```

Any TypeScript Agent framework can register these packages by mapping the
resolved JSON Schema tools to its native tool type. AI SDK and MCP are optional
ready-made adapters, not the only supported runtimes. See the complete
[TypeScript Agent framework integration guide](./capability-sdk/FRAMEWORK_INTEGRATION.md)
for provider creation, mounting, tool conversion, Skill injection, execution,
policy enforcement, result handling, and disposal.

| Package | Responsibility |
| --- | --- |
| `@webpilot/capability-sdk` | Framework-neutral contracts and per-run registry |
| `@webpilot/capability-host` | Unified configuration stores, provider mounting and Skill catalog |
| `@webpilot/capability-adapter-ai-sdk` | AI SDK tool adapter |
| `@webpilot/capability-adapter-mcp` | Official MCP SDK adapter for stdio and Streamable HTTP |
| `@webpilot/capability-browser` | Playwright sessions, browser kernel, snapshots, runtime and MCP server |
| `@webpilot/capability-chart` | ECharts API, persistence, React rendering and MCP server |
| `@webpilot/capability-file` | File/Office workspace, workers, validation, preview and MCP server |
| `@webpilot/capability-code-sandbox` | Bounded JavaScript/Python execution with replaceable sandbox backends |
| `@webpilot/capability-connectors` | MCP Streamable HTTP, OpenAPI and custom external connectors |
| `@webpilot/capability-knowledge` | Durable document ingestion and knowledge retrieval |
| `@webpilot/capability-data` | Structured source discovery and bounded SQL querying |
| `@webpilot/capability-media` | OCR, transcription, frame extraction and configurable image/video/speech generation |
| `@webpilot/capability-communication` | Draft-first outbound communication channels |
| `@webpilot/capability-git` | Bounded Git inspection and explicitly enabled repository writes |
| `@webpilot/capability-computer` | Desktop observation and input through host-selected drivers |
| `@webpilot/capability-workflow` | Durable dependency-aware workflows and checkpoints |
| `@webpilot/capability-sensitive-data` | Provider-boundary redaction, AI SDK adapter, local GLiNER runtime and packaging scripts |

Local development uses npm workspaces and the TypeScript path mappings in the
root `tsconfig.json`, so edits under `packages/` are consumed directly.

Every concrete package owns its public settings and Skills through its
`CapabilityManifest`. `@webpilot/capability-host` loads stored values, applies
package defaults, builds one configuration object per Capability id, and
injects it through `CapabilityRunContext.configuration`. It includes memory,
environment, JSON-file and TypeORM storage adapters; TypeORM uses the same
Repository implementation for SQLite and PostgreSQL. Skills use one
`CapabilitySkill` shape for every TypeScript Agent framework integration.
Concrete capability packages publish their Skills but never load or gate them during a capability
call. The consuming Agent host owns Skill preloading and tool availability. A
custom framework can adapt `CapabilityRunSnapshot.tools` directly; the AI SDK
adapter exposes one-call mounting with eager or lazy Skill context, while MCP
mounts the same providers and config store directly.

Cloud images use exact published npm versions by building with:

```sh
docker build --build-arg WEBPILOT_CAPABILITY_SOURCE=npm .
```

That mode removes only the workspace Capability links from the image manifest
and lockfile, resolves their exact application versions from npm, preserves the
rest of the lockfile, and uses `tsconfig.npm.json` so package imports resolve
from `node_modules`.

Publish dependency order is enforced by `npm run capabilities:publish`: SDK,
framework adapters, then concrete capabilities. Use
`npm run capabilities:publish:dry-run` to inspect package contents first.

The repository deliberately keeps the default Docker build on `workspace` so a
fresh clone remains buildable before a release exists. Cloud release pipelines
must pass `--build-arg WEBPILOT_CAPABILITY_SOURCE=npm`; local source changes are
then excluded from resolution and `tsconfig.npm.json` resolves the same imports
from `node_modules`.
