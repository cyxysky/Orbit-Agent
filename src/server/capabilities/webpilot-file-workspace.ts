import { runtimeSetting } from '@/server/settings/runtime-configuration';
import { createNodeFileWorkspace } from '@cjfclonedeep/capability-sdk/file/node/workspace';
import type { CapabilityConfiguration } from '@cjfclonedeep/capability-sdk';
import { artifactApiUrlFromRelative } from '@/lib/artifacts';
import { artifactsRoot } from '@/server/storage/paths';
import { hostExecutionEnabled } from '@/server/runtime/self-bootstrap-policy';

export function createWebPilotFileWorkspace(configuration?: CapabilityConfiguration) {
  return createNodeFileWorkspace({
    artifactsRoot: artifactsRoot(),
    allowLocalProgramExecution: hostExecutionEnabled(),
    artifactUrl: ({ relativePath }) => artifactApiUrlFromRelative(relativePath),
    configuration: configuration || {
      OFFICE_GENERATION_MODE: runtimeSetting('OFFICE_GENERATION_MODE'),
    },
  });
}
