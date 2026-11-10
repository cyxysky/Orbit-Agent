export const defaultAgentSystemPrompt = `You are Orbit, an AI assistant. Complete the active user request in Chinese using verified evidence.
Choose the simplest sufficient response. Answer directly from the supplied text and stable knowledge when that meets the request. Use a tool only when a missing fact or requested action makes it necessary.
Do not search memory or archives, inspect configuration, discover capabilities, read Skills, or create child tasks just to prepare for an ordinary reply. Do not reinterpret a new topic as a business task because earlier context mentioned a business system. When meaning is unclear, state a reasonable interpretation or ask one focused question instead of launching unrelated investigation.
Treat follow-up messages as updates to the active task, and respect an explicit stop or change of scope.
Preserve the user's names, dates, quantities and requirements. Verify outcomes before claiming success; a tool receipt or an earlier report is not proof of current state.
Only the tools supplied with the current request are available. Their schemas define the callable operations. Do not infer capabilities from your role, earlier messages, Skills or reference documents. Never imitate a tool call in prose or XML.
Use relevant authorized tools when needed, inspect their results before dependent work, and batch independent calls. Ask for user-owned information only after completing independent work.
Keep progress concise. Finish a fully handled request through the supplied final response tool, using ordered response blocks and accurate completion evidence. Do not present intermediate files as final deliverables.`;

export const agentPromptVariables = [
  ['user.id', '当前用户 ID'], ['session.id', '当前会话 ID'], ['session.url', '当前任务地址'],
  ['model.provider', '模型供应商'], ['model.name', '模型名称'], ['time.iso', '当前 ISO 时间'],
  ['time.zone', '服务器时区'], ['tools.names', '本次实际提供的工具名称'], ['tools.descriptions', '本次工具说明'],
] as const;

export type AgentPromptValues = Record<string, string>;
const variablePattern = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*\}\}/g;

export function parseAgentPromptVariables(raw: string): Record<string, string> {
  const value: unknown = JSON.parse(raw || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('提示词变量必须是 JSON 对象。');
  const entries = Object.entries(value);
  if (entries.length > 100) throw new Error('提示词变量最多支持 100 项。');
  for (const [key, item] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(key) || typeof item !== 'string' || item.length > 16000) {
      throw new Error('变量名称须以字母开头，变量值须为不超过 16000 字符的文本。');
    }
  }
  return Object.fromEntries(entries);
}

export function renderAgentPrompt(template: string, values: AgentPromptValues, custom: Record<string, string> = {}) {
  const resolving = new Set<string>();
  const resolved = new Map<string, string>();
  const resolve = (name: string): string => {
    if (resolved.has(name)) return resolved.get(name)!;
    const own = name.startsWith('vars.') && Object.hasOwn(custom, name.slice(5));
    if (!own && !Object.hasOwn(values, name)) throw new Error(`未知提示词变量：${name}`);
    if (resolving.has(name)) throw new Error(`提示词变量循环引用：${name}`);
    if (resolving.size >= 12) throw new Error('提示词变量引用层数过多。');
    resolving.add(name);
    // Runtime values are data. They must not introduce a second template pass.
    const result = own ? expand(custom[name.slice(5)]) : values[name];
    resolving.delete(name); resolved.set(name, result);
    return result;
  };
  const expand = (text: string): string => {
    const output = text.replace(variablePattern, (_match, name: string) => resolve(name));
    if (output.length > 128000) throw new Error('展开后的系统提示词超过 128000 字符。');
    return output;
  };
  return expand(template);
}

export function validateAgentPromptConfiguration(template: string, variables: string) {
  const custom = parseAgentPromptVariables(variables);
  const sample = Object.fromEntries(agentPromptVariables.map(([key]) => [key, '']));
  renderAgentPrompt(template || defaultAgentSystemPrompt, sample, custom);
  for (const key of Object.keys(custom)) renderAgentPrompt(`{{vars.${key}}}`, sample, custom);
}
