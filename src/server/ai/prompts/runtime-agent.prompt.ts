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
    'Use this time for relative dates. Check source dates for time-sensitive claims, and honor a date explicitly specified by the user.',
  ].join('\n');
}

export function buildCodexObjectPrompt(
  prompt: string,
  allowedTypes: string[],
  browserMode: BrowserChatInteractionMode = 'hybrid',
) {
  const answerAllowed = allowedTypes.includes('answer');
  const browserEnabled = allowedTypes.includes('browser');
  return [
    prompt,
    '',
    browserEnabled ? `Current browser params schema: ${JSON.stringify(z.toJSONSchema(browserInteractionSchema(browserMode)))}` : '',
    'Codex local mode uses action objects because native function calling is unavailable. Each listed type executes the corresponding real tool.',
    '- Return exactly one object per step: { "type": string, "message"?: string, "params": object }. The next step receives its result. Keep optional message and user-facing reasons in Chinese.',
    `- type must be one of: ${allowedTypes.join(', ')}.`,
    allowedTypes.includes('contextRead') ? `- contextRead: ${contextReadDescription}\nParams schema: ${JSON.stringify(z.toJSONSchema(contextReadInputSchema))}` : '',
    allowedTypes.includes('skill') ? '- For skill, set params.action="read" and provide the exact params.skillId from an available <system_skill> or user Skill summary before the governed tool action.' : '',
    browserEnabled ? '- For browser, choose params.action and required fields from the current mode schema; include a concise params.reason. Follow the current browser protocol supplied in context.' : '',
    allowedTypes.includes('finalResponse')
      ? '- Complete the turn with type="finalResponse" and ordered params.blocks. type="answer" is progress narration only.'
      : answerAllowed
        ? '- This step may use type="answer" only for non-terminal progress narration.'
        : '- A final answer is unavailable in this step; execute an allowed tool and continue from its result.',
  ].filter(Boolean).join('\n');
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
