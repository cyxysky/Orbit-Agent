import path from 'node:path';
import { createExtensionManager } from '@cjfclonedeep/capability-sdk/extensions/node';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { appDataRoot } from '@/server/storage/paths';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { selfBootstrapEnabled } from '@/server/runtime/self-bootstrap-policy';
import { publishExtensionToolCatalog } from './extension-catalog';

const projectRoot = path.resolve(process.env.WEBPILOT_APP_DIR || process.cwd());
const dataRelative = path.relative(projectRoot, appDataRoot()).split(path.sep).join('/');
const deniedPaths = ['node_modules', 'runtime', 'dist-server', 'dist-electron', 'dist-desktop', 'dist-backend'];
if (dataRelative && !dataRelative.startsWith('../') && !path.isAbsolute(dataRelative)) deniedPaths.push(dataRelative);
function authorize(context: { userId?: string }) {
  if (!selfBootstrapEnabled() || !isAiOperationsAdmin(context.userId)) {
    throw new CodedError(ERROR_CODES.FORBIDDEN, 'Executable extensions require administrator identity and the deployment self-bootstrap grant.');
  }
}
export const orbitExtensions = createExtensionManager({
  directory: path.join(appDataRoot(), 'extensions'), projectRoot, projectDeniedPaths: deniedPaths,
  allowedPermissions: ['storage:read', 'storage:write', 'project:read'],
  authorizeManagement: authorize, authorizeInvocation: authorize,
});
export async function refreshExtensionToolCatalog() {
  if (!selfBootstrapEnabled()) { publishExtensionToolCatalog([]); return []; }
  const snapshot = await orbitExtensions.snapshot();
  publishExtensionToolCatalog(snapshot.catalog);
  return snapshot.providers;
}
