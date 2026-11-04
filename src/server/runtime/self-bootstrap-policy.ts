import { selfBootstrapEnabled, remoteSandboxAllowed } from '../../../server/self-bootstrap-policy.cjs';
import { isToolCapabilityEnabled, type ToolCapabilityEnvironment } from '@/lib/tool-capability-settings';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';

export { selfBootstrapEnabled, remoteSandboxAllowed };

export function isRuntimeToolEnabled(name: string, configuration: ToolCapabilityEnvironment) {
  if (!isToolCapabilityEnabled(name, configuration)) return false;
  if (selfBootstrapEnabled()) return true;
  if (name === 'terminal' || name === 'computer') return false;
  return name !== 'codeSandbox' || remoteSandboxAllowed(configuration);
}

export function requireSelfBootstrap(operation: string) {
  if (!selfBootstrapEnabled()) {
    throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED,
      `${operation} is unavailable in service mode. The deployment owner must enable ORBIT_SELF_BOOTSTRAP_ENABLED to allow host execution.`);
  }
}

export function selfBootstrapInstructions() {
  return selfBootstrapEnabled()
    ? `Self-bootstrap is enabled by the deployment owner. Orbit project directory is ${process.env.WEBPILOT_APP_DIR || process.cwd()}. When the user requests changes to Orbit, you may inspect and modify this project using enabled host tools. Keep changes within the requested scope and verify them. Start self-modification only for a user request. Keep service lifecycle changes within explicit user instructions.`
    : 'Orbit runs in service mode. Project self-modification and local host execution are disabled. Use managed documents, the browser sandbox and a configured independent remote code runner. Do not use another tool, a connector, generated document code or a web page to bypass the host execution policy.';
}
