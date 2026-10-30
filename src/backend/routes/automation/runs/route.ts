import { automationRunStatusSchema } from '@/server/automation/automation.schema';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiJson, boundedQueryInteger } from '@/server/http/api-request';
import { listAutomationRuns } from '@/server/storage/automation-store';


export async function GET(request: Request) {
  const parsedStatus = automationRunStatusSchema.safeParse(new URL(request.url).searchParams.get('status'));
  return apiJson(request, {
    runs: await listAutomationRuns({
      userId: requestApplicationUserId(request),
      caseId: new URL(request.url).searchParams.get('caseId')?.trim() || undefined,
      scheduleId: new URL(request.url).searchParams.get('scheduleId')?.trim() || undefined,
      status: parsedStatus.success ? parsedStatus.data : undefined,
      limit: boundedQueryInteger(new URL(request.url).searchParams.get('limit'), { fallback: 100, max: 500 }),
    }),
  });
}
