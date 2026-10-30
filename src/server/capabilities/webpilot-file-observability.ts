import {
  configureNodeFileTextExtractionObserver,
  nodeFileTextExtractionPoolSnapshot,
} from '@cjfclonedeep/capability-sdk/file/node';
import {
  incrementMetric,
  recordMetricTiming,
  setMetricGauge,
  structuredLog,
} from '@/server/observability/runtime-observability';

configureNodeFileTextExtractionObserver({
  incrementMetric,
  recordMetricTiming,
  setMetricGauge,
  structuredLog,
});

export const fileTextExtractionPoolSnapshot = nodeFileTextExtractionPoolSnapshot;
