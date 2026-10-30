import { createNodeFileWorkspace } from '@cjfclonedeep/capability-sdk/file/node/workspace';
import type { CapabilityConfiguration } from '@cjfclonedeep/capability-sdk';
import { artifactApiUrlFromRelative } from '@/lib/artifacts';
import { artifactsRoot } from '@/server/storage/paths';

export function createWebPilotFileWorkspace(configuration?: CapabilityConfiguration) {
  return createNodeFileWorkspace({
    artifactsRoot: artifactsRoot(),
    artifactUrl: ({ relativePath }) => artifactApiUrlFromRelative(relativePath),
    configuration: configuration || {
      OFFICE_GENERATION_MODE: process.env.OFFICE_GENERATION_MODE,
    },
  });
}
