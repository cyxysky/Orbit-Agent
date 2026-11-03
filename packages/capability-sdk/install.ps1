param(
  [string]$ProjectDirectory,
  [string]$Clients = 'all',
  [string]$Version = '0.3.10',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js >=22.16 with npm is required. Install Node.js, then run this script again.'
}
$localInstaller = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'install.mjs' } else { $null }
$temporaryInstaller = $null
try {
  if (-not $localInstaller -or -not (Test-Path -LiteralPath $localInstaller -PathType Leaf)) {
    if ($DryRun) {
      Write-Output "Would download install.mjs from https://raw.githubusercontent.com/cyxysky/capability-sdk/main/ and install release $Version for $Clients. No files changed."
      return
    }
    $temporaryInstaller = Join-Path ([System.IO.Path]::GetTempPath()) ('capability-install-' + [guid]::NewGuid().ToString('N') + '.mjs')
    Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/cyxysky/capability-sdk/main/install.mjs' -OutFile $temporaryInstaller -UseBasicParsing
    $localInstaller = $temporaryInstaller
  }
  $installerArguments = @('--version', $Version, '--clients', $Clients)
  if ($ProjectDirectory) { $installerArguments += @('--project', $ProjectDirectory) }
  if ($DryRun) { $installerArguments += '--dry-run' }
  & node $localInstaller @installerArguments
  if ($LASTEXITCODE -ne 0) { throw "Capability SDK installer failed ($LASTEXITCODE)." }
} finally {
  if ($temporaryInstaller -and (Test-Path -LiteralPath $temporaryInstaller)) {
    Remove-Item -LiteralPath $temporaryInstaller -Force
  }
}
