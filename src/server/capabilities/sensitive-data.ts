import { capabilityConfigurationFromEnvironment } from '@cjfclonedeep/capability-sdk/host';
import { sensitiveDataCapabilityManifest } from '@cjfclonedeep/capability-sdk/sensitive-data';
import {
  createNodeSensitiveDataFilter,
  sensitiveDataFilterConfigFromEnvironment,
} from '@cjfclonedeep/capability-sdk/sensitive-data/node';
import { sensitiveDataRuntimeDirectory } from './sensitive-data-runtime';

const sensitiveDataRuntime = createNodeSensitiveDataFilter({
  getConfig: () => {
    sensitiveDataRuntimeDirectory();
    return sensitiveDataFilterConfigFromEnvironment(
      capabilityConfigurationFromEnvironment(sensitiveDataCapabilityManifest, process.env),
    );
  },
});

export const filterSensitiveData = sensitiveDataRuntime.filterSensitiveData;
export const redactSensitiveTexts = sensitiveDataRuntime.redactSensitiveTexts;
