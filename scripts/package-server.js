/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { copyProductionRuntime, copyServerRuntime } = require('./server-package-layout');

const root = path.resolve(__dirname, '..');
const packageName = 'Orbit-Server';
const outputRoot = path.join(root, 'dist-server');
const distributionRoot = path.join(outputRoot, packageName);
const serverRoot = path.join(distributionRoot, 'server');

function copyDir(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`Required source directory is missing: ${source}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function copyInto(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function writeStartScript() {
  const lines = ['@echo off', 'setlocal', 'set "WEBPILOT_SERVER_ROOT=%~dp0"', 'if not defined APP_DATA_DIR set "APP_DATA_DIR=%WEBPILOT_SERVER_ROOT%runtime"', 'if not defined ARTIFACTS_DIR set "ARTIFACTS_DIR=%APP_DATA_DIR%\\artifacts"', 'if not defined CAPABILITY_TOOLS_HOME set "CAPABILITY_TOOLS_HOME=%APP_DATA_DIR%\\tool-components"', 'if not defined PORT set "PORT=3000"', 'if not defined HOSTNAME set "HOSTNAME=0.0.0.0"', 'set "NODE_ENV=production"', 'pushd "%WEBPILOT_SERVER_ROOT%server"', 'node webpilot-server.js', 'set "ORBIT_EXIT_CODE=%ERRORLEVEL%"', 'popd', 'exit /b %ORBIT_EXIT_CODE%'];
  fs.writeFileSync(path.join(distributionRoot, 'start.cmd'), lines.join('\r\n')+'\r\n');
}
function writeReadme() {
  const readme = `# Orbit HTTP Server\n\nRequirements: Node.js 22.16 or later. No npm install is required.\n\n1. Extract this directory.\n2. Run start.cmd.\n3. Open http://127.0.0.1:17890.\n\nLocal direct access uses ORBIT_DEFAULT_USER_ID (default: 1). For an online mounted deployment, set ORBIT_REQUIRE_MOUNT_USER_ID=true and pass userId to Orbit.mount().\n\nThe service listens on all network interfaces by default. To change the port, run \`set PORT=3000 && start.cmd\` from Command Prompt, or set \`$env:PORT = '3000'; .\\start.cmd\` in PowerShell. HTTP and WebSocket traffic share this one public port.\n\nRuntime data, artifacts, and browser profiles are written under the runtime directory unless APP_DATA_DIR or ARTIFACTS_DIR is set. Optional tools, libraries, Chromium, LibreOffice, FFmpeg and Python tool environments are downloaded individually in Settings > Environment > Tool components. Preserve APP_DATA_DIR/tool-components during upgrades.\n`;
  const packagedReadme = readme
    .replace('Patchright Chromium is included in this package.', 'Patchright Chromium and LibreOffice are included. Local redaction is optional: open Settings > Security and privacy > Local component download to install its Python dependencies and models into APP_DATA_DIR. Redaction is disabled by default. User knowledge packages and downloaded models are private runtime data and are not part of the distribution.')
    .replace('http://127.0.0.1:17890', 'http://127.0.0.1:3000')
    .replace('set PORT=3000 && start.cmd', 'set PORT=17890 && start.cmd')
    .replace("$env:PORT = '3000'", "$env:PORT = '17890'");
  const basePath = JSON.parse(fs.readFileSync(path.join(serverRoot, '.next', 'required-server-files.json'), 'utf8')).config.basePath || '';
  fs.writeFileSync(path.join(distributionRoot, 'README.md'), packagedReadme.replaceAll('http://127.0.0.1:3000', `http://127.0.0.1:3000${basePath}`), 'utf8');
}

function copyBrowserSessionExtension() {
  copyInto(
    path.join(root, 'packages', 'capability-sdk', 'runtime', 'browser'),
    path.join(serverRoot, 'capability-runtime', 'browser'),
  );
}

function copyComputerDriverRuntime() {
  copyInto(
    path.join(root, 'packages', 'capability-sdk', 'runtime', 'computer'),
    path.join(serverRoot, 'capability-runtime', 'computer'),
  );
}

function removePackageEntry(entryPath) {
  try {
    fs.rmSync(entryPath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200,
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'EBUSY' || code === 'EPERM') {
      throw new Error(`Unable to replace the existing server package because a file is in use: ${entryPath}. Stop the packaged server and try again.`, { cause: error });
    }
    throw error;
  }
}

function prepareOutputDirectory() {
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(distributionRoot, { recursive: true });
  for (const entry of fs.readdirSync(distributionRoot, { withFileTypes: true })) {
    removePackageEntry(path.join(distributionRoot, entry.name));
  }
}

async function main() {
prepareOutputDirectory();
const productionPackagePaths = await copyProductionRuntime(root, serverRoot);
copyInto(path.join(root, 'public'), path.join(serverRoot, 'public'));
const serverRuntimeFiles = copyServerRuntime(root, serverRoot);
copyInto(
  path.join(root, 'packages', 'capability-sdk', 'runtime', 'file'),
  path.join(serverRoot, 'capability-runtime', 'file'),
);
copyBrowserSessionExtension();
copyComputerDriverRuntime();

if (
  !fs.existsSync(path.join(serverRoot, '.next', 'BUILD_ID'))
  || !fs.existsSync(path.join(serverRoot, '.next', 'required-server-files.json'))
  || !fs.existsSync(path.join(serverRoot, 'webpilot-server.js'))
  || !fs.existsSync(path.join(serverRoot, 'start-backend.js'))
  || !fs.existsSync(path.join(serverRoot, 'dist-backend', 'src', 'backend', 'http-server.js'))
  || !fs.existsSync(path.join(serverRoot, 'webpilot-identity.js'))
  || !fs.existsSync(path.join(serverRoot, 'realtime-refresh-hub.js'))
  || !fs.existsSync(path.join(serverRoot, 'node_modules', 'next', 'package.json'))
) {
  throw new Error('The complete production runtime required by the Orbit custom server was not found. Run "npm run build" before packaging.');
}

writeStartScript();
writeReadme();

console.log(`Production server package created with ${productionPackagePaths.files} package directories and ${serverRuntimeFiles.length} custom server files:\n  ${distributionRoot}`);

}
main().catch(error => { console.error(error); process.exitCode=1; });
