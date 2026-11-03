# Orbit

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product and tasks

Orbit is a browser and local-capability agent workspace. The existing application supports conversations, tool execution, operation confirmations, generated files, reusable skills and personal memory, login accounts, automation tasks and schedules, environment settings, and administrator AI operations. These are existing capabilities, not proposed new services.

## Confirmed design brief

The user cancelled the full layout redesign. Preserve the existing desktop sidebar, conversation and automation structures. Apply the user's five Global Settlement reference screenshots to the theme, settings content cards, shared dialogs, terminal content, and conversation memory/file overlays. Subsequent requests explicitly move browser settings under tool capabilities, divide long setting groups by purpose, remove the provider content width cap, and redesign AI operations using the Global Settlement live dashboard as a reference. Do not resume the rejected rail, inspector, queue or workbench layouts.

Keep Orbit product facts, assets, authorization semantics and existing functional repairs. Use pale gray canvas, white rounded cards, charcoal primary buttons and restrained lime accents. Main navigation and secondary menus share gray selection (#d9dfe1) with dark text and icons; keep settings area backgrounds white. Use the Global Settlement system font stack with the user's requested 14px size, 400 weight and 1.45 line height (20.3px). Keep typography and the gray selected surface unchanged during hover and keyboard focus. Apply this consistently to main navigation, settings categories, configuration groups, provider names and settings tabs. AI operations presents four primary metrics, a switchable daily trend, a charcoal activity summary, and readable issue and usage tables while preserving all filters and runtime controls. Settings cards use two columns with labels above inputs for general and provider identity fields; preserve compact label/control rows for numeric settings, switches and model lists. Tool capabilities provide 13 global switches through the existing administrator settings; disabled tools disappear from the conversation tool list and cannot execute, while per-conversation preferences remain independent. Dialogs use white sections and thin dividers, with plain text titles instead of tab-shaped backgrounds. Keep the terminal's existing list and controls; its content is a black rounded card (#1a2227, 14px radius) with light output text and an 8px outer gap. Remove the divider between terminal sidebar and content and the selected terminal's vertical marker. Keep files grouped by message and memory proposals in a vertical review list. A/B/C remain historical static prototypes, not a pending production layout decision.

Remove the 14 unused preset providers identified by the user: Groq, xAI, Mistral AI, Alibaba Cloud, Vercel AI Gateway, Perplexity, Cohere, Together.ai, Fireworks AI, DeepInfra, Cerebras, Hugging Face, Amazon Bedrock and Vercel v0. Remaining providers and custom OpenAI-compatible entries come from the shared provider catalog.

Custom OpenAI-compatible providers can be deleted from their list row after confirmation. Persist removal of the provider's models, settings, credentials, ordering and media selections. If the default is deleted, select a remaining enabled provider; with none enabled, leave AI execution disabled. Built-in providers cannot be deleted. Deleted custom entries must not reappear when settings are normalized or saved again.

The conversation panel uses a white card surface. Tables share a continuous white header/body surface without gray framing or rounded body insets. Memory tables show titles and metadata; open the title for full details. Remove the memory applicability/context inputs and skill reference-resource editor; retain existing stored data when editing other fields. Model selection presents reasoning effort as a compact, always-visible option grid at the bottom of the menu, without an expanding accordion.

## Constraints

- Preserve existing capabilities, product facts, authorization boundaries and API behavior.
- Keep the existing Next.js, React and HeroUI application and the Orbit name and assets.
- Support the current Chinese and English interfaces, light and dark themes, keyboard navigation and narrow viewports.
- Use generic shared components rather than control-specific business exceptions.
- Do not run project dev/build or add test files. Prefer the Capability SDK for local operations.
- Keep the independent preview-loading and context-persistence repairs.

## Audience and operating context

The confirmed use is completing and monitoring agent tasks in a workbench. More specific audience segmentation and commercial positioning are unspecified; the redesign must not invent them.

## Success

Users can identify the current task, execution status, next action and results at a glance; access tools and detail without losing the main task; and operate consistent, legible dialogs with predictable scrolling, closing, validation and recovery states.
