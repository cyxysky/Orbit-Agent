import type { CapabilitySkill } from '../../index.ts';

export const terminalRuntimeSkillId = 'system-terminal-runtime';
export const terminalRuntimeSkill = Object.freeze({
  id: terminalRuntimeSkillId,
  title: 'Local Terminal',
  summary: `<system_skill id="${terminalRuntimeSkillId}"><title>本地终端</title><description>在宿主机器执行 Shell 命令，读取输出、写入标准输入并管理进程。</description></system_skill>`,
  content: `# Local Terminal

- This tool runs on the Agent runtime server's machine with its OS account permissions. It is not an isolated sandbox. A configured cwd is a starting directory, not a filesystem boundary.
- Use action=run with command and a clear reason. cwd is optional and resolves relative to the configured default. Shell selection belongs to the host: auto means Windows PowerShell on Windows, Bash elsewhere. Windows supports powershell/pwsh. Do not assume Bash syntax on Windows. For complex native CLI arguments, prefer a script file over nested quoting; Windows PowerShell has legacy native argument quoting rules.
- Each run starts a new shell process. cd, variables and environment changes do not persist across separate runs. Set cwd explicitly. This is a pipe-based command runner, not a PTY or an interactive terminal UI.
- run returns stdout, stderr, status, exitCode, shell, cwd and a sessionId. If status=running, use action=read with that exact sessionId to collect incremental output. Do not rerun a command just because the first call yielded.
- For a program needing stdin, start with keepStdinOpen=true. Use action=write with stdin; closeStdin=true sends EOF. Otherwise run sends optional stdin and immediately closes it. TTY-only programs are unsupported.
- action=stop terminates the process tree. The host timeout, cancellation and runtime disposal also terminate it. Process sessions last only for this mounted runtime; do not promise background services survive a completed Agent turn.
- status=exited and exitCode=0 mean success. failed, timed_out, cancelled, a nonzero exit code, or an unknown outcome never mean success. Output can be truncated: narrow the command or write large results to a host-managed file.
- Preserve the user's existing work. Inspect repository status and diff before Git mutations; use explicit paths for commits. Inspect absolute targets before destructive filesystem operations. Do not rewrite history or discard changes without user authorization.
- Commands and stdin are executable input. Follow host authorization and the user's scope; do not bypass disabled tools through the terminal. Do not print credentials or put secrets into logged commands.`,
  required: true,
  activation: [{ toolName: 'terminal', actions: ['run', 'read', 'write', 'stop'] }],
} satisfies CapabilitySkill);
