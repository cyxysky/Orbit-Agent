import { setTimeout as delay } from 'node:timers/promises';
import { managedToolManagementSchema } from '@/config/managed-tool-management';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { selfBootstrapEnabled } from '@/server/runtime/self-bootstrap-policy';
import { CodedError, ERROR_CODES, type CapabilityProgressEvent } from '@cjfclonedeep/capability-sdk';
import { listManagedTools, managedToolConfigurations, saveManagedToolConfiguration, stopManagedTool, toolInstaller } from './managed-tools';

/** Settings and AI share the same installer and configuration rules. */
export async function manageTools(raw: unknown, caller: { userId: string; model: boolean; signal?: AbortSignal; reportProgress?: (event: CapabilityProgressEvent) => void | Promise<void> }) {
  if (!isAiOperationsAdmin(caller.userId) || (caller.model && !selfBootstrapEnabled())) {
    throw new CodedError(ERROR_CODES.FORBIDDEN, '工具管理需要管理员身份；AI 调用还需要部署开启 ORBIT_SELF_BOOTSTRAP_ENABLED。');
  }
  const request = managedToolManagementSchema.parse(raw);
  caller.signal?.throwIfAborted();
  if (request.action === 'list') return { tools: await listManagedTools() };
  const installer = toolInstaller();
  const current = installer.status(request.id);
  if (request.action === 'status') return { tool: current };
  if (request.action === 'check') return installer.check(request.id);
  if (request.action === 'install' || request.action === 'retry') {
    const configured = (await managedToolConfigurations())[request.id];
    return { tool: installer.start(request.id, configured) };
  }
  if (request.action === 'cancel') return { tool: installer.cancel(request.id, request.jobId) };
  if (request.action === 'wait') {
    const deadline = Date.now() + request.timeoutMs;
    let tool = current;
    let reported = '';
    const report = async () => {
      if (reported === tool.updatedAt) return;
      reported = tool.updatedAt || '';
      await caller.reportProgress?.({ phase: 'tool-install:' + tool.phase, message: tool.message,
        current: tool.progress?.steps.filter(step => step.status === 'completed').length, total: tool.progress?.steps.length,
        data: { id: tool.id, jobId: tool.jobId, state: tool.state, download: tool.download } });
    };
    if (tool.jobId !== request.jobId) throw new Error('安装任务已更新，请重新查询状态。');
    await report();
    while (tool.state === 'installing' && Date.now() < deadline) {
      await delay(Math.min(500, deadline - Date.now()), undefined, { signal: caller.signal });
      tool = installer.status(request.id);
      if (tool.jobId !== request.jobId) throw new Error('安装任务已更新，请重新查询状态。');
      await report();
    }
    return { tool };
  }
  if (request.action === 'stop') { await stopManagedTool(request.id, { force: true }); return { ok: true }; }
  if (request.action === 'uninstall') {
    if (current.state === 'installing') throw new Error('请先取消安装，再卸载工具。');
    await stopManagedTool(request.id);
    await saveManagedToolConfiguration(request.id, { enabled: false, env: {}, config: {} });
    return { tool: await installer.uninstall(request.id) };
  }
  const previous = (await managedToolConfigurations())[request.id];
  if (caller.model && Object.keys(request.configuration.env).some(key => /^(?:NODE_|PYTHON|LD_|DYLD_|CAPABILITY_|ELECTRON_|npm_|BASH_ENV$|ENV$|PATH$|PATHEXT$|COMSPEC$)/i.test(key))) {
    throw new CodedError(ERROR_CODES.FORBIDDEN, 'AI 工具配置不能修改进程加载器、可执行文件搜索路径或部署目录。');
  }
  const env = { ...previous?.env, ...request.configuration.env };
  for (const key of request.clearEnv || []) delete env[key];
  if (request.configuration.enabled && !installer.installed(request.id)) throw new Error('请先安装此工具，再启用。');
  await saveManagedToolConfiguration(request.id, { ...request.configuration, env });
  return { ok: true };
}
