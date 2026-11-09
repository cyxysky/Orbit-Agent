import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readManagedSensitiveDataRuntime, managedModelDirectory, runtimeDirectory } from '../runtime.ts';
import {
  defaultLiquidPiiModel,
  normalizedGlinerModelName,
} from './config.ts';
import { CodedError, ERROR_CODES } from '../errors.ts';


export type GlinerRuntimeMode = 'auto' | 'local' | 'external';

type LocalGlinerRuntimeState = {
  child?: ChildProcess;
  endpoint?: string;
  startPromise?: Promise<string>;
  revision?: string;
  shutdownRegistered?: boolean;
  configurationRevision?: string;
};

const globalRuntime = globalThis as typeof globalThis & {
  __sensitiveDataFilterLocalRuntime?: LocalGlinerRuntimeState;
};

const runtimeState = globalRuntime.__sensitiveDataFilterLocalRuntime ||= {};
const packageRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function normalizedGlinerRuntimeMode(value: unknown): GlinerRuntimeMode {
  const normalized = String(value || 'auto').trim().toLowerCase();
  if (normalized === 'local' || normalized === 'external') return normalized;
  return 'auto';
}

function isLoopbackHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function localGlinerServiceDirectories(projectRoot = process.cwd(), configuredDirectory = '') {
  return [...new Set([
    configuredDirectory ? path.resolve(configuredDirectory) : '',
    process.env.CAPABILITY_SDK_ROOT ? path.join(process.env.CAPABILITY_SDK_ROOT, 'runtime', 'sensitive-data', 'python') : '',
    ...bundledGlinerRuntimeDirectories(projectRoot).map((runtimeRoot) => path.join(runtimeRoot, 'service')),
    path.resolve(packageRoot, 'runtime', 'sensitive-data', 'python'),
    path.resolve(projectRoot, 'packages', 'capability-sdk', 'runtime', 'sensitive-data', 'python'),
    path.resolve(projectRoot, 'node_modules', '@cjfclonedeep', 'capability-sdk', 'runtime', 'sensitive-data', 'python'),
  ].filter(Boolean))];
}

export function bundledGlinerRuntimeDirectories(projectRoot = process.cwd()) {
  return [...new Set([
    path.resolve(projectRoot, 'sensitive-data-runtime'),
    path.resolve(projectRoot, '..', 'sensitive-data-runtime'),
  ])];
}

function resolveServiceDirectory(projectRoot: string, configuredDirectory: string) {
  return localGlinerServiceDirectories(projectRoot, configuredDirectory)
    .find((directory) => existsSync(path.join(directory, 'app.py')));
}

export function localGlinerServiceRevision(serviceDirectory: string) {
  const digest = createHash('sha256');
  for (const filename of ['app.py', 'candidate_resolution.py', 'entity_boundaries.py', 'deterministic_spans.py']) {
    digest.update(readFileSync(path.join(serviceDirectory, filename)));
  }
  return digest.digest('hex');
}

export function localGlinerPythonCandidates(projectRoot = process.cwd(), configuredPath = '') {
  const executable = process.platform === 'win32' ? 'python.exe' : 'python';
  return [...new Set([
    configuredPath ? path.resolve(configuredPath) : '',
    readManagedSensitiveDataRuntime()?.python || '',
    ...bundledGlinerRuntimeDirectories(projectRoot).map((runtimeRoot) => path.join(runtimeRoot, 'python', executable)),
  ].filter(Boolean))];
}

function bundledModelDirectory(
  projectRoot: string,
  options: {
    bundleEnvironmentKey: 'GLINER_MODEL_BUNDLE_DIR' | 'GLINER_CHINESE_NER_MODEL_BUNDLE_DIR' | 'GLINER_PII_MODEL_BUNDLE_DIR';
    configuredEnvironmentKey: 'GLINER_MODEL' | 'GLINER_CHINESE_NER_MODEL' | 'GLINER_PII_MODEL';
    manifestKey: 'modelName' | 'chineseNerModelName' | 'piiModelName';
    relativePath: string[];
  },
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const configured = String(environment[options.bundleEnvironmentKey] || '').trim();
  const modelKey = options.manifestKey === 'modelName' ? 'gliner' : options.manifestKey === 'piiModelName' ? 'pii' : 'chinese';
  const requestedModel = String(environment[options.configuredEnvironmentKey] || '').trim();
  const managed = managedModelDirectory(modelKey, requestedModel);
  const candidates = [
    ...(configured ? [path.resolve(configured)] : []),
    ...(managed ? [managed] : []),
    ...bundledGlinerRuntimeDirectories(projectRoot).map((runtimeRoot) => path.join(runtimeRoot, ...options.relativePath)),
  ];
  for (const modelDirectory of candidates) {
    if (!existsSync(path.join(modelDirectory, 'config.json'))) continue;
    const manifestPath = path.join(modelDirectory, '..', '..', 'runtime-manifest.json');
    let bundledModelName = '';
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      bundledModelName = String(manifest[options.manifestKey] || '').trim();
    } catch {
      // An explicitly supplied bundle directory can omit the build manifest.
    }
    const configuredModel = options.configuredEnvironmentKey === 'GLINER_MODEL'
      ? normalizedGlinerModelName(environment.GLINER_MODEL)
      : String(environment[options.configuredEnvironmentKey] || '').trim();
    if (!configuredModel || !bundledModelName || configuredModel === bundledModelName) return modelDirectory;
  }
  return '';
}

function resolvePythonCommand(projectRoot: string, configuredPath: string) {
  const local = localGlinerPythonCandidates(projectRoot, configuredPath).find(existsSync);
  if (local) return local;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function healthEndpoint(endpoint: string) {
  return new URL('health', endpoint.endsWith('/') ? endpoint : `${endpoint}/`).toString();
}

async function serviceHealthy(endpoint: string, timeoutMs = 800, expectedRevision = '') {
  try {
    const response = await fetch(healthEndpoint(endpoint), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const health = await response.json() as { pipeline?: unknown; serviceRevision?: unknown; status?: unknown };
    return health.status === 'ok'
      && health.pipeline === 'deterministic -> liquid-pii + gliner2.5-open-label -> chinese-roberta-boundary -> redact'
      && (!expectedRevision || health.serviceRevision === expectedRevision);
  } catch {
    return false;
  }
}

function startupTimeoutMs(environment: Readonly<Record<string, string | undefined>>) {
  const configured = Number(environment.GLINER_LOCAL_STARTUP_TIMEOUT_MS || 600_000);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.floor(configured), 900_000)
    : 600_000;
}

function stopManagedSidecar() {
  const child = runtimeState.child;
  runtimeState.child = undefined;
  runtimeState.endpoint = undefined;
  runtimeState.revision = undefined;
  runtimeState.startPromise = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 3000);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

function registerShutdown() {
  if (runtimeState.shutdownRegistered) return;
  runtimeState.shutdownRegistered = true;
  process.once('SIGINT', stopManagedSidecar);
  process.once('SIGTERM', stopManagedSidecar);
  process.once('exit', stopManagedSidecar);
}

async function waitForService(endpoint: string, child: ChildProcess, expectedRevision: string, environment: Readonly<Record<string, string | undefined>>) {
  const deadline = Date.now() + startupTimeoutMs(environment);
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.killed) {
      throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, 'Local GLiNER process exited before becoming ready. Download the local components from Settings and check the startup output.');
    }
    if (await serviceHealthy(endpoint, 1_000, expectedRevision)) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, 'Local GLiNER startup timed out. Loading local models can take several minutes; check the GLiNER startup output.');
}

async function startManagedSidecar(
  endpoint: string,
  projectRoot: string,
  serviceDirectory: string,
  serviceRevision: string,
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (await serviceHealthy(endpoint, 800, serviceRevision)) return endpoint;
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
    throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, 'Managed local GLiNER requires a loopback HTTP GLINER_SERVICE_URL.');
  }
  const port = Number(url.port || 80);
  const pythonCommand = resolvePythonCommand(projectRoot, String(environment.GLINER_PYTHON_PATH || '').trim());
  const modelBundleDirectory = bundledModelDirectory(projectRoot, {
    bundleEnvironmentKey: 'GLINER_MODEL_BUNDLE_DIR',
    configuredEnvironmentKey: 'GLINER_MODEL',
    manifestKey: 'modelName',
    relativePath: ['models', 'gliner2'],
  }, environment);
  const chineseNerModelBundleDirectory = bundledModelDirectory(projectRoot, {
    bundleEnvironmentKey: 'GLINER_CHINESE_NER_MODEL_BUNDLE_DIR',
    configuredEnvironmentKey: 'GLINER_CHINESE_NER_MODEL',
    manifestKey: 'chineseNerModelName',
    relativePath: ['models', 'chinese-roberta'],
  }, environment);
  const piiModelBundleDirectory = bundledModelDirectory(projectRoot, {
    bundleEnvironmentKey: 'GLINER_PII_MODEL_BUNDLE_DIR',
    configuredEnvironmentKey: 'GLINER_PII_MODEL',
    manifestKey: 'piiModelName',
    relativePath: ['models', 'liquid-pii'],
  }, environment);
  if (!modelBundleDirectory || !chineseNerModelBundleDirectory || !piiModelBundleDirectory) {
    throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, 'Local sensitive-data models are not installed. Open Settings → Security & privacy → Local sensitive-data runtime and click Download.');
  }
  const modelCacheDirectory = String(environment.GLINER_MODEL_CACHE_DIR || '').trim()
    || path.join(runtimeDirectory(), 'sensitive-data', 'huggingface');
  console.log(`[gliner-local] Starting ${pythonCommand} on ${url.hostname}:${port}.`);
  const child = spawn(pythonCommand, [
    '-m',
    'uvicorn',
    'app:app',
    '--host',
    url.hostname,
    '--port',
    String(port),
    '--no-access-log',
  ], {
    cwd: serviceDirectory,
    env: {
      ...process.env,
      ...environment,
      GLINER_MODEL: modelBundleDirectory || normalizedGlinerModelName(environment.GLINER_MODEL),
      ...(chineseNerModelBundleDirectory ? {
        GLINER_CHINESE_NER_MODEL: chineseNerModelBundleDirectory,
      } : {}),
      GLINER_PII_MODEL: piiModelBundleDirectory
        || String(environment.GLINER_PII_MODEL || '').trim()
        || defaultLiquidPiiModel,
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      HF_HOME: environment.HF_HOME || modelCacheDirectory,
      HF_HUB_CACHE: environment.HF_HUB_CACHE || path.join(modelCacheDirectory, 'hub'),
      HF_MODULES_CACHE: environment.HF_MODULES_CACHE || path.join(modelCacheDirectory, 'modules'),
      HF_XET_CACHE: environment.HF_XET_CACHE || path.join(modelCacheDirectory, 'xet'),
      TRANSFORMERS_CACHE: environment.TRANSFORMERS_CACHE || path.join(modelCacheDirectory, 'hub'),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  runtimeState.child = child;
  runtimeState.endpoint = endpoint;
  runtimeState.revision = serviceRevision;
  registerShutdown();
  child.once('error', () => {
    if (runtimeState.child === child) runtimeState.child = undefined;
  });
  child.once('exit', () => {
    if (runtimeState.child === child) {
      runtimeState.child = undefined;
      runtimeState.endpoint = undefined;
      runtimeState.revision = undefined;
      runtimeState.startPromise = undefined;
    }
  });
  return waitForService(endpoint, child, serviceRevision, environment);
}

export async function prepareGlinerService(endpoint: string, environment: Readonly<Record<string, string | undefined>> = process.env) {
  const mode = normalizedGlinerRuntimeMode(environment.GLINER_RUNTIME_MODE);
  if (mode === 'external') {
    if (runtimeState.child) await stopManagedSidecar();
    return endpoint;
  }

  const projectRoot = process.cwd();
  const url = new URL(endpoint);
  const serviceDirectory = resolveServiceDirectory(
    projectRoot,
    String(environment.GLINER_SERVICE_DIR || '').trim(),
  );
  if (mode === 'auto' && (!isLoopbackHost(url.hostname) || !serviceDirectory)) {
    if (runtimeState.child) await stopManagedSidecar();
    return endpoint;
  }
  if (!serviceDirectory) {
    throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, 'Local GLiNER service files were not found. Set GLINER_SERVICE_DIR or use GLINER_RUNTIME_MODE=external.');
  }
  const serviceRevision = localGlinerServiceRevision(serviceDirectory);
  const configurationRevision = createHash('sha256').update(JSON.stringify(Object.entries(environment).filter(([key]) => key.startsWith('GLINER_')).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  if (runtimeState.child && (runtimeState.endpoint !== endpoint || runtimeState.revision !== serviceRevision || runtimeState.configurationRevision !== configurationRevision)) {
    await stopManagedSidecar();
  }
  if (runtimeState.startPromise && runtimeState.endpoint === endpoint) return runtimeState.startPromise;
  if (runtimeState.endpoint === endpoint && runtimeState.child && runtimeState.child.exitCode === null) {
    if (await serviceHealthy(endpoint, 800, serviceRevision)) return endpoint;
    await stopManagedSidecar();
  }
  if (!runtimeState.startPromise || runtimeState.endpoint !== endpoint) {
    runtimeState.endpoint = endpoint;
    runtimeState.revision = serviceRevision;
    runtimeState.configurationRevision = configurationRevision;
    const starting = startManagedSidecar(endpoint, projectRoot, serviceDirectory, serviceRevision, environment).then(result => {
      if (runtimeState.startPromise === starting) runtimeState.startPromise = undefined;
      return result;
    }).catch((error) => {
      if (runtimeState.endpoint === endpoint) {
        runtimeState.startPromise = undefined;
        runtimeState.endpoint = undefined;
      }
      throw error;
    });
    runtimeState.startPromise = starting;
  }
  return runtimeState.startPromise;
}
