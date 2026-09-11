# Registered responses

Packages own their response types, parameter schemas, React components and resource
operations. The host owns installation, identity, transport and enabled tools.
The response protocol is `{ type, params }`; only registered types can be generated.

## Package entrypoints

Keep browser, server and shared code in separate exports:

- `/response`: pure `ResponseDefinition` values from `@webpilot/capability-sdk`.
- `/response-react`: `ResponseRenderer` values using this package's `/react` adapter.
- `/response-node`: `ResponseHandler` factories using host-injected storage/services.

Do not import React components from the shared definition or the server manifest.
Use static lazy imports inside the React adapter to load large renderers on demand.

```ts
import { z } from 'zod';
import { defineCapabilityInput, defineResponseType } from '@webpilot/capability-sdk';

const params = z.object({ resourceId: z.string().min(1), title: z.string().optional() }).strict();
export const diagramResponse = defineResponseType({
  type: 'com.example.diagram',
  description: 'Display a saved diagram. Copy the successful tool result block.',
  tools: ['diagram'],
  params: defineCapabilityInput(z.toJSONSchema(params), value => params.parse(value)),
  examples: [{ resourceId: 'diagram-1', title: 'Architecture' }],
  resource: value => ({ topic: 'com.example.diagram', id: value.resourceId }),
  toText: value => value.title || 'Open the conversation to view the diagram.',
});
```

The same definition is referenced by the capability manifest's `responses`, React
adapter and server handler. Renderer and handler registries reject mismatched
definitions and duplicate IDs. `assertComplete()` detects missing bindings.
Declare `tools` only when generation requires one of those enabled tool names.
Types such as Markdown and declarative layouts omit this restriction.

```tsx
import { defineResponseRenderer } from '@webpilot/capability-response/react';
import { diagramResponse } from './response';
import { DiagramResponseView } from './diagram-view';

export const diagramRenderers = [defineResponseRenderer({
  definition: diagramResponse,
  component: DiagramResponseView,
})];
```

Components receive schema-validated `params` and a `ResponseRenderContext`:

- `request(block, operation, input?, signal?)` accesses a resource in the host's scope.
- `subscribe(block, refresh)` subscribes to the definition's resource topic and ID.
- `identity`, `readOnly`, `locale`, `translate` and `renderMarkdown` supply host services.

Handlers receive the validated params and a trusted `ResponseServerContext`. Each
operation validates its own input. Mark writes with `mutates: true`; the registry
rejects writes in read-only contexts. The host must check ownership before calling
the handler registry, and bound request bodies. Resource reads can incur provider
requests, so the Orbit transport uses explicit same-origin POSTs.

An optional handler `export` returns ordered Markdown/image content for external
channels. Without an exporter, the registry uses the definition's `toText`.
An exporter creates content only; delivery remains the communication host's job.

## Host assembly

The framework-neutral pipeline lives in `@webpilot/capability-sdk`:

- `mountCapabilities({ providers, responses: coreResponses, ... })` collects package
  `manifest.responses` and returns `mounted.responses`, filtered to active providers
  and their enabled tools. `responses` supplies only host types; do not repeat types
  already declared by package manifests.
- `new ResponseSession(mounted.responses)` owns one turn's collected tool blocks and
  accepted final response. Call `observe(toolName, capabilityResult)` after successful
  framework tool execution, `accept(value)` for a structured final response, and
  `finish()` after the loop. Normal completion requires an accepted finalResponse,
  including prose-only answers. Only host-reported failed/blocked exits may use
  `finish({ status, blocks })` without an accepted final call. The host provides prose blocks, so the SDK does
  not depend on a Markdown package.
- `ResponseRegistry.toolBlocks`, `identity`, `missing`, and `assemble` provide the
  same stateless operations for streaming/history projections. Invalid tool blocks
  are ignored; invalid explicit final blocks are rejected. `missing` preserves
  unavailable explicit historical envelopes so missing plugins can show placeholders.

`mountAISDKCapabilities` automatically connects the session to tool execution,
registers `finalResponse` when output types exist, and exposes `responseSession`.
After generation (or after consuming a stream), use
`responseSession.finish()` as the structured message payload. Preserve
`agentOptions.toolChoice` (auto) and `agentOptions.stopWhen`: it stops after
an accepted final response or `maxSteps` (default 20). Invalid final arguments do
not trigger the response stop condition. Mount once per turn, or create a new
session and tool set per turn when retaining a lower-level capability runtime.

The pipeline consumes standard object `CapabilityResult` values. A host that wraps
results must decode its transport envelope first (`adapter.decodeResponseResult`
for AI SDK). Never infer response blocks from Markdown, identifiers or arbitrary
JSON embedded in prose. This decoding and message transport remain host concerns.

Orbit has three explicit assembly points:

- `src/lib/response-registry.ts`: installed type definitions, available for history.
- `src/components/response-renderers.tsx`: browser component bindings and presentation options.
- `src/server/capabilities/response-handlers.ts`: storage/service bindings for resource operations.

Install/register a package at these boundaries; the final-response tool, message
transport, chat renderer and automation renderer need no per-type branches.
New package code is delivered with the application, not loaded from model URLs.

The generation schema comes from `registry.forTools(enabledTools).input()`. It
contains a union of exact `type` constants and each package's parameter schema.
Local JSON Schema references are relocated when combining recursive schemas.
The JSON Schema and runtime parser originate from the same package definition.

Successful capability tools return a ready-to-use block:

```json
{
  "type": "response",
  "block": {
    "type": "com.example.diagram",
    "params": { "resourceId": "diagram-1", "title": "Architecture" }
  }
}
```

The agent copies `content[].block` into `finalResponse.blocks` at the desired
position. `registry.modelInstructions()` supplies descriptions and validated
examples from the same definitions used by the input schema; package Skill
examples should use their response-block factories as well.

Orbit also delivers successful registered tool blocks that were omitted from the
final response. It consumes only the explicit `content[].block` contract, validates
the owning tool and schema, and deduplicates against explicit response resources.
Explicit ordering and intentionally repeated views are preserved. Markdown text
and identifiers never become components. Live and persisted message projections
use the same contract, so generated views do not depend on the model copying an ID.

## Streaming and history

Messages use `data-response` parts containing the same block envelope. Part IDs
identify positions, not resource IDs; repeated views of one resource preserve
their requested order. Resource subscriptions identify the underlying resource.

`registry.partial()` publishes a contiguous validated prefix. A definition can
opt into incremental parameters with `partial`; Markdown does so. Other types
publish once their parameters validate. An incomplete block never moves a later
block into an earlier position. React components remain mounted as params update.

History stores the envelope without requiring the generating tool to remain
enabled. Missing packages show a placeholder instead of preventing the entire
conversation or automation run from loading. Generation and resource access
still require registered definitions and validated parameters.

Default registrations are `core.markdown` and `core.ui`. Chart registers
`com.webpilot.chart` and `com.webpilot.canvas`; Maps registers `com.webpilot.maps`.
There is no compatibility branch for the former chart/map/UI message protocol.
