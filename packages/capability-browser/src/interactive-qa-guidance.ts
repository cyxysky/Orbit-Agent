import type { CapabilitySkill } from '@webpilot/capability-sdk';

export const browserInteractiveQaSkill = Object.freeze({
  id: 'system-browser-interactive-qa',
  title: 'Interactive browser and Electron review',
  required: false,
  summary: '<system_skill>\n<id>system-browser-interactive-qa</id>\n<title>Interactive browser and Electron review</title>\n<description>Optional persistent-session workflow for UI debugging, functional acceptance, viewport fit and visual review. Read for explicit UI review tasks, not routine browsing.</description>\n<required>false</required>\n</system_skill>',
  content: `# Interactive UI review

Use for browser/Electron UI debugging and acceptance review. Operate through the host browser tool and its documented page/context/browser/tab bindings. Keep the base Browser Code Runtime rules, locator evidence and action boundaries.

## Preserve the controlled session

Reuse the existing page and context across iterations. Name handles for each relevant surface instead of rediscovering all tabs every step. Reusable top-level var bindings last only while the kernel lives; persist non-secret progress through agent.state when needed. After kernelReset, reacquire handles from the host. Reset is recovery, not routine cleanup.

Renderer changes may require a reload of the same controlled page when authorized; main-process/startup changes require the owning host to restart its runtime. Do not import Playwright, launch another browser/Electron process, close the user's context, change sandbox settings, or start a dev server based on upstream examples. A Skill does not grant missing lifecycle APIs. Use only the runtime capabilities actually exposed.

## Define observable acceptance

For the requested UI scope, map each requirement and intended completion claim to a visible state, an action and an observable result. Include meaningful controls, mode changes and transitions. For subjective visual requirements, identify observable properties such as readable labels, stable spacing or unclipped content. Include relevant empty/error/long-content or cancel/retry states when they could affect the requested behavior; do not impose a fixed number of scenarios on every task.

Use this compact inventory for both functional and visual review. Keep it in working state instead of repeatedly printing the whole plan.

## Function and appearance are separate checks

Exercise controls with normal user input and verify business postconditions. A resolved click promise only confirms interaction delivery. Check the resulting value, URL, row, dialog state or confirmation identifier and inspect the active surface. Follow existing authorization for consequential submissions.

Then inspect screenshots of the states that support visual claims. DOM counts and geometry do not establish visual quality. Review hierarchy, alignment, text wrapping, contrast, clipping, overlay placement and responsive behavior. Use a readable viewport image for overall fit and focused images for details; a full-page capture can hide a broken initial viewport. Avoid claiming screenshot evidence if the model did not receive and inspect the image.

Record the URL, viewport and relevant state with the evidence. If the host supports changing viewport, choose dimensions appropriate to the requested devices and keep them stable across comparisons. Electron/native-window behavior and emulated viewports are distinct environments; report which was actually checked. Do not claim mobile or native-window coverage from a desktop screenshot, or invent unsupported viewport APIs.

## Iterate with focused evidence

After a fix, repeat the affected interaction and inspect its resulting state; broaden review only where shared layout or state flow changed. Refresh stale locators/screenshots after navigation, resizing, scrolling or a relevant DOM change. Read a target region rather than dumping the whole application each step; filter and count in code before returning compact evidence through nodeRepl.write.

Before completion, compare claims with actual evidence and state any remaining defect or unverified environment. Preserve the user's session and artifacts. Review success comes from the observed UI outcome, not from a screenshot file's existence or a successful tool call.
`,
} satisfies CapabilitySkill);
