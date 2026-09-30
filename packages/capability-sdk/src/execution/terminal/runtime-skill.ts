import type { CapabilitySkill } from '../../index.ts';

export const terminalRuntimeSkillId = 'system-terminal-runtime';
export const terminalRuntimeSkill = Object.freeze({
  id: terminalRuntimeSkillId,
  title: 'Local Terminal',
  summary: `<system_skill id="${terminalRuntimeSkillId}"><title>本地终端</title><description>管理持久终端，实时读取输出，在同一 Shell 执行命令和交互输入。</description></system_skill>`,
  content: String.raw`# Local Terminal

- These are real PTY terminals on the host machine, using the host account's permissions. A configured cwd is a starting directory, not a sandbox.
- Begin with list. Reuse a ready terminal by terminalId; create a named terminal when none is suitable. create accepts cwd and optional dimensions. run requires terminalId and command. Multiple runs in the SAME terminal retain cd, environment variables and shell variables. Use a separate terminal for an independent task or server while another terminal is busy.
- Inspect terminal.shell before writing commands: Windows PowerShell does not support Bash syntax or PowerShell 7's &&/|| operators. Invoke package-manager commands directly; .ps1/.cmd wrappers are normal shell commands, not exe files for Start-Process.
- run streams output to the terminal UI and returns the command's status when finished, or running when yieldMs expires (maximum 30000ms per call). Use timeoutMs=0 for installs and servers. Do not detach commands through Start-Process, WMI, or log-file polling to keep them alive. The host's conversation manager keeps these terminals across model requests, context compression and completed turns. Closing the conversation or shutting down/restarting the backend closes them.
- Every response identifies terminalId, shell, current cwd, status, last command and output cursor. A successful run call with command.status=running is NOT command success. Only command.status=succeeded and exitCode=0 establish command success. A server may remain running; verify its readiness from actual output and the requested service behavior.
- Output is pushed live, including while the Agent is between calls. read fetches retained output immediately without consuming another reader's buffer. Pass the last cursor to avoid duplicates. wait waits for command completion (up to yieldMs) and returns new output after cursor; if still running, keep the same terminalId. If truncated=true, older output was evicted; do not assume a complete transcript.
- write sends raw input to a running interactive program or the shell. Use \r to press Enter, \u0003 for Ctrl+C, \u0004 for EOF where supported. Prefer run for complete commands so exit status is tracked. Do not send a new run while a command is busy: wait, answer its prompt with write, interrupt it, or create a second terminal.
- interrupt sends Ctrl+C and normally keeps the shell reusable; a stuck command is terminated with its terminal after a grace period. resize changes cols/rows; rename changes the display name. close terminates the terminal and descendants but retains its final output; delete also removes the terminal from the manager. list is authoritative: a missing ID after backend restart cannot be resumed or silently replayed.
- A nonzero exit code, timeout, or interruption is not success. PTY output merges stdout and stderr; progress messages on stderr alone are not command failure. Inspect the actual exit code.
- Preserve user work. Inspect repository status before mutations and absolute targets before destructive filesystem operations. Do not rewrite history, discard changes, print credentials or bypass disabled tools. Commands and write input are executable input.`,
  required: true,
  activation: [{ toolName: 'terminal', actions: ['create', 'list', 'run', 'read', 'wait', 'write', 'interrupt', 'resize', 'rename', 'close', 'delete'] }],
} satisfies CapabilitySkill);
