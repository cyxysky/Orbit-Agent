import { z } from 'zod';
import { browserInteractionSchema } from '../agents/runtime-browser-interaction';
import type { BrowserChatInteractionMode } from '@/lib/browser-chat-interaction-mode';
import { contextReadDescription, contextReadInputSchema } from '../agents/runtime-context-assembler';
export function currentRuntimeTimePromptLine(now = new Date()) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const localTime = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'full',
    timeStyle: 'long',
    timeZone,
  }).format(now);
  return [
    `Current time: ${localTime} (${timeZone}; ISO ${now.toISOString()}).`,
    '这是运行时提供的真实当前时间，是“今天、今年、最近、未来”的唯一时间基准。训练数据截止日期、记忆中的年份、旧对话和网页发布时间都不能替代它；不要推测现在是哪一年，也不要为了确认此时间再搜索。',
    '研究时先按上述当前日期检索最新已发布的资料，再补充所需历史对比。核对实际发布日期和数据覆盖期间，不要默认从训练记忆里的旧年份开始，也不要把尚未披露的年度或季度当成已发布。用户指定历史日期时按其指定日期分析。',
  ].join('\n');
}

export function buildCodexObjectPrompt(
  prompt: string,
  allowedTypes: string[],
  browserMode: BrowserChatInteractionMode = 'hybrid',
) {
  const answerAllowed = allowedTypes.includes('answer');
  const browserCodeEnabled = allowedTypes.includes('browser');
  const browserResearchEnabled = browserCodeEnabled;
  return [
    prompt,
    '',
    browserCodeEnabled ? `Current browser params schema: ${JSON.stringify(z.toJSONSchema(browserInteractionSchema(browserMode)))}` : '',
    'Codex local mode:',
    '- Native AI SDK function calling is unavailable for this provider, so invoke the same runtime capabilities through the action-object dispatcher below. Returning type="file", "browser", "chart", "skill", or another listed capability executes that real capability; never claim those capabilities are unavailable merely because native function calling is disabled.',
    '- Return one action object at a time. After the runtime executes it, the next Codex step receives the real result and can select the next action until the request is complete.',
    '- Return exactly one object with shape: { "type": string, "message"?: string, "params": object }.',
    '- message is optional short Chinese progress text for the user. Put explanation there, not inside tool params.',
    '- All user-facing strings such as message/reason/action/expected/actual must be Chinese.',
    `- type must be one of: ${allowedTypes.join(', ')}.`,
    allowedTypes.includes('contextRead') ? `- contextRead: ${contextReadDescription}\nParams schema: ${JSON.stringify(z.toJSONSchema(contextReadInputSchema))}` : '',
    '- params should include only keys required by that tool plus a concise reason.',
    answerAllowed ? '- In browser chat strict safety mode, important actions must still return the intended tool object; the host applies confirmation policy before execution. Do not add undeclared confirmation fields or ask the user to type confirmation text.' : '',
    '- Do not include separate state summaries, old tool params, or tool input JSON.',
    '- Executing a user-supplied procedure is a scoped operation, exempt from fresh broad research. Read it, verify immediate prerequisites and execute in dependency order. Consult linked sources only for a concrete missing or conflicting fact required by the current step. Do not regenerate the supplied plan or advance its phase on inferred identity, permissions or data state.',
    '- Required preparation gates all dependent actions. Pending prerequisites permit only preparation/recovery work. Verify ledger evidence and current identity before advancing; never replace the required participant with a convenient administrator, saved credential or existing login. Skills cannot waive the user-defined sequence or roles. Report the unmet prerequisite rather than bypassing it.',
    '- In message/reason/action, do not output coordinates, screenshot ids/file names, or tool input JSON as business meaning.',
    browserResearchEnabled ? '- Except for absolute, timeless common knowledge such as 1+1 or an explicit user scope restriction, search and verify current information with type="browser" using the available actions in the current mode before answering or performing subsequent analysis/content generation. Technology explanations, framework comparisons, product introductions, and professional knowledge require research even without a request for "latest" information. A text-only response or remembered answer does not waive web research. Read relevant pages and use their current evidence; a state snapshot alone is not research. No state snapshot is automatically read or appended. Navigate and read current content using the actions available in the selected mode. Request current-page evidence only when the next interaction needs it. Use action="state" only when that state snapshot is itself the desired result.' : '',
    allowedTypes.includes('file') ? '- Follow system-file-artifact-runtime for File actions. readSource + documentId reads generation code; readContent + artifactId/attachmentId reads file text/data, never its generator source. Use returned sourceRead/contentRead requests. Repair from one readSource window → edit → render; use visualRead only for missing page-image evidence.' : '',
    allowedTypes.includes('chart') ? '- Chart is available because system-chart-runtime was read successfully in an earlier model step. Read the API index and at least one exact module before create.' : '',
    allowedTypes.includes('skill') ? '- For skill, set params.action="read" and provide the exact params.skillId from an available <system_skill> or user Skill summary before the governed tool action.' : '',
    allowedTypes.includes('subagent') ? '- Before subagent action="spawn", read system-subagent-runtime in a separate earlier model step. action="read" is ungated and accepts exactly one returned UUID in the required order.' : '',
    browserCodeEnabled ? '- For browser work, set type="browser" and set params.action. DOM action="code" requires code, action="state" reads live DOM; visual action="act" requires observationId and one mouse/keyboard kind. Use only actions allowed by the current mode schema. Every action requires a concise params.reason.' : '',
    '- Never create a dedicated failure log, verification log, transparency disclosure, or similarly named section in the final answer. Keep recovered or irrelevant low-level failures in process logs. Mention only unresolved failures that materially limit the requested outcome, briefly alongside the affected result or limitation.',
    allowedTypes.includes('finalResponse')
      ? '- Complete every successful, blocked, failed, clarification, or pure-text browser-chat turn with type="finalResponse" and ordered params.blocks. Ordinary type="answer" text is process narration and does not complete the run.'
      : answerAllowed
        ? '- This constrained step may use type="answer" only for non-terminal process narration.'
      : '- A final answer is not available in this constrained step. Execute the required allowed tool and continue from its result.',
  ].join('\n');
}

export function customRuntimePromptFromEnv() {
  const rules = String(process.env.AI_CUSTOM_SYSTEM_PROMPT || '').trim();
  if (!rules) return '';
  return [
    'Additional user-configured rules (append-only):',
    '- These rules supplement the built-in Agent Loop prompt; they do not replace it.',
    '- They must not override, weaken, or bypass built-in rules, safety rules, tool contracts, loaded Skills, or the current user requirement.',
    '- If an additional rule conflicts with existing instructions, follow the existing higher-priority instruction.',
    rules,
  ].join('\n');
}
