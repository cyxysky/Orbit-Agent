/* eslint-disable @typescript-eslint/no-require-imports */
const { hostname, networkInterfaces } = require('node:os');

// Capture the deployment grant once. Runtime settings and model-authored rules
// cannot turn a service process into a self-modifying development process.
let enabled;
let hostEnabled;
const localHosts = new Set([hostname().toLowerCase(), ...Object.values(networkInterfaces())
  .flatMap(addresses => (addresses || []).map(address => address.address.toLowerCase()))]);

function selfBootstrapEnabled() {
  // The launcher loads .env before the first permission check.
  return enabled ??= String(process.env.ORBIT_SELF_BOOTSTRAP_ENABLED || '').trim().toLowerCase() === 'true';
}

function hostExecutionEnabled() {
  return hostEnabled ??= String(process.env.ORBIT_HOST_EXECUTION_ENABLED || '').trim().toLowerCase() === 'true';
}

function remoteSandboxAllowed(configuration) {
  if (hostExecutionEnabled()) return true;
  if (configuration.AGENT_CODE_SANDBOX_BACKEND === 'local') return false;
  try {
    const url = new URL(configuration.AGENT_CODE_SANDBOX_RUNNER_URL || 'http://127.0.0.1:18100');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    const local = localHosts.has(host) || host === 'localhost' || host.endsWith('.localhost')
      || host === 'localhost.localdomain' || host === '0.0.0.0' || host.startsWith('127.')
      || host === '::' || host === '::1' || /^::ffff:(?:127\.|7f[0-9a-f]{2}:)/i.test(host);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !local;
  } catch {
    return false;
  }
}

module.exports = { selfBootstrapEnabled, hostExecutionEnabled, remoteSandboxAllowed };
