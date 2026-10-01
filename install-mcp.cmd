@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.16 or later is required. Install Node.js with npm, then run this file again.
  exit /b 1
)
node "%~dp0packages\capability-sdk\scripts\setup.mjs" --project "%~dp0." %*
exit /b %errorlevel%
