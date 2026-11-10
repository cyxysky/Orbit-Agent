import { defaultAgentSystemPrompt, parseAgentPromptVariables, renderAgentPrompt } from '@/lib/agent-prompt-template';
import { runtimeSetting } from '@/server/settings/runtime-configuration';

export function agentSystemPrompt(input: {
  userId?: string; sessionId?: string; targetUrl?: string; provider: string; model: string;
  tools: Array<{ name: string; description: string }>; now?: Date;
}) {
  const values = {
    'user.id': input.userId || '', 'session.id': input.sessionId || '', 'session.url': input.targetUrl || '',
    'model.provider': input.provider, 'model.name': input.model, 'time.iso': (input.now || new Date()).toISOString(),
    'time.zone': Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    'tools.names': input.tools.map(tool => tool.name).join(', '),
    'tools.descriptions': input.tools.map(tool => `${tool.name}: ${tool.description}`).join('\n'),
  };
  const prompt = renderAgentPrompt(runtimeSetting('AI_SYSTEM_PROMPT_TEMPLATE') || defaultAgentSystemPrompt, values,
    parseAgentPromptVariables(runtimeSetting('AI_SYSTEM_PROMPT_VARIABLES') || '{}'));
  return runtimeSetting('AI_TOOL_PROMPT_MODE') === 'available'
    ? `${prompt}\n\nCurrent tools:\n${values['tools.descriptions']}` : prompt;
}
