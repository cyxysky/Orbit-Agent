/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { register } = require('node:module');
const { applyOrbitEnvironment } = require('./orbit-environment');

async function main() {
  const root = path.resolve(process.env.WEBPILOT_APP_DIR || process.cwd());
  process.env.WEBPILOT_APP_DIR = root;
  process.env.WEBPILOT_BACKEND_LAUNCHER = __filename;
  process.env.WEBPILOT_SERVER_ROLE = process.argv.includes('--execution-worker') ? 'execution' : 'api';
  // Environment is inherited from the public launcher. Standalone diagnostics
  // may also use a local .env without loading any Next module.
  if (!process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN && fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
  applyOrbitEnvironment();
  process.env.NEXT_PUBLIC_ORBIT_BASE_PATH = process.env.ORBIT_BASE_PATH || process.env.WEBPILOT_BASE_PATH || '';
  process.env.NEXT_PUBLIC_WEBPILOT_BASE_PATH = process.env.NEXT_PUBLIC_ORBIT_BASE_PATH;
  const dev = process.argv.includes('--dev');
  process.env.NODE_ENV ||= dev ? 'development' : 'production';
  process.env.WEBPILOT_BACKEND_DEV = dev ? 'true' : 'false';
  if (dev) register(pathToFileURL(path.join(__dirname, 'backend-loader.mjs')));
  const entry = path.join(root, dev ? 'src/backend/http-server.ts' : 'dist-backend/src/backend/http-server.js');
  if (!fs.existsSync(entry)) throw new Error(`Node backend entry is missing: ${entry}. Run the backend build before packaging.`);
  const { startBackend } = await import(pathToFileURL(entry).href);
  const backend = await startBackend();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    await backend.close();
    clearTimeout(deadline);
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.once('disconnect', stop);
  process.on('message', message => { if (message?.type === 'shutdown') void stop(); });
  process.send?.({ type: 'ready', port: backend.port });
}

if (require.main === module) main().catch(error => { console.error('[backend] Startup failed', error); process.exit(1); });
