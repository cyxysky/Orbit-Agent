import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { windowsTerminalJobSetup } from './windows-job.ts';

export type TerminalShell = 'auto' | 'powershell' | 'pwsh' | 'bash';
export const quotePowerShell = (value: string) => "'" + value.replace(/'/g, "''") + "'";
export const quoteBash = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

export async function terminalShellInvocation(shell: Exclude<TerminalShell, 'auto'>, directory: string, nonce: string) {
  if (shell === 'powershell' || shell === 'pwsh') {
    const script = path.join(directory, 'shell.ps1');
    await writeFile(script, '\ufeff' + `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
try {
${process.platform === 'win32' ? windowsTerminalJobSetup : ''}
} catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }
$ErrorActionPreference = 'Continue'
function global:prompt {
  $orbitOk = $?
  $orbitCode = 0
  if ($null -ne $global:__orbitExitCode) { $orbitCode = $global:__orbitExitCode }
  elseif (-not $orbitOk) { if ($global:LASTEXITCODE) { $orbitCode = $global:LASTEXITCODE } else { $orbitCode = 1 } }
  $global:__orbitExitCode = $null
  $global:LASTEXITCODE = 0
  $orbitCwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))
  [Console]::Write([char]27 + ']777;orbit;${nonce};ready;' + $orbitCode + ';' + $orbitCwd + [char]7)
  'PS ' + (Get-Location).Path + '> '
}
`, 'utf8');
    return { executable: shell === 'powershell' ? 'powershell.exe' : 'pwsh', args: ['-NoLogo', '-NoProfile', '-NoExit', '-File', script] };
  }
  const script = path.join(directory, 'shell.bash');
  await writeFile(script, `
__orbit_prompt() {
  local orbit_code=$?
  printf '\\033]777;orbit;${nonce};ready;%s;%s\\007' "$orbit_code" "$(printf '%s' "$PWD" | base64 | tr -d '\\r\\n')"
}
PROMPT_COMMAND=__orbit_prompt
PS1='\\w $ '
`);
  return { executable: 'bash', args: ['--noprofile', '--rcfile', script, '-i'] };
}

export async function terminalCommandInvocation(shell: string, directory: string, nonce: string, id: string, command: string) {
  const powerShell = shell === 'powershell' || shell === 'pwsh';
  const source = path.join(directory, `${id}.${powerShell ? 'ps1' : 'bash'}`);
  const wrapper = path.join(directory, `${id}.run.${powerShell ? 'ps1' : 'bash'}`);
  await writeFile(source, (powerShell ? '\ufeff' : '') + command + '\n', 'utf8');
  if (powerShell) {
    await writeFile(wrapper, '\ufeff' + `
[Console]::Write([char]27 + ']777;orbit;${nonce};start' + [char]7)
$global:LASTEXITCODE = 0
try {
  . ${quotePowerShell(source)}
  if (-not $?) { if ($LASTEXITCODE) { $global:__orbitExitCode = $LASTEXITCODE } else { $global:__orbitExitCode = 1 } }
  elseif ($LASTEXITCODE) { $global:__orbitExitCode = $LASTEXITCODE }
  else { $global:__orbitExitCode = 0 }
} catch {
  $global:__orbitExitCode = 1
  [Console]::Error.WriteLine($_.ToString())
}
`, 'utf8');
    return { input: `. ${quotePowerShell(wrapper)}\r`, files: [source, wrapper] };
  }
  await writeFile(wrapper, `printf '\\033]777;orbit;${nonce};start\\007'\n. ${quoteBash(source)}\n`);
  return { input: `. ${quoteBash(wrapper)}\r`, files: [source, wrapper] };
}

