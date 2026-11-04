import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import type { RuntimeConfiguration } from '@/server/settings/runtime-configuration';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:net';
import { capabilityConfigurationFromEnvironment } from '@cjfclonedeep/capability-sdk/host';
import { sensitiveDataCapabilityManifest } from '@cjfclonedeep/capability-sdk/sensitive-data';
import {
  createNodeSensitiveDataFilter,
  sensitiveDataFilterConfigFromEnvironment,
  prepareGlinerService,
} from '@cjfclonedeep/capability-sdk/sensitive-data/node';
import { sensitiveDataRuntimeDirectory } from './sensitive-data-runtime';

const configurationScope = new AsyncLocalStorage<RuntimeConfiguration>();
let activeRevision = '';
let activeRequests = 0;
const drained = new Set<() => void>();
let localEndpoint: Promise<string> | undefined;

async function managedEndpoint(endpoint: string, configuration: RuntimeConfiguration) {
  const url = new URL(endpoint);
  if (configuration.GLINER_RUNTIME_MODE === 'external' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return endpoint;
  // Each host process owns its worker. An API test cannot leave the execution
  // process attached to another process's worker with an outdated model.
  localEndpoint ??= (async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (!address || typeof address === 'string') throw new Error('Cannot allocate sensitive-data worker port.');
    return `http://127.0.0.1:${address.port}`;
  })().catch(error => {
    localEndpoint = undefined;
    throw error;
  });
  return localEndpoint;
}

const sensitiveDataRuntime = createNodeSensitiveDataFilter({
  getConfig: () => {
    sensitiveDataRuntimeDirectory();
    return sensitiveDataFilterConfigFromEnvironment(
      capabilityConfigurationFromEnvironment(sensitiveDataCapabilityManifest, configurationScope.getStore() || runtimeConfiguration()),
    );
  },
  prepareEndpoint: async endpoint => {
    const configuration = configurationScope.getStore() || runtimeConfiguration();
    return prepareGlinerService(await managedEndpoint(endpoint, configuration), {
      // Runtime installation paths are service deployment settings, not model
      // choices or filtering policy. Preserve packaged/custom service layouts.
      ...Object.fromEntries(['GLINER_PYTHON_PATH', 'GLINER_SERVICE_DIR', 'GLINER_MODEL_BUNDLE_DIR',
        'GLINER_CHINESE_NER_MODEL_BUNDLE_DIR', 'GLINER_PII_MODEL_BUNDLE_DIR', 'GLINER_MODEL_CACHE_DIR',
        'GLINER_LOCAL_STARTUP_TIMEOUT_MS'].map(key => [key, process.env[key]])),
      ...Object.fromEntries(Object.entries(configuration).filter(([key]) => key.startsWith('GLINER_'))),
      CAPABILITY_SENSITIVE_DATA_RUNTIME_HOME: sensitiveDataRuntimeDirectory(),
    });
  },
});

async function withConfiguration<T>(action: () => Promise<T>) {
  const configuration = runtimeConfiguration();
  const revision = JSON.stringify(Object.entries(configuration).filter(([key]) => key.startsWith('GLINER_')).sort(([a], [b]) => a.localeCompare(b)));
  while (activeRequests && activeRevision !== revision) {
    await new Promise<void>(resolve => { drained.add(resolve); });
  }
  activeRevision = revision;
  activeRequests++;
  try {
    return await configurationScope.run(configuration, action);
  } finally {
    if (--activeRequests === 0) {
      for (const resolve of drained) resolve();
      drained.clear();
    }
  }
}

export const filterSensitiveData: typeof sensitiveDataRuntime.filterSensitiveData = (...args) => withConfiguration(() => sensitiveDataRuntime.filterSensitiveData(...args));
export const redactSensitiveTexts: typeof sensitiveDataRuntime.redactSensitiveTexts = (...args) => withConfiguration(() => sensitiveDataRuntime.redactSensitiveTexts(...args));
