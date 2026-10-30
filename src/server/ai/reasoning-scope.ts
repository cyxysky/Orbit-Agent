import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeReasoningEffort, type ReasoningEffortSetting } from '@/lib/reasoning-effort';

const globalScope = globalThis as typeof globalThis & { webpilotReasoningScope?: AsyncLocalStorage<ReasoningEffortSetting> };
const scope = globalScope.webpilotReasoningScope ??= new AsyncLocalStorage<ReasoningEffortSetting>();
export function currentReasoningEffort(): ReasoningEffortSetting {
  return scope.getStore() ?? normalizeReasoningEffort(process.env.AI_REASONING_EFFORT);
}
export function withReasoningEffort<T>(effort: ReasoningEffortSetting | undefined, callback: () => T): T {
  return scope.run(effort ?? currentReasoningEffort(), callback);
}
