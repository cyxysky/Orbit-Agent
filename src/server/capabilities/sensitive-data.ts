import { capabilityConfigurationFromEnvironment } from '@cjfclonedeep/capability-sdk/host';
import { sensitiveDataCapabilityManifest } from '@cjfclonedeep/capability-sdk/sensitive-data';
import {
  createNodeSensitiveDataFilter,
  sensitiveDataFilterConfigFromEnvironment,
} from '@cjfclonedeep/capability-sdk/sensitive-data/node';

const sensitiveDataRuntime = createNodeSensitiveDataFilter({
  getConfig: () => sensitiveDataFilterConfigFromEnvironment(
    capabilityConfigurationFromEnvironment(sensitiveDataCapabilityManifest, process.env),
  ),
});

export const filterSensitiveData = sensitiveDataRuntime.filterSensitiveData;
export const redactSensitiveTexts = sensitiveDataRuntime.redactSensitiveTexts;
