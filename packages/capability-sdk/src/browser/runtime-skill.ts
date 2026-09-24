import type { CapabilitySkill } from '../index.ts';
export { browserInteractiveQaSkill } from './interactive-qa-guidance.ts';

export const browserCodeRuntimeSkillId = 'system-browser-code-runtime';

export const browserCodeRuntimeSkillSummary = [
  '<system_skill>',
  `<id>${browserCodeRuntimeSkillId}</id>`,
  '<title>Browser Code Runtime</title>',
  '<description>Compact required browser operating rules. Read once before the first browser action; load detailed API and interaction references only when needed.</description>',
  '<required>true</required>',
  '</system_skill>',
].join('\n');

const browserCodeRuntimeManual = `# Browser Code Runtime

This Skill is the authoritative API reference and operating contract supplied by the browser package. The consuming Agent is responsible for loading it and deciding when the browser tool becomes available.

## Required state machine

Tool reasons describe intent, not execution evidence. A successful code result only means the script returned without an uncaught failure. Required actions must not be silently skipped by a count/visibility guard: throw when their prerequisites are missing, and verify the resulting value or business state after acting. Report only operations demonstrated by returned evidence; an empty action list or unchanged value cannot support a completion claim. executionState records attempted and completed browser calls, not business success.

1. Before the first browser action, read this Skill. Its complete current content supplied in a tool prerequisite response also satisfies the read; apply it and retry the original action without another Skill call. Otherwise read it explicitly in a separate model step:

\`\`\`json
{ "action": "read", "skillId": "${browserCodeRuntimeSkillId}", "reason": "读取浏览器代码 API 与运行规范" }
\`\`\`

Provider-neutral call notation: \`skill({ action: "read", skillId: "${browserCodeRuntimeSkillId}" })\`.

2. Call \`browser({ action: "snapshot", reason })\` to inspect the current actionable controls and active surface before an unfamiliar interaction. It returns a semantic element snapshot with roles, names and current surface metadata; use those facts to choose a live Playwright locator. Use \`browser({ action: "state", reason })\` for a scoped Playwright AX tree or targeted text. For a known URL, navigate and read the new page in the same cell without first reading the page being left. When BROWSER_CODE_AUTO_SCREENSHOT is enabled, a final viewport screenshot is captured after each code call.
3. Use the requested code-action result. Add a targeted read only when an exact locator, frame, or surface fact needed for the next action is absent or stale; it may share a cell with the action when the read supplies enough evidence. Do not add a mandatory tabs/URL/title/snapshot inventory call.
4. Use browser action=code for bounded read or action cells. A cell may contain multiple dependent operations only when each later target is confirmed by an intervening targeted read.
5. Observe, act, then inspect the post-action result. \`page.verifyState()\` is unavailable; there is no required verification helper or verification-only tool call. After attempted code input, the host returns a bounded \`data.postActionState\` and captures the final viewport when enabled. Read that state, the returned result, and the attached screenshot before dependent work. If a specific condition is required within one cell, use ordinary Playwright waits and targeted reads, and throw only when the observed condition is false. Completed input is execution evidence, not business success; do not replay it merely to obtain an assertion. If an overlay opened or a picker remained open, inspect its current surface before acting outside it. For read-only research, returned relevant page content is the evidence.

If the runtime rejects a governed call, preserve its complete error and any \`requiredSkillId\`, refresh only the evidence that became stale, and continue the same page transaction.

## Context and observation retention

Use action=state with scope, frame, selector, query, and the returned cursor to inspect only the missing evidence. Reuse a useful result instead of repeatedly dumping the whole page. Snapshot UIDs are tied to their DOM revision; semantic locators resolve live.

For code, observationMode controls historical screenshots: replace (default) for a new page, append for continuous inspection of the same page, keep-pair for a before/after comparison. The host limits history by the model budget and always prioritizes the current observation. Historical screenshots explain past states and never authorize coordinates. A failed operation preserves before/after comparison when images exist.

If executionState.outcome is unknown, inspect current state or an operation receipt before retrying. completedActions lists browser calls that returned, not verified business results. Never replay an entire partly completed batch.

## Observe controls and verify outcomes

For an unfamiliar or changed control, inspect its current role, visible state and container before choosing an interaction. A label alone does not establish editability or control type. Re-observe targets whose structure changed; selectors from another page are hypotheses. Use a targeted read rather than dumping the whole document. If the next action requires interpreting new evidence, return it before continuing.

Do not silently skip a requested action when its target is missing. Distinguish the attempted action, the returned evidence, and the verified outcome. Combine errors and observations to decide whether to retry, use an alternative, report a limitation or work on an independent item, following the user's task and constraints. Tool success alone is not proof of the requested outcome.

An empty array, null, zero matches, unchanged value, missing identity, or a caught error is missing or contrary evidence even when outer ok is true. Do not repeat the same hover/click/read sequence just because it did not throw. After an unchanged result, name the missing fact and use a targeted state/DOM read of the actual control and active surface before choosing a different action. Resolve labels and containers from that read; avoid guessed screen-coordinate cutoffs or scanning the entire document for a few matching words. Preserve a failed prerequisite as a failed prerequisite rather than silently skipping it and continuing dependent work. When writing a batch, check required intermediate conditions explicitly and throw with the observed state when they are not satisfied.

Browser tabs can share authentication within the same browser context. Opening another tab or visiting a login URL does not establish an independent account session or prove logout. Before identity-dependent work, verify the active page and the visible signed-in identity against the requested account; a successful credential fill or navigation alone is insufficient. If identity differs or cannot be read, resolve that prerequisite before collecting account-specific results. Reuse the observed working interaction to open a menu instead of repeatedly toggling it with both hover and click.

## Mandatory review after a browser failure

Put this review in the next browser tool input \`recoveryReview\` (concise Markdown), not standalone assistant narrative. It appears in the recovery operation help card.

Mandatory failure screenshot review applies only when BOTH BROWSER_CODE_AUTO_SCREENSHOT is enabled AND the selected model supports image input. Under those conditions, before retrying a failed interaction or performing dependent mutations, inspect the actual failure screenshot, not merely its path or the tool summary. Briefly state the visible page/overlay/validation state, the supported cause (label uncertainty), the changed recovery action and how its result will be verified. Combine pixels with the tool error and targeted live reads; do not assume every failure is an overlay. If no image was attached, attempt to capture and emit the current viewport. If capture remains unavailable, disclose the limitation and use targeted live state without claiming visual inspection. When either prerequisite is false, do not require a screenshot or automatically turn capture on; diagnose from errors and targeted live reads. Explicit UI visual acceptance requested by the user remains a separate task requirement.

Use one bounded recovery, verify the obstructing state is resolved, then resume the batch. Do not blindly repeat a failed action or force-click an unrelated control. Record a short confirmed cause and prevention rule in current task notes so subsequent actions do not repeat it; speculative explanations are not lessons. This is required after the first failure, not only after repeated retries. A post-code screenshot arrives only after the entire cell finishes; when the next action depends on visually interpreting a new state, end the cell and review that image first.

## Efficient lookup and search

- Combine navigation and content acquisition in one browser action=code: await page.goto(url), then read the loaded page and return its useful evidence. Returning only title/URL and making another tool call for the content is unnecessary unless an actual loading or interaction dependency prevents the read. A DOM snapshot taken after navigation can be returned in that same cell. Only later actions whose targets require the model to inspect new evidence need another model step.
- Keep the user's names and terms verbatim in a plain query string. Construct query parameters with encodeURIComponent(query), never handwritten percent escapes or guessed Unicode code points. Return query with the result and check the displayed query when results are irrelevant before changing sources. Do not change an unfamiliar term into a different word silently.
- For a simple factual question, start with one focused query on one engine. Open the strongest relevant source and answer once it supports the fact. Search engines are discovery channels, not independent evidence. Switching among many engines is not corroboration.
- Use one alternate engine only for a concrete access failure or irrelevant results after checking the actual query. After two focused attempts add no useful evidence, stop reformulating the same query: explain the uncertainty, use an already found source, or ask a narrow clarification. Broader searches are appropriate for explicitly broad research or distinct unanswered subquestions, not for repeating one simple lookup.
- Every further search must address a named missing fact and be likely to add new evidence. Do not loop through URL encodings, language/domain variants, empty queries, or repeated "final attempts". Record useful findings and access failures so recovery or context compression does not restart the same search.
- A successful navigation is not a successful search. Read the result, distinguish a real empty result from CAPTCHA/access failure/loading, and preserve read errors rather than swallowing them with catch(() => ''). A relevant excerpt is enough; do not repeatedly dump navigation menus or the whole page.
- Explain the concrete lookup in reason (query/purpose and, for fallback, why the previous source was unusable). Keep returned evidence bounded and include source URLs for claims.

Example of a single navigation-and-read call (the domain/query are illustrative):

\`\`\`js
var query = '船蟹 梭子蟹 区别';
await page.goto('https://www.bing.com/search?q=' + encodeURIComponent(query));
nodeRepl.write({ query, url: page.url(), snapshot: await page.domSnapshot() });
\`\`\`

The returned snapshot supplies both content and exact links for the next decision. If a known source URL is already available, navigate directly to it and read its content in the same call instead of searching again.

## Host tool boundary

These are model tools, not JavaScript globals:

- \`skill({ action: "read", skillId, reason })\` loads one exact Skill for the current Agent run.
- \`browser({ action: "snapshot", reason, snapshotView?, snapshotCursor? })\` returns current interactive DOM UIDs, active surface metadata and a Playwright AX tree. The default actionable view lists live controls; full/text views support broader inspection. Pass nextCursor as snapshotCursor to continue the same observation. An exact UID exposed in this snapshot is bound to \`page.getByUid(uid)\` until the page changes; semantic role/name locators also resolve live. Never reuse a stale UID.
- \`browser({ action: "state", reason })\` returns a scoped non-mutating Playwright AX tree.
- \`browser({ action: "dismissSurface", reason })\` always sends one direct \`page.mouse.click(0, 0)\`, without Locator actionability checks, Escape, or a required surface id. Prefer it when the intent is only to dismiss an open select/cascader/tree picker, dropdown menu, or date/time option surface. The tool returns \`data.closureConfirmed\`, \`data.outcome\`, and a final screenshot when available; DOM/hybrid/MCP modes also return before/after surface observations and bounded \`data.postActionState\`. Outer \`ok: true\` means the click was delivered; it does not mean the option surface closed. If no active surface was detected beforehand, the click still runs and closure is unconfirmed. Inspect the returned state before acting behind the popup. Dialogs with explicit Close/Cancel controls should use those controls first; Apply/Done/Confirm controls should be used when they commit a selection. The fixed corner click is not for navigation or control selection.
- \`browser({ action: "code", reason, code, maxOutputChars? })\` executes one JavaScript cell. \`reason\` is a concise description of the exact read/action; \`code\` is 1-40,000 characters; \`maxOutputChars\`, when supplied, is at least 1,000.
- \`browser({ action: "waitForHumanVerification", reason, maxMs? })\` pauses for user-owned CAPTCHA, OTP, QR, login, identity, or device verification.

State reads optionally accept scope (active/all), exact frame path (main for the main frame), a unique selector, literal query, and maxOutputChars. Pass nextCursor as cursor to continue the same immutable capture; keep selection unchanged. Read live state again after navigation, another capture, or a code action. Continuation is historical evidence, not a fresh DOM observation.

Success is reported by outer ok; executionState records browser-call progress for both successful and failed cells. Downloads, images and imageErrors are returned only when non-empty, error only when present, and aborted only when true. Code results may include executionState and downloads. executionState distinguishes attempted actions from completed Playwright calls and marks timeout/abort/crash outcomes unknown after execution starts. Refresh live state before retrying; never replay a submission solely because the cell timed out. kernelReset also reports timeout/aborted/crashed and means previous JavaScript bindings are gone. downloads contains persisted artifact IDs when the host supplies a receiver; pass those artifact IDs to file readContent/convert instead of fetching the export URL again.

The outer browser action=code result is \`{ ok, summary, data, failureCategory?, referenceImagePaths?, browserObservation? }\`. \`data\` contains \`{ result, actionOutcome?, actionNote?, finalPage?, observation?, error?, aborted?, executionState?, downloads?, kernelReset?, postActionState?, recoveryState?, pageErrorIndicators?, images?, imageErrors? }\`. Read it directly without JSON parsing. When BROWSER_CODE_AUTO_SCREENSHOT is enabled (the default), every code call captures the final active viewport after the ENTIRE cell, including after failed scripts when the page remains accessible. When image input and capture are available, the next model request attaches the actual latest viewport pixels in a \`[Current browser observation]\` image block after the tool receipt. Inspect that image together with \`data.result\`, \`data.error\`, \`executionState\` and any explicit DOM read before a dependent action; a file path, observation ID, tool reason or outer \`ok\` is not the image or a verified outcome. No separate image-read call is needed for attached pixels. When disabled, data.observation.status is disabled, no automatic image is supplied, and explicitly emitted reference images still work. \`observation\` reports capture status or error; full screenshot metadata remains in the raw trace. Only the latest automatic browser observation remains in the model request; older screenshots remain execution artifacts, not current state. If capture fails or the model cannot accept images, explicitly read live DOM/Playwright state and do not claim visual inspection. No DOM delta is returned. Use \`page.domSnapshot()\` or targeted reads for exact locator attributes. Screenshots show visible state, not hidden attributes or proof of business completion. Wait for the relevant state and verify the outcome; split visually dependent UI transitions into separate cells or read the changed DOM before continuing inside a cell. A declared browser action with zero attempted actions was not executed, even if the cell returned a value. The successful read remains \`ok: true\` with \`data.actionOutcome: "skipped"\`, an explicit warning in the summary, and a bounded live \`data.recoveryState\`; do not report the declared action as completed. Change the target or page state before retrying. If a visible HTTP/service error appears in the current AX state, pageErrorIndicators and the summary surface that candidate; investigate it before attributing an empty business view to product logic. Failed results preserve the complete error and failure classification.

## Cell syntax and result contract

For wide or repetitive tables, return the fields needed for the current question, the actual row count, and any distinguishing values or exceptions. Avoid joining every header and repeated cell into long strings when a structured summary conveys the same observed facts. Keep all requested rows and exact values when the user needs them; the full tool result remains in the session trace for targeted rereading.

- Each cell has a total time budget (90 seconds by default), including preparation, page operations and waits. Split repeated form submissions into small cells; persist confirmed record IDs in agent.state after each save. After a timeout, inspect the live result before repeating writes: earlier operations may have completed even though the cell returned no result.

browser action=code accepts ordinary JavaScript with top-level await. The bindings \`page\`, \`context\`, \`browser\`, and \`tab\` already exist; do not import Playwright.

- Top-level bindings persist between cells only while the current JavaScript kernel remains alive. Prefer \`var\` for short-lived reusable bindings or use a fresh name in each cell; redeclaring the same top-level \`let\` or \`const\` can fail. Use \`agent.state\` for anything needed after a kernel recycle or in a later turn.
- Do not wrap the cell in an async function, module, export, IIFE, or Markdown fence.
- Call \`nodeRepl.write(value): void\` to return compact JSON-safe evidence. Zero writes returns \`null\`; one write returns that value; multiple writes return an array in write order.
- Call \`await nodeRepl.emitImage(value, options?): Promise<{ bytes, index, mimeType }>\` with a screenshot Buffer, Uint8Array, or base64 image data URL. Supported types are PNG, JPEG, and WebP. Explicitly emitted images are saved as artifacts and attached to the next model request as reference evidence; the automatic final viewport is the single current browser observation.
- \`console.log/info/warn/error\` are diagnostics, not the cell result.
- Let failed operations throw. Do not catch an exception and write \`{ ok: false }\`; a top-level result object with \`ok: false\` is treated as a failed tool result. If reporting an observed negative fact rather than an execution failure, use a domain key such as \`{ available: false }\` or \`{ matched: false }\`.
- Return primitives and small plain objects. Convert complex Playwright objects to selected strings/numbers/booleans before writing them; do not serialize Page, Locator, Response, request, or DOM object graphs.

Minimal current-state read:

\`\`\`js
var state = {
  tabs: await browser.user.openTabs(),
  url: page.url(),
  title: await page.title(),
  surface: await page.activeSurface(),
  snapshot: await page.domSnapshot(),
};
nodeRepl.write(state);
\`\`\`

Action with an actual postcondition:

\`\`\`js
var saveButton = page.getByRole('button', { name: 'Save', exact: true });
await saveButton.click();
var saved = await page.getByText('Saved', { exact: true }).isVisible();
if (!saved) throw new Error('Save completed without the observed Saved confirmation.');
nodeRepl.write({ saved, url: page.url() });
\`\`\`

The names above are examples only. Every locator-defining role, name, text, label, placeholder, test id, id, href, or attribute used in a real call must appear verbatim in the latest inspected evidence.

## Runtime API reference

### Global browser bindings

- \`page: Playwright Page\` — the currently selected page.
- \`context: Playwright BrowserContext\` — the selected page's browser context.
- \`tab: RuntimeTab\` — wrapper for the selected page.
- \`browser: BrowserRuntime\` — controlled session and tab lifecycle API.
- \`await agent.browsers.getDefault(): Promise<BrowserRuntime>\` — returns \`browser\`.
- \`await agent.browsers.get(id): Promise<BrowserRuntime>\` and \`await agent.browsers.list(): Promise<BrowserRuntime[]>\` — runtime lookup.
- \`agent.state\` — durable non-secret conversation state described below.
- \`await browser.documentation(): Promise<string>\` — short runtime-generated capability/timeout summary. This Skill remains the full contract.

### Durable conversation state

Top-level JavaScript bindings are temporary: the kernel can be recycled by age, execution count, memory, watchdog, idle release, or backend restart. Save JSON-safe values needed by later cells, later turns, or child Agents with:

\`\`\`ts
type RuntimeStateEntry = {
  key:string; value:unknown; revision:number; updatedAt:string; expiresAt?:string
};

agent.state.get({key:string}): Promise<
  | ({found:true} & RuntimeStateEntry)
  | {found:false;key:string}
>
agent.state.set({
  key:string; value:unknown; expectedRevision?:number; ttlMs?:number
}): Promise<RuntimeStateEntry>
agent.state.set(key:string, value:unknown, options?:{
  expectedRevision?:number; ttlMs?:number
}): Promise<RuntimeStateEntry>
agent.state.delete({
  key:string; expectedRevision?:number
}): Promise<{deleted:boolean;key:string;revision?:number}>
agent.state.delete(key:string, options?:{
  expectedRevision?:number
}): Promise<{deleted:boolean;key:string;revision?:number}>
agent.state.list({
  prefix?:string;limit?:number
} = {}): Promise<{items:RuntimeStateEntry[];count:number;truncated:boolean}>
agent.state.clear({prefix?:string} = {}): Promise<{deleted:number;prefix:string}>

get/delete also accept a key string, while list/clear also accept a prefix string. Object input remains the canonical form; the string overloads are safe convenience forms for ordinary browserCode cells.
\`\`\`

State is stored by the host database under the current browser conversation. It survives JavaScript-kernel recycling, browser idle release, later conversation turns, and backend restart. The parent Agent and its child Agents share the conversation state, which is deleted with the conversation.

Keys contain 1-120 printable characters and a conversation stores at most 100 keys. Values may contain JSON-safe primitives, arrays, and plain records with at most 30 nested levels and at most 256 KiB of UTF-8 JSON. Large Base64 payloads are rejected: images, downloads, and large extracted text belong in workspace artifact files, while state stores only their asset names, URLs, compact metadata, and progress. Avoid echoing large restored values through nodeRepl.write unless they are needed in model context. Optional ttlMs accepts 1000 milliseconds through 30 days. set increments revision; expectedRevision provides optimistic concurrency, where 0 requires a missing key.

Persist only reconstructable task data such as IDs, URLs, selectors, drafts, progress, and verified results. Never store passwords, credential values or references, cookies, authorization headers, access tokens, or other secrets. A restored selector, tab ID, URL, or observation is historical data and must be validated against the live browser before acting.

\`\`\`js
var savedProgress = await agent.state.set({
  key: 'task.progress',
  value: { step: 3, issueId: '30789' },
});
nodeRepl.write(savedProgress);
\`\`\`

### BrowserRuntime and tabs

- \`await browser.tabs.list(): Promise<RuntimeTab[]>\` — conversation-group tabs only.
- \`await browser.tabs.new(): Promise<RuntimeTab>\` — create, select, and own a blank tab.
- \`await browser.tabs.new(url): Promise<RuntimeTab>\` — create, select, and navigate.
- \`await browser.tabs.new({ url }): Promise<RuntimeTab>\` — equivalent object form.
- Concrete forms: \`browser.tabs.new("https://example.com/")\` and \`browser.tabs.new({ url: "https://example.com/" })\`.
- \`await browser.tabs.use(tabOrId): Promise<RuntimeTab>\` — select an allowed tab and update global \`page/context/tab\`.
- \`await browser.tabs.finalize({ keep }): Promise<TabInfo[]>\` — close Agent-created tabs except \`keep: [{ tab, status: "deliverable" | "handoff" }]\`.
- \`await browser.user.openTabs(): Promise<TabInfo[]>\` — returns \`id, active, url, title, groupId, groupTitle, lastOpened\` for the current conversation group.
- \`await browser.user.claimTab(tabOrId?): Promise<RuntimeTab>\` — claim/select an allowed existing tab. Omit the argument to claim the current/latest allowed page.

Each \`RuntimeTab\` exposes:

- \`tab.id: string\`
- \`tab.playwright: Page\`
- \`await tab.use(): Promise<Page>\`
- \`await tab.goto(url, options?): Promise<Response | null>\`
- \`tab.url(): string\`
- \`await tab.title(): Promise<string>\`
- \`await tab.screenshot(options?): Promise<Buffer>\`
- \`await tab.close(): Promise<void>\`
- \`tab.cua.click({ x, y, button?, clickCount? })\`
- \`tab.cua.move({ x, y, steps? })\`
- \`tab.cua.keypress({ keys })\`, \`tab.cua.type({ text, delay? })\` (native character input, default 50 ms between characters), and \`tab.cua.wheel({ deltaX?, deltaY? })\`

Tab examples:

\`\`\`js
var tabsNow = await browser.user.openTabs();
var wantedInfo = tabsNow.find((item) => item.url.includes('/orders'));
if (!wantedInfo) throw new Error('No observed conversation tab matches /orders.');
var wantedTab = await browser.tabs.use(wantedInfo.id);
nodeRepl.write({ id: wantedTab.id, url: page.url(), title: await page.title() });
\`\`\`

\`\`\`js
var researchTab = await browser.tabs.new('https://example.com/');
nodeRepl.write({ id: researchTab.id, url: researchTab.url(), title: await researchTab.title() });
\`\`\`

### Data collection priority

For read-only collection such as lists, searches, details, counts, and export metadata, prefer the current application's authenticated HTTP API when the exact endpoint and request shape are known from current page or network evidence. API responses are usually more complete, structured, and efficient than collecting the same data row by row from rendered UI.

- Use \`context.request.get/post/...\` for an observed same-origin endpoint. Playwright's BrowserContext request client shares the current browser context's cookies, so do not manually read, copy, inject, log, or return cookies or authorization values.
- Never guess an endpoint, method, query, body, pagination contract, or response schema. Derive it from current application/network evidence and return only the required JSON-safe fields through \`nodeRepl.write\`.
- If the API cannot be identified, is unavailable, rejects the request, omits UI-only computed state, or does not provide evidence equivalent to the rendered business state, fall back to Playwright locators and collect the visible interface content.
- This preference applies to read-only data acquisition. It does not authorize create, update, delete, approval, submission, or other state-changing requests through a backend API; perform those through the observed UI unless the user explicitly requests API mutation and the exact contract is verified.
- When API data is used to answer a page-state question, validate any material ambiguity against the rendered UI before claiming the final business result.

After \`observedApiUrl\` has been obtained from current evidence:

\`\`\`js
var apiResponse = await context.request.get(observedApiUrl);
if (!apiResponse.ok()) throw new Error(\`Observed API returned HTTP \${apiResponse.status()}\`);
var apiPayload = await apiResponse.json();
nodeRepl.write({ status: apiResponse.status(), data: apiPayload });
\`\`\`

### Inspection extensions on Page

- \`await page.domSnapshot(options?): Promise<string>\`, where \`options.scope\` is \`"active"\` (default) or \`"all"\`. The returned string contains a \`[page-state]\` JSON line plus an active-surface-scoped accessibility tree. It is a string, so do not read \`.surfaces\` from it.
- \`page.getByUid(uid): Locator\` synchronously resolves an exact \`dom-*\` UID from the latest exposed DOM evidence to a normal Playwright Locator. A stale, detached, navigated, or unexposed UID throws \`STALE_DOM_EVIDENCE\`; refresh evidence instead of editing or guessing the UID.
- \`await page.activeSurface(): Promise<{ activeSurface?, surfaces, surfaceStack, topSurfaceIds }>\` — structured popup/overlay state. Surface records include \`id, kind, label, descriptor, modal, selector?, framePath?, parentId?, depth, zIndex, rect, signals\`.
- Ordinary Playwright reads include \`locator.count()\`, \`isVisible()\`, \`isEnabled()\`, \`isChecked()\`, \`inputValue()\`, \`innerText()\`, \`textContent()\`, \`getAttribute()\`, \`allTextContents()\`, \`ariaSnapshot()\`, and \`boundingBox()\`.
- DOM-only reads belong inside \`page.evaluate(callback, arg?)\`. Browser-page callbacks cannot access Node globals, the local filesystem, environment variables, credentials, or runtime objects such as \`nodeRepl\`.

Targeted read example:

\`\`\`js
var form = page.getByRole('form', { name: 'Booking details' });
nodeRepl.write({
  visible: await form.isVisible(),
  destination: await form.getByLabel('Destination').inputValue(),
  buttons: await form.getByRole('button').allTextContents(),
  surface: await page.activeSurface(),
});
\`\`\`

### Locator factories

Use normal Playwright composition:

- \`page.getByRole(role, { name?, exact? })\`
- \`page.getByLabel(text, { exact? })\`
- \`page.getByPlaceholder(text, { exact? })\`
- \`page.getByText(text, { exact? })\`
- \`page.getByTestId(testId)\`
- \`page.getByUid(uid)\` for an exact current \`dom-*\` UID
- \`page.locator(selector)\`
- \`locator.getByRole(...)\`, \`locator.getByText(...)\`, \`locator.locator(...)\`, \`locator.filter(...)\`
- \`page.frameLocator(selector)\` for an observed iframe, then call Page extensions on the Page that owns the resulting locator.

Page and Locator factories automatically exclude CSS-hidden and zero-rectangle candidates before \`count()\` and positional selection. Actions then require exactly one rendered candidate that passes target-style, hit-test diagnostics, and the action-specific Playwright trial. \`first()\`, \`last()\`, and \`nth(index)\` remain validated and are allowed only when current evidence establishes the intended position.

### Actions, waits, and navigation

Normal Locator actions include:

- \`click(options?)\`, \`dblclick(options?)\`, \`hover(options?)\`
- \`fill(value, options?)\`, \`type(text, options?)\`, \`press(key, options?)\`
- \`selectOption(valueOrOptions, options?)\`
- \`check(options?)\`, \`uncheck(options?)\`, \`setChecked(checked, options?)\`
- \`dragTo(target, options?)\`, \`focus(options?)\`

Useful Page waits include \`waitForURL(urlOrRegExp, options?)\`, \`waitForLoadState(state?, options?)\`, \`locator.waitFor({ state, timeout? })\`, and \`waitForResponse(...)\`. Wait for a concrete URL, DOM state, network response, or surface transition; do not use routine fixed sleeps.

- \`await page.expectNavigation(action, options?): Promise<ActionResult>\` starts the navigation wait before invoking \`action\`. Options are \`{ url?: string | RegExp, timeoutMs?: number, waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" }\`.
- Use ordinary Playwright waits and targeted reads to check a URL, visible value, or exact popup id inside a cell. \`page.activeSurface()\` returns the live surfaces; a popup is closed only when its observed id is absent. The browser tool also supplies a bounded post-action state for the next model decision.

Navigation example:

\`\`\`js
var detailsLink = page.getByRole('link', { name: 'Order details', exact: true });
await page.expectNavigation(
  () => detailsLink.click(),
  { url: /\\/orders\\//, waitUntil: 'domcontentloaded', timeoutMs: 30000 },
);
nodeRepl.write({ url: page.url(), title: await page.title() });
\`\`\`

Form controls example:

\`\`\`js
var formRoot = page.getByRole('form', { name: 'Traveler details' });
await formRoot.getByLabel('Full name').fill('Ada Lovelace');
await formRoot.getByLabel('Seat class').selectOption({ label: 'Business' });
await formRoot.getByLabel('Direct flights only').check();
nodeRepl.write({
  name: await formRoot.getByLabel('Full name').inputValue(),
  seat: await formRoot.getByLabel('Seat class').inputValue(),
  direct: await formRoot.getByLabel('Direct flights only').isChecked(),
});
\`\`\`

For controls that react to individual input events, focus the observed editable field and use \`await page.keyboard.type('高豹', { delay: 80 })\` or \`await field.pressSequentially('高豹', { delay: 80 })\`. These use native per-character input. \`fill\`/\`insertText\` are bulk value entry, not equivalent typing. Non-US characters may emit input without keydown/keyup; typing is not an IME composition simulation. Verify the actual suggestions, validation or saved model value; a visible input value alone does not prove the application committed it. If the observed control commits on blur, blur it through a normal focus change and verify. Do not inject synthetic events, change framework state, or blindly add Enter (which may submit).

Before direct keyboard typing, establish which exact element currently has focus and that it is editable and not readonly. A caret-looking decoration or a successful keyboard call does not prove text reached a search field. After a no-op, read the real input attributes/value and relevant options instead of repeating the same text with a different delay. A picker search input may live in its trigger, outside the popup panel; do not invent an input inside the popup, a placeholder, or an expected input count. Never infer that search is unsupported merely because a guessed locator or unfocused typing failed.

Direct keyboard text entry rejects a missing/readonly editor and reports TEXT_INPUT_NOT_DELIVERED when no input event or value change was observed. Native \`input\`, native \`change\`, and framework/component outputs are different contracts: adding delay does not make Chinese text produce keyup or composition events. For a text field known to commit on blur, use \`await field.blur()\` after typing, then read the resulting validation/model display. Keep focus for live suggestion filtering. Selecting an option may be the commit action for a picker; typing alone is not selection. Verify the relevant component outcome in the same call when its interaction is already known.

## Popups, dropdowns, date/time pickers, and nested surfaces

Treat every newly opened menu, listbox, dialog, popover, calendar, or time panel as a bounded interaction transaction:

1. Click only an observed trigger.
2. Read \`page.activeSurface()\` and a targeted snapshot together after it opens. Remember the newly opened surface id, its frame/selector and the trigger. Distinguish it from an existing parent dialog.
3. Scope choices to the observed surface or stable field container.
4. Select the observed option/date/time.
5. Do not assume selection auto-closes the popup. If an Apply/Done/OK control is required to commit the selection, use it. Otherwise, if a selector/menu option surface remains open and you only need to close it, call browser action=dismissSurface first; it clicks viewport (0,0). For a dialog with an explicit Close/Cancel button, use that button first.
6. Verify the field value and that this exact surface closed before targeting outside it. A remaining parent dialog is expected. Inspect the separate dismissSurface result before continuing. Do not click the trigger again after the popup has closed, as that reopens it.

For closing an option surface, prefer dismissSurface over a code-based or coordinate outside click, the original trigger, or guessing a close target. It sends the click even when surface detection misses the popup, and reports whether closure was confirmed. If it did not close the surface, do not repeat it unchanged; inspect the current surface and use an observed toggle or control. For dialogs with a visible Close/Cancel button, use that button first. After two distinct attempts with no change, return one consolidated targeted diagnosis (surface id/stack, trigger, visible controls and blocker), then choose a new evidence-supported action. Never remove overlay DOM, change styles, or bypass the application's close handlers. Remember a verified dismissal method for the same control during this task, and re-check the live popup before reusing it.

Custom dropdown that stays open:

\`\`\`js
var cabinTrigger = page.getByRole('button', { name: 'Cabin class', exact: true });
var cabinBefore = await page.activeSurface();
await cabinTrigger.click();
var cabinOpen = await page.activeSurface();
var cabinPopup = cabinOpen.activeSurface;
if (!cabinPopup || cabinBefore.surfaces.some(s => s.id === cabinPopup.id)) throw new Error('No distinct new popup identified; inspect the field region before choosing.');
nodeRepl.write({ surface: cabinOpen, snapshot: await page.domSnapshot() });
\`\`\`

After that read exposes the exact option and Done labels, use the later action cell:

\`\`\`js
var businessOption = page.getByRole('option', { name: 'Business', exact: true });
await businessOption.click();
var afterChoice = await page.activeSurface();
if (afterChoice.surfaces.some(s => s.id === cabinPopup.id)) {
  var doneButton = page.getByRole('button', { name: 'Done', exact: true });
  if (await doneButton.count() !== 1) throw new Error('Dropdown remained open and the previously observed Done control is no longer unique.');
  await doneButton.click();
}
if (cabinPopup.selector) await page.locator(cabinPopup.selector).waitFor({ state: 'hidden' });
var cabinAfter = await page.activeSurface();
if (cabinAfter.surfaces.some(s => s.id === cabinPopup.id)) throw new Error('Cabin popup remains open.');
nodeRepl.write({ value: await cabinTrigger.innerText(), surface: cabinAfter });
\`\`\`

Date/time picker with an explicit confirmation starts with a read cell:

\`\`\`js
var departureField = page.getByLabel('Departure date and time');
await departureField.click();
var departureOpen = await page.activeSurface();
var departurePopup = departureOpen.activeSurface;
nodeRepl.write({ surface: departureOpen, snapshot: await page.domSnapshot() });
\`\`\`

After the preceding read exposes the exact calendar/time labels, use a later action cell:

\`\`\`js
var dayButton = page.getByRole('button', { name: 'August 28, 2026', exact: true });
await dayButton.click();
var timeOption = page.getByRole('option', { name: '10:30 AM', exact: true });
await timeOption.click();
var applyDateTime = page.getByRole('button', { name: 'Apply', exact: true });
await applyDateTime.click();
if (!departurePopup) throw new Error('No observed date/time popup was recorded.');
if (departurePopup.selector) await page.locator(departurePopup.selector).waitFor({ state: 'hidden' });
var remainingSurface = await page.activeSurface();
if (remainingSurface.surfaces.some(s => s.id === departurePopup.id)) throw new Error('Date/time popup remains open.');
nodeRepl.write({ value: await departureField.inputValue(), surface: remainingSurface });
\`\`\`

These labels are illustrative. Never copy an example label into a real call unless it appears verbatim in the latest evidence.

Surface metadata is evidence, not permission. If an action fails with \`coveredBySurfaceId\` or \`activeSurfaceId\`, use the current returned evidence; when insufficient, obtain \`await page.activeSurface()\` plus one targeted snapshot/read together. Inspect that exact id, its label/descriptor/selector/stack, then wait for a loading surface to disappear or close the observed surface. Combine the grounded recovery and its verification in one later cell. Do not repeatedly request the same snapshot, scroll, force, or repeat an unchanged failed action.

An overlay root may be a full-viewport backdrop while its visible dialog or dropdown is another surface. DOM order is not visual stacking: do not scope a Cancel/Close button through \`page.locator('[id*=overlay]').last()\` merely because it is the last overlay node. A failed browser result includes live \`diagnostics.surfaces\`, \`surfaceStack\`, and visible \`controls\` with any center-point \`blocker\`; use them before changing the script. When a selector/menu option surface intercepts a dialog's visible button, dismiss that option surface first with browser action=dismissSurface, then inspect its returned surface state. If it remains open, use a currently observed alternative. Once the blocker is gone, resolve the dialog's actual Cancel/Close button by its current accessible name or observed surface selector and verify the dialog closed. A failed first statement prevents later statements in the same code cell from running; do not hide the recovery behind a failed click. Do not use a forced click on the covered button, arbitrary coordinates, or SPA navigation to bypass the popup.

## Precise text editing

\`await targetPage.setTextSelection(locator, spec)\` focuses a verified editable and returns \`{ start, end, selectedText, collapsed, direction, editableTextLength, verified }\`.

Selection forms:

- \`{ exactText, occurrence?, direction? }\`
- \`{ start: { offset | afterText | beforeText, occurrence? }, end?: { ... }, direction? }\`

Use the keyboard of the Page that owns the locator in the same cell:

\`\`\`js
var notes = page.getByLabel('Notes');
var selected = await page.setTextSelection(notes, { exactText: 'old date' });
await page.keyboard.insertText('new date');
nodeRepl.write({ selected, value: await notes.inputValue() });
\`\`\`

For a frame locator, determine the owning Page and call that Page's \`setTextSelection\`; do not directly mutate DOM text.

## Images and coordinates

For a vision-capable model, screenshot-to-coordinate interaction is the visual fallback when targeted DOM snapshots, role/text/label locators, frames, and active-surface inspection still cannot expose the intended visible control. Do not keep probing selectors indefinitely. Every browserCode result already supplies a current viewport screenshot when automatic screenshots are enabled; inspect that image before using its coordinates. If no current automatic image is available, use this two-step chain:

1. In one read-only browserCode cell, capture the current viewport with \`page.screenshot({ fullPage: false })\`, emit it with \`nodeRepl.emitImage(...)\`, and end the cell without clicking.
2. In the next model step, inspect that exact screenshot and use \`page.mouse\` or \`tab.cua\` to click the visually identified viewport coordinate. The page, tab, URL, viewport, zoom, scroll position, and visible layout must still match the screenshot.
3. After the coordinate action, verify the expected DOM, URL, value, surface, or other business-state result. If the screenshot is stale or the target is not visually unambiguous, take a new screenshot instead of guessing.

Prefer DOM/Locator evidence whenever it exists. Screenshot coordinates are a fallback for controls that are genuinely visible but unavailable through usable DOM evidence, such as canvas content, non-semantic graphics, or inaccessible custom rendering.

Emit visual evidence and end the cell:

\`\`\`js
var viewportImage = await page.screenshot({ fullPage: false });
await nodeRepl.emitImage(viewportImage);
nodeRepl.write({ url: page.url(), viewport: page.viewportSize() });
\`\`\`

For a vision-capable model, the latest automatic or explicitly emitted viewport image visible to the model authorizes multiple coordinate/CUA clicks while the document, URL, viewport, browser zoom, scroll position, and five-minute validity remain unchanged. Repeated coordinate clicks may share that image when those boundaries hold; an unrelated input retires it. Inspect the returned viewport after the cell before choosing dependent actions. Explicit screenshot-and-click in the same cell is forbidden because the model cannot see that new image until the next step. Full-page screenshots are read-only evidence and never authorize coordinates.

For a non-visual model, or whenever exact DOM geometry is more reliable than pixels, derive coordinates from one exact visible Locator. \`boundingBox()\` is a read-only measurement: it does not scroll or require clickability, so covered elements can be inspected. A rect is not proof that the point can receive input. The runtime validates the corresponding live target when using rect-based coordinate evidence. Click only inside that returned rect; the rect may be computed and used in the same cell or written for model inspection and reused in a later cell while the DOM revision and page geometry remain unchanged and no state-changing input has intervened.

\`\`\`js
var menuTrigger = page.getByRole('button', { name: 'Open menu', exact: true });
var menuRect = await menuTrigger.boundingBox();
if (!menuRect) throw new Error('The observed Open menu control has no current viewport rect.');
await page.mouse.click(
  menuRect.x + menuRect.width / 2,
  menuRect.y + menuRect.height / 2,
);
nodeRepl.write({ clickedInsideObservedRect: true });
\`\`\`

To let a non-visual model inspect the numeric rect before choosing a point, return it in one cell and click in the next. A top-level \`var\` preserves the binding only if the kernel remains alive, so reacquire the locator and rect if the result reports \`kernelReset\`:

\`\`\`js
var chart = page.locator('canvas[data-testid="sales-chart"]');
var chartRect = await chart.boundingBox();
if (!chartRect) throw new Error('The observed chart has no current viewport rect.');
nodeRepl.write({ chartRect });
\`\`\`

\`\`\`js
await page.mouse.click(chartRect.x + chartRect.width * 0.75, chartRect.y + chartRect.height * 0.40);
nodeRepl.write({ clicked: true });
\`\`\`

Never use guessed coordinates. Rect-derived clicks must stay inside the recorded rect. Both screenshot and rect evidence become stale after navigation, tab/document change, scroll, zoom, viewport change, or five minutes.

## Attachments and credentials

- \`await attachmentVault.setInputFiles(locator, attachmentId): Promise<{ uploaded, attachmentId, fileName, selectedFiles }>\` uploads one registered user attachment. Direct \`Locator/Page.setInputFiles\`, FileChooser paths, reconstructed bytes, Blob/File/Buffer payloads, and local paths are forbidden.
- \`await credentialVault.fill(locator, ref): Promise<{ filled, origin }>\` fills a registered credential only on an allowed HTTP(S) origin. Never read the filled value or return the reference.

\`\`\`js
var uploadInput = page.locator('input[type="file"][name="attachment"]');
var upload = await attachmentVault.setInputFiles(uploadInput, 'attachment-id-from-runtime-context');
nodeRepl.write(upload);
\`\`\`

\`\`\`js
var username = page.getByLabel('Username');
await credentialVault.fill(username, 'credential-ref-from-runtime-context');
nodeRepl.write({ filled: true, origin: new URL(page.url()).origin });
\`\`\`

## Failure recovery

- Preserve the exact failed code, locator, action, and complete error. Use the error and \`failureCategory\` as evidence, then choose the smallest evidence-backed correction.
- Actionability/zero-match: refresh the target region and active surface, then rebuild the locator from new evidence.
- Screenshot timeout: switch to DOM/locator/value evidence; do not loop through screenshot variants unless pixels are essential.
- Execution context destroyed: wait once for a concrete load state/URL, reacquire locators, and avoid evaluate/reload loops.
- Serialization/output failure: map complex values to primitives and reduce the output; do not inspect private framework object graphs.
- Policy violation: use the documented safe API. Never bypass Playwright with DOM \`.click()\`, \`dispatchEvent('click')\`, or scripted DOM mutation.

Use \`force: true\` only when fresh evidence proves one exact rendered target and an intentional overlay/backdrop is the sole blocker. It is forbidden for ambiguous, hidden, detached, disabled, or unobserved targets.

## Optional interactive review reference

For UI debugging, responsive layout review or browser/Electron acceptance tasks, read skill action=read with skillId=system-browser-interactive-qa. It covers persistent-session iteration and functional/visual evidence through this host's APIs. Routine browsing and single business operations do not require it.

## Completion contract

Failed cells return bounded \`data.diagnostics\` with the active surface and actual rendered controls: focus, readonly/editability, names/placeholders, geometry and center hit-test status. Input values are omitted. Use this evidence before another read; if the receipt was truncated, use its contextRead reference to retrieve the diagnostics instead of repeating the failed action. A diagnostic center hit test is not a click authorization. Prefer the observed form/popup and exact field attributes. Broad whole-page div/span/li scans filtered by guessed coordinates can include obscured background rows and truncate away the real controls. Do not call that output a filtered option list. If a Cancel button is physically covered by an open list, verify dismissal of that list first; force-clicking Cancel can hit an option instead. Keep the app's own dismissal handlers and verify each changed state.

Playwright delivery alone is not business success. Check the requested URL, value, row/table state, toast, dialog, confirmation identifier, or other direct fact after an interaction, preferably in the same cell; also inspect \`page.activeSurface()\` for interactive workflows. For read-only research, relevant content returned by the navigation-and-read cell is sufficient evidence; no separate verification cell is required. Report an unresolved failure or residual popup when it materially limits the outcome. Never describe a page as ready for a consequential final click if the latest verified state is on another page or no longer contains that control.
`;

const browserRuntimeCoreHeadings = new Set([
  'Required state machine', 'Efficient lookup and search', 'Host tool boundary', 'Cell syntax and result contract',
  'Failure recovery', 'Completion contract',
]);
const browserRuntimeSections = browserCodeRuntimeManual.split(/(?=^## )/m).slice(1).map((content) => ({
  title: content.match(/^## (.+)/)![1], content: content.trim(),
}));
const browserRuntimeReferenceSections = browserRuntimeSections.filter(({ title }) => !browserRuntimeCoreHeadings.has(title)).map(({ title, content }) => {
  const id = `system-browser-reference-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const pages: string[] = [];
  let remaining = content;
  while (remaining.length > 9000) {
    const newline = remaining.lastIndexOf('\n', 9000);
    const end = newline > 4500 ? newline + 1 : 9000;
    pages.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) pages.push(remaining);
  return { id, title, pages };
});

export const browserRuntimeReferenceSkills: readonly CapabilitySkill[] = Object.freeze(
  browserRuntimeReferenceSections.flatMap(({ id, title, pages }) => pages.map((content, index) => Object.freeze({
    id: index ? `${id}-${index + 1}` : id,
    title: `${title}${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ''}`,
    summary: '', required: false,
    content: `# Browser reference: ${title} (${index + 1}/${pages.length})\nOptional reference excerpt. Follow the compact Browser Code Runtime rules and current tool schema.\n\n${content}\n\n${index + 1 < pages.length ? `Continuation, only if needed: skill action=read skillId=${id}-${index + 2}.` : 'End of this reference. Continue the user task; do not load unrelated references.'}`,
  }))),
);

export const browserCodeRuntimeSkillContent = `# Browser Code Runtime

These are the required operating rules. A successful current read satisfies the Skill prerequisite. Reuse it while present; do not repeatedly read this Skill or reconstruct the whole manual through contextRead. Detailed references below are optional, not further prerequisites.

${browserRuntimeSections.filter(({ title }) => browserRuntimeCoreHeadings.has(title)).map(({ content }) => content).join('\n\n')}

## References: read only for the current operation
For unfamiliar runtime methods, read the API reference before calling them. Read popup/text/image/credential guidance when that kind of interaction is needed. Use skill action=read with the ID below. Longer references supply a continuation ID; stop when the needed information is found. Never load every reference just to begin browsing.
${browserRuntimeReferenceSections.map(({ id, title }) => `- ${title}: ${id}`).join('\n')}
`;

export const browserRuntimeSkill = Object.freeze({
  id: browserCodeRuntimeSkillId,
  title: 'Browser Code Runtime',
  summary: browserCodeRuntimeSkillSummary,
  content: browserCodeRuntimeSkillContent,
  required: true,
  activation: [{ toolName: 'browser', actions: ['code', 'state', 'waitForHumanVerification'] }],
} satisfies CapabilitySkill);
