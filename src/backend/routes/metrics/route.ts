import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { runtimeMetricsSnapshot } from '@/server/observability/runtime-observability';
import { databaseWriteQueueSnapshot } from '@/server/storage/database-write-queue';
import { fileTextExtractionPoolSnapshot } from '@/server/capabilities/webpilot-file-observability';
import { requestHasAdminSettingsAccess } from '@/server/settings/admin-settings-access';


export async function GET(request: Request) {
  try {
    if (!requestHasAdminSettingsAccess(request)) {
      throw new ApiRequestError('Administrator access is required', { code: 'admin_access_required', status: 401 });
    }
    return apiJson(request, {
      metrics: runtimeMetricsSnapshot(),
      queues: {
        cpuWorkers: fileTextExtractionPoolSnapshot(),
        databaseWrites: databaseWriteQueueSnapshot(),
      },
    });
  } catch (error) {
    return apiError(request, error, { fallback: 'Unable to read runtime metrics', status: 500 });
  }
}
