import { analyzeBrowserCodeRisk } from '@cjfclonedeep/capability-sdk/browser/node';
import { isReadOnlyStatement } from '@cjfclonedeep/capability-sdk/data';
import { mediaGenerationActions } from '@cjfclonedeep/capability-sdk/media';

export type BrowserToolApprovalRequest = {
  prompt: string;
  reason?: string;
};

function compact(value: unknown, max = 240) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function browserToolApprovalRequest(input: {
  toolName: string;
  toolInput: unknown;
}): BrowserToolApprovalRequest | undefined {
  const record = input.toolInput && typeof input.toolInput === 'object' && !Array.isArray(input.toolInput)
    ? input.toolInput as Record<string, unknown>
    : {};
  const reason = compact(record.reason, 300) || undefined;

  if (input.toolName === 'browser' && record.action === 'act') return { reason, prompt: reason || 'Confirm this visual browser action.' };

  if (input.toolName === 'browser' && record.action === 'code') {
    const code = typeof record.code === 'string' ? record.code : '';
    const risk = analyzeBrowserCodeRisk(code);
    if (!risk.requiresConfirmation) return undefined;
    return {
      reason,
      prompt: reason || `请确认是否执行浏览器代码：${compact(code, 180)}`,
    };
  }

  if (input.toolName === 'file' && record.action === 'download') {
    return { reason, prompt: `请确认是否下载文件${reason ? `：${reason}` : ''}` };
  }

  if (input.toolName === 'terminal' && (record.action === 'run' || record.action === 'write')) {
    return {
      reason,
      prompt: record.action === 'run'
        ? `请确认是否在本地终端执行命令：${compact(record.command, 300)}${record.cwd ? `（目录：${compact(record.cwd, 160)}）` : ''}`
        : `请确认是否向终端进程 ${compact(record.sessionId, 100)} 写入：${compact(record.stdin, 300)}`,
    };
  }

  const action = typeof record.action === 'string' ? record.action : '';
  const approvalRequired = (
    (input.toolName === 'codeSandbox' && action === 'run')
    || (input.toolName === 'connectors' && action === 'call')
    || (input.toolName === 'knowledge' && action === 'delete')
    || (input.toolName === 'data' && action === 'query' && !isReadOnlyStatement(typeof record.statement === 'string' ? record.statement : ''))
    || (input.toolName === 'media' && mediaGenerationActions.some((candidate) => candidate === action))
    || (input.toolName === 'communication' && action === 'send')
    || (input.toolName === 'computer' && ['click', 'type', 'key', 'scroll'].includes(action))
  );
  if (approvalRequired) {
    return {
      reason,
      prompt: reason || `请确认是否执行 ${input.toolName} ${action} 操作。`,
    };
  }

  return undefined;
}
