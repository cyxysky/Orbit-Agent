import type { CapabilityResult } from '@cjfclonedeep/capability-sdk';
import { browserOperationSummary } from '@cjfclonedeep/capability-sdk/browser';
import type { BrowserActionResult } from '@cjfclonedeep/capability-sdk/browser/node';

type BrowserActionResultEnvelope = {
  runtime: 'webpilot.browser-action-result' | 'webpilot.browser-operation';
  result: BrowserActionResult;
};

function browserActionEnvelope(value: unknown): BrowserActionResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const envelope = value as Partial<BrowserActionResultEnvelope>;
  return envelope.runtime === 'webpilot.browser-action-result' || envelope.runtime === 'webpilot.browser-operation'
    ? envelope.result
    : undefined;
}

export function browserActionResultToCapabilityResult(
  result: BrowserActionResult,
): CapabilityResult<BrowserActionResultEnvelope> {
  const envelope: BrowserActionResultEnvelope = {
    runtime: 'webpilot.browser-action-result',
    result,
  };
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: result.failureCategory || 'browser-action-failed',
        message: browserOperationSummary(result),
        details: envelope,
      },
    };
  }
  return {
    ok: true,
    summary: browserOperationSummary(result),
    data: envelope,
  };
}

export function capabilityResultToBrowserActionResult(
  result: CapabilityResult,
): BrowserActionResult {
  if (!result.ok) {
    return browserActionEnvelope(result.error.details) || {
      ok: false,
      // Preserve structured diagnostics such as terminal exit codes and stderr.
      // The browser-specific envelope above still retains its native format.
      actual: result.error.details === undefined
        ? result.error.message
        : JSON.stringify({ ok: false, error: result.error }, null, 2),
      failureCategory: result.error.code,
    };
  }
  const browserResult = browserActionEnvelope(result.data);
  if (browserResult) return browserResult;
  const referenceImagePaths = result.content?.flatMap((item) => (
    item.type === 'image' && item.artifactId ? [item.artifactId] : []
  ));
  return {
    ok: true,
    actual: JSON.stringify({
      ok: true,
      summary: result.summary,
      ...(result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? result.data as Record<string, unknown>
        : result.data === undefined ? {} : { data: result.data }),
      ...(result.content?.length ? { content: result.content } : {}),
    }, null, 2),
    ...(referenceImagePaths?.length ? { referenceImagePaths } : {}),
  };
}
