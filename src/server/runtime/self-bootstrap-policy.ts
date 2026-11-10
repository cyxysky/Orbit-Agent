import { selfBootstrapEnabled, hostExecutionEnabled, remoteSandboxAllowed } from '../../../server/self-bootstrap-policy.cjs';
import { isExtensionToolName } from '@cjfclonedeep/capability-sdk/extensions';
import { isToolCapabilityEnabled, type ToolCapabilityEnvironment } from '@/lib/tool-capability-settings';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';

export { selfBootstrapEnabled, hostExecutionEnabled, remoteSandboxAllowed };

export function isRuntimeToolEnabled(name: string, configuration: ToolCapabilityEnvironment) {
  if (name === 'memory' && configuration.AI_PERSONAL_MEMORY_ENABLED === 'false') return false;
  if (!isToolCapabilityEnabled(name, configuration)) return false;
  if (name === 'selfBootstrap' || isExtensionToolName(name)) {
    return selfBootstrapEnabled() && isToolCapabilityEnabled('selfBootstrap', configuration);
  }
  if (name === 'terminal' || name === 'computer') return hostExecutionEnabled();
  return name !== 'codeSandbox' || remoteSandboxAllowed(configuration);
}

export function requireHostExecution(operation: string) {
  if (!hostExecutionEnabled()) {
    throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED,
      `${operation} requires ORBIT_HOST_EXECUTION_ENABLED in the deployment environment. Extension self-bootstrap does not grant host execution.`);
  }
}

export function selfBootstrapInstructions() {
  return [
    selfBootstrapEnabled()
      ? 'Executable extension self-bootstrap is enabled. Use selfBootstrap to write, validate, probe, activate, disable and roll back isolated extensions. It is independent of terminal/browser/knowledge switches. New activations appear in the next mounted Agent execution; running executions retain their immutable version. Configuration registration only creates data fields and is not a substitute for executable behavior. Do not claim functional acceptance from syntax validation alone.'
      : 'Executable extension self-bootstrap is disabled by the deployment owner.',
    hostExecutionEnabled()
      ? `Separate host execution permission is enabled. Orbit project directory is ${process.env.WEBPILOT_APP_DIR || process.cwd()}. Use enabled host tools only for user-requested work. Changes to core source require the normal source/update workflow; do not patch installed bundles as an extension. Service lifecycle changes require explicit user instructions.`
      : 'Local host execution is disabled. Extension code has no Node, shell, network or environment access and cannot write core project files. Do not bypass this through another tool, connector or generated document. Use managed capabilities and independent remote runners where allowed.',
  ].join('\n\n');
}
