/** Application execution details, independent of the selected runtime implementation. */
export function executionStatusText(value: string) {
  return value
    .replace(/Codex App Server\s*(?:正在执行会话|执行会话)/gi, '处理中')
    .replace(/Codex\s*(?:会话回合已开始|会话回合已结束)/gi, match => match.includes('开始') ? '本轮处理已开始' : '本轮处理已结束')
    .replace(/Codex\s*(?:正在压缩上下文|已完成上下文压缩|思考记录|已发送模型供应商请求)/gi, match => match.replace(/Codex\s*/i, ''))
    .replace(/Codex App Server exited\s*\(([^)]+)\)/gi, '模型运行进程异常退出（$1）')
    .replace(/Codex App Server|codex-app-server|Codex runtime|Codex 会话|Codex turn|\bCodex\b/gi, '模型运行时');
}

const internalKeys = new Set(['engine', 'threadId', 'codexTurnId', 'historyManagedBy', 'retryManagedBy', 'stack', 'storageRoot', 'rolloutPath']);
const payloadKeys = new Set(['input', 'arguments', 'tools', 'messages', 'content', 'blocks', 'params', 'inputSchema']);
export function publicExecutionDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicExecutionDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !internalKeys.has(key)).map(([key, item]) => [key,
    payloadKeys.has(key) ? item : typeof item === 'string' && ['message', 'error', 'action', 'systemPrompt', 'baseInstructions'].includes(key)
      ? executionStatusText(item) : publicExecutionDetails(item)]));
}
