> Historical diagnosis of the previous Next-based API runtime. The API source mirror, React aliases and Next 404 interception described below have been removed. See [the current Node backend architecture](node-backend-architecture.md). The measurements below describe the old runtime, not validation of the new production artifacts.

# Browser runtime memory diagnosis — 2026-09-14

## Current fix and measured result

The development API project now resolves Next's `app-page/vendored/rsc/react` entry directly to the **same installed Next package's server React exports**. The default entry imports the complete page renderer, whose React Server DOM development module enables the global `async_hooks` history tracker. The generated API entry itself loads `patch-fetch -> dynamic-rendering -> React`, even without an application React import. Replacing ordinary `NextResponse` uses with standard `Response` reduces another import path but is not sufficient on its own.

Both the custom server config and the generated on-disk config use `developmentApiConfig`, so Next's independent config readers get the same API-only resolution boundary. The UI keeps its original React renderer. Turbopack's documented `resolveAlias` configuration is used; no files in node_modules are patched. See https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#resolving-aliases.

Unknown API URLs were a second verified entry: Next rendered its default 404 page and enabled the hook again. The API source mirror now builds route matchers using Next's own `normalizeAppPath` and `getRouteRegex`. Unknown paths receive a native JSON 404 before Next's renderer; dynamic/catch-all routes continue to match. The table updates with the existing source watcher.

The API child also no longer starts a redundant development supervisor beneath the existing API supervisor. The real API process is now the child whose lifecycle the outer supervisor observes.

Controlled development-process comparison: four concurrent tasks each performed 30,000 resolved-Promise awaits, yielding to the event loop every 1,000 iterations, for three rounds. After explicit GC:

| Measurement | Before, PID 1944 | Final boundary, PID 26484 |
| --- | --- | --- |
| React page hook installed | yes | no |
| Round durations | 437 / 397 / 373 ms | 24 / 17 / 15 ms |
| Heap before workload | 189.0 MiB | 180.1 MiB |
| Heap after each round | 217.8 / 226.5 / 235.3 MiB | 179.9 / 179.9 / 179.9 MiB |

Two initial real-model rounds used the configured MiniMax-M3 provider and four concurrent Browser Chat sessions per round. Each round finished three local browser tasks (title read, three locator clicks, DOM count verification) and interrupted the fourth. The local fixture independently recorded three clicks for each completed task. The first round's 27 bootstrap probes had median 213 ms / p95 388 ms / max 1052 ms; the second round's 33 had median 195 ms / p95 313 ms / max 922 ms. First-use interrupt took 5276 ms (Next reported about 5.2 seconds compiling and 42 ms application work); the warmed second-round interrupt took 68 ms. After the rounds and explicit GC, API heap was 198.5 and 200.6 MiB, with no page runtime loaded and no active/retained Browser Chat runtime sessions. This is bounded regression evidence, not a claim about indefinite workloads or all RSS allocations.

After adding the missing-route guard, nonexistent API, invalid tutorial kind and missing artifact requests returned 404; bootstrap returned 200. No page hook was installed afterward. The first nonexistent API probe took 61 ms, and legitimate dynamic routes still ran their own handlers.

The final version then passed a third four-Agent round: three completed local browser tasks and one interrupted turn, all fixture click counts correct. Its 20 bootstrap probes had median 203 ms / p95 and maximum 362 ms. After this server restart the interrupt route compiled on first use again: 3283 ms total, with Next reporting about 3.2 seconds compilation and 27 ms application work. Post-round GC heap was 200.1 MiB, page module count remained zero, and no React page hook had been installed. All 12 diagnostic sessions were subsequently deleted in one successful 1640 ms batch; the API PID stayed 26484 and its GC heap was 202.3 MiB. These rounds exercise cold concurrent browser acquisition, task completion, cancellation, and batch deletion. First-use development compilation latency remains; warmed interrupt latency was measured separately above.

Performance runs set `WEBPILOT_AUTOMATIC_HEAP_SNAPSHOTS=false` and retained 10-second memory logs. No new heap snapshot was requested. Evidence files are under `runtime/diagnostics/`: `load-trace.jsonl`, `async-before.json`, `async-final.json`, `concurrent-agents*.json`, `memory-after-agents-*.json`, `memory-final-error-routes.json` and the role/PID memory logs. Diagnostic instrumentation only records module/hook loading; it does not disable or replace the hook.

The existing 19 server checks pass. Full repository typechecking still reports unrelated existing errors, including tutorial sample block `id` properties and sqlite test typings; the Response replacements do not modify those lines. No new test-suite files were added. Tabbit UI verification was blocked before page creation by `Target.createTarget: Task-scoped CDP command could not be dispatched`; the successful real browser Agent runs and HTTP measurements do not establish a frontend visual check. The default Turbopack path was exercised; Webpack fallback was not runtime-tested.

## Evidence

Process 23872 ran UI, API routes and Agent turns together in development. Four concurrent turns coincided with an event-loop delay of 98.4 seconds. The growth heap snapshot completed at 16:00:38 (UTC+8), with 4,159,735 nodes, 17,338,230 edges and 393,120,232 bytes of node self-size. This is an early snapshot, not the later 6 GiB heap.

The largest array (29,360,168 bytes) is the backing table of a Map held as `pendingOperations` in React's server development runtime. Its outgoing references include 544,874 Object records (47,949,392 bytes across all direct target nodes). Sample records have `owner`, `stack`, `promise`, `awaited` and `previous` properties. The whole snapshot has 596,106 WeakRef objects. These counts are shallow sizes and references, not dominator retained-size estimates.

The installed React server runtime creates a global `async_hooks` hook and stores asynchronous operation records in `pendingOperations`. Its promise callbacks create WeakRefs and link records through `awaited` and `previous`; `destroy` removes the Map entries. Long-lived Agent promise chains therefore participate in page-development tracing when both share a process. Promise references being weak does not make the debug records and their linked history weak.

An isolated local comparison loaded either Next's `app-route.runtime.dev` or `app-page-turbo.runtime.dev`, then ran four suspended tasks with 20,000 resolved-Promise awaits each. After GC, the API runtime retained approximately 0 MiB additional heap and took 11 ms; the page runtime retained 30.3 MiB and took 380 ms. These are one-run diagnostic measurements, not a production benchmark or an end-to-end concurrency check. The page module installed the `init/before/promiseResolve/destroy` hook; the API module did not.

The high-water capture started at 16:30:18 with 6468.4 MiB heap used, but its file is zero bytes and there is no completion event. PID 23872 was absent when inspected. The incomplete snapshot cannot explain the entire later heap or prove why the process exited. No new snapshot can be collected from that exited process.

## Changes

- Share one browser initialization across concurrent acquisitions. Count pending leases before awaiting startup so idle cleanup does not close their runtime. Clean up superseded launches.
- Preserve BrowserSession identity after a failed startup so tool closures can retry against the same instance.
- Use a separate development API process and an API-only generated Next project. Page requests never reach its renderer. Generated type files and compiler output are separate from the UI project. API files are mirrored into real directories and synchronized from the workspace; a directory junction was not discovered by Turbopack and caused all API requests to return 404. The generated project also has a real `next.config.ts`, because the development router reloads config independently of the custom server's `conf` option.
- Take the third comparison snapshot at the smaller of 1 GiB and 50% of the heap limit, instead of waiting for the 75% pressure alarm. Snapshot writing still pauses the process doing the capture.

## Earlier follow-up evidence: runtime PID 8116

The initial API-only development project did **not** eliminate the React page development runtime. Its completed high-water snapshot contains `app-page-turbo.runtime.dev.js` and the active async hook holding `pendingOperations`. The isolated module experiment did not prove that the full API server avoided loading that module. The import/initialization paths were subsequently traced and addressed as described in Current fix above.

Two completed snapshots from the same process were analyzed offline:

| Measurement | High-water, 17:45:02 capture start | Manual, 17:50:14 capture start |
| --- | ---: | ---: |
| Snapshot file bytes | 755,745,983 | 1,659,182,026 |
| Sum of node self-size bytes | 609,515,983 | 1,240,359,212 |
| WeakRef count | 1,882,183 | 4,189,016 |
| pendingOperations backing table bytes | 14,680,104 | 58,720,296 |
| Object records directly referenced by that table | 448,265 | 1,505,308 |

The Map has the same V8 node ID, `1378191`, in both snapshots. Its retaining path is `active_hooks -> AsyncHook -> init/before/destroy/promiseResolve closure context -> pendingOperations -> table`. Sample records contain `owner`, `stack`, `promise`, `awaited` and `previous`; `promise` is a WeakRef but the historical record links are strong. These are direct counts and shallow sizes, not a dominator retained-size calculation or evidence that every WeakRef belongs to this Map.

Immediately before manual capture, measured heapUsed was 1794.3 MiB, RSS was 3251 MiB, four turns were active, Browser Chat retained payload was estimated at 5.7 MiB, and the database write queue was empty. This payload estimate excludes compiler/SDK state and object overhead; it is not total retained memory.

The high-water capture completed at 17:45:41 (about 38.6 seconds). The already-issued manual capture completed at 17:58:06 (about 471.7 seconds). The synchronous `v8.writeHeapSnapshot` call itself blocks the API process. No additional capture was requested after the user asked to analyze existing files only. The manual snapshot includes debugger/profiler activity, so its delta is not a controlled Agent-only allocation experiment.

The preceding CPU profile covered about 21.99 seconds: GC accounted for about 2.84 seconds and the `publishToMainServer` Promise executor for about 2.44 seconds. That executor includes event JSON serialization, HTTP request creation and request submission; function-level samples cannot attribute its entire time exclusively to JSON.stringify. Repeated result decoding also appears in the profile. These are observed hotspots; realtime delivery has not yet been optimized or proven to explain every long stall.

The proxy previously called supervisor invalidation on every upstream request error, including ECONNRESET; invalidation killed the API child. This could turn one failed/cancelled request into a runtime restart and cascading request failures. The proxy now fails only that request, cancels upstream work when the client disconnects, and leaves child restart to actual process exit. Existing 19 server checks and a temporary in-memory HTTP probe passed (upstream reset returns 502, client cancellation leaves subsequent requests healthy). No dev/build or new test file was used. This source fix has not been validated in the user's running multi-Agent workload. The supplied reset log does not by itself establish a fatal V8 OOM.

## Earlier validation boundary

Earlier targeted checks covered four concurrent browser acquisitions, failed-start retry, pending/released lease counts and inherited TypeScript aliases. After correcting the 404 regression, Next's disk config loader returned the isolated output and tsconfig paths, and its recursive file scanner found all 71 API route entries, including communication/runtime, onboarding, browser-chat/bootstrap and realtime/ws. The follow-up snapshots disproved the inference that a generated API-only project alone removed page tracing. See Current fix for the later live regression results. API and Agent still share the API process, including synchronous snapshot capture and business work.
