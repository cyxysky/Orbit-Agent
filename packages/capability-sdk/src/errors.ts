/** The single source of truth for Orbit and capability error codes.
 * Keep values stable: callers, stored traces and integrations use these strings.
 */
export const ERROR_CODES = Object.freeze({
  ACCOUNT_ALREADY_EXISTS: 'account_already_exists',
  ABORTED: "aborted",
  ACCOUNT_OPERATION_FAILED: "account_operation_failed",
  ADMIN_ACCESS_REQUIRED: "admin_access_required",
  ADMIN_PASSWORD_NOT_CONFIGURED: "admin_password_not_configured",
  AI_OPERATIONS_ADMIN_REQUIRED: "ai_operations_admin_required",
  AI_FIRST_CHUNK_TIMEOUT: "ai-first-chunk-timeout",
  AI_REQUEST_TIMEOUT: "ai-request-timeout",
  AI_RUNTIME_FAILED: "ai-runtime-failed",
  APPLICATION_ERROR: "application-error",
  AUTOMATIC_SCREENSHOT_DISABLED: "automatic-screenshot-disabled",
  AUTOMATION_RUN_CANCELLED: "automation-run-cancelled",
  AUTOMATION_RUN_LEASE_LOST: "automation-run-lease-lost",
  BRIDGE_ERROR: "bridge_error",
  BROWSER_COOKIE_INVALID: "browser_cookie_invalid",
  BROWSER_COOKIE_MISSING: "browser_cookie_missing",
  BROWSER_COOKIE_TOO_LARGE: "browser_cookie_too_large",
  BROWSER_NOT_FOUND: "browser_not_found",
  BROWSER_ABORTED: "browser-aborted",
  BROWSER_ACTION_FAILED: "browser-action-failed",
  BROWSER_CODE_FAILED: "browser-code-failed",
  BROWSER_COMPLETED: "browser-completed",
  BROWSER_CRASHED: "browser-crashed",
  BROWSER_FAILED: "browser-failed",
  BROWSER_IMAGE_NOT_FOUND: "browser-image-not-found",
  BROWSER_KERNEL_OUT_OF_MEMORY: "browser-kernel-out-of-memory",
  BROWSER_OPEN_FAILED: "browser-open-failed",
  BROWSER_OPERATION_FAILED: "browser-operation-failed",
  BROWSER_RESULT_FAILED: "browser-result-failed",
  BROWSER_SESSION_CAPACITY_REACHED: "browser-session-capacity-reached",
  BROWSER_SESSION_NOT_FOUND: "browser-session-not-found",
  BROWSER_SNAPSHOT_STALE: "browser-snapshot-stale",
  BROWSER_STATE_FAILED: "browser-state-failed",
  BROWSER_TIMEOUT: "browser-timeout",
  BROWSER_UNAVAILABLE: "browser-unavailable",
  BUSY: "busy",
  CAPABILITY_EXECUTION_FAILED: "capability-execution-failed",
  CHART_REVISION_CONFLICT: "chart_revision_conflict",
  CHART_API_MODULE_NOT_FOUND: "chart-api-module-not-found",
  CHART_GENERATION_FAILED: "chart-generation-failed",
  CHART_NOT_FOUND: "chart-not-found",
  CHART_OPERATION_FAILED: "chart-operation-failed",
  CHART_REVISION_CONFLICT_TOOL: "chart-revision-conflict",
  CODE_EXECUTION_ERROR: "code-execution-error",
  CODE_EXECUTION_FAILED: "code-execution-failed",
  CODE_FAILED: "code-failed",
  CODE_FILE_READ_FAILED: "code-file-read-failed",
  CODE_PACKAGE_INSTALL_DISABLED: "code-package-install-disabled",
  CODE_PACKAGE_LIMIT: "code-package-limit",
  CODE_PACKAGE_SPEC_INVALID: "code-package-spec-invalid",
  CODE_SANDBOX_DISABLED: "code-sandbox-disabled",
  CODE_SANDBOX_RUNNER_TIMEOUT: "code-sandbox-runner-timeout",
  CODE_SANDBOX_RUNNER_UNAVAILABLE: "code-sandbox-runner-unavailable",
  CODEX_RPC_FAILED: "codex-rpc-failed",
  COMMONJS_REQUIRE: "COMMONJS_REQUIRE",
  COMMUNICATION_CHANNEL_NOT_FOUND: "communication-channel-not-found",
  COMMUNICATION_DELIVERY_PENDING: "communication-delivery-pending",
  COMMUNICATION_DRAFT_INVALID: "communication-draft-invalid",
  COMMUNICATION_DRAFT_NOT_FOUND: "communication-draft-not-found",
  COMMUNICATION_NOT_SENT: "communication-not-sent",
  COMMUNICATION_OPERATION_FAILED: "communication-operation-failed",
  COMMUNICATION_SEND_DISABLED: "communication-send-disabled",
  COMPLETION_REVIEW_UNAVAILABLE: "COMPLETION_REVIEW_UNAVAILABLE",
  COMPLETION_REVIEW_REJECTED: "completion-review-rejected",
  COMPUTER_DISABLED: "computer-disabled",
  COMPUTER_OPERATION_FAILED: "computer-operation-failed",
  CONFIGURATION_INVALID: "configuration-invalid",
  CONNECTOR_CALL_FAILED: "connector-call-failed",
  CONNECTOR_NOT_FOUND: "connector-not-found",
  CONNECTOR_OPERATION_FAILED: "connector-operation-failed",
  CONNECTOR_OPERATION_NOT_FOUND: "connector-operation-not-found",
  CONTEXT_READ_FAILED: "context-read-failed",
  CONTEXT_SUMMARY_FAILED: "context-summary-failed",
  DATA_TRANSFER_FAILED: "data_transfer_failed",
  DATA_OPERATION_FAILED: "data-operation-failed",
  DATA_SOURCE_NOT_FOUND: "data-source-not-found",
  DATA_WRITE_DISABLED: "data-write-disabled",
  DESIGN_BRIEF_INVALID: "DESIGN_BRIEF_INVALID",
  DESIGN_REVIEW_REQUIRED: "DESIGN_REVIEW_REQUIRED",
  DOCUMENT_DESIGN_INVALID: "document-design-invalid",
  DOCX_BODY_MISSING: "DOCX_BODY_MISSING",
  DOCX_DRAWING_SIZE_INVALID: "DOCX_DRAWING_SIZE_INVALID",
  DOCX_DUPLICATE_BOOKMARK: "DOCX_DUPLICATE_BOOKMARK",
  DOCX_FIXED_TABLE_ROWS_REQUIRE_VISUAL_QA: "DOCX_FIXED_TABLE_ROWS_REQUIRE_VISUAL_QA",
  DOCX_FLOATING_OBJECTS_REQUIRE_VISUAL_QA: "DOCX_FLOATING_OBJECTS_REQUIRE_VISUAL_QA",
  DOCX_SECTION_PROPERTIES_MISSING: "DOCX_SECTION_PROPERTIES_MISSING",
  DOCX_TEXT_FRAMES_REQUIRE_VISUAL_QA: "DOCX_TEXT_FRAMES_REQUIRE_VISUAL_QA",
  EDIT_REPLAY_CONFIRMED: "EDIT_REPLAY_CONFIRMED",
  ELEMENT_MAPPING_NOT_EMBEDDED: "ELEMENT_MAPPING_NOT_EMBEDDED",
  EMBED_AUTH_FAILED: "embed-auth-failed",
  EVALUATION_SET_EMPTY: "evaluation_set_empty",
  EXECUTION_RESTARTED: "execution_restarted",
  EXECUTION_UNAVAILABLE: "execution_unavailable",
  EXECUTION_UNCERTAIN: "execution-uncertain",
  FACADE_COMPONENT_ACCESS_UNSUPPORTED: "FACADE_COMPONENT_ACCESS_UNSUPPORTED",
  FILE_ACTION_INPUT_MISMATCH: "file-action-input-mismatch",
  FILE_ACTION_UNAVAILABLE: "file-action-unavailable",
  FILE_API_FAILED: "file-api-failed",
  FILE_CONVERT_FAILED: "file-convert-failed",
  FILE_DESIGN_REVIEW_INCOMPLETE: "file-design-review-incomplete",
  FILE_DOWNLOAD_FAILED: "file-download-failed",
  FILE_EDIT_FAILED: "file-edit-failed",
  FILE_EXECUTION_FAILED: "file-execution-failed",
  FILE_GENERATE_FAILED: "file-generate-failed",
  FILE_JS_API_FAILED: "file-js-api-failed",
  FILE_LIST_FAILED: "file-list-failed",
  FILE_OPERATION_FAILED: "file-operation-failed",
  FILE_PLAN_FAILED: "file-plan-failed",
  FILE_READ_CONTENT_FAILED: "file-read-content-failed",
  FILE_READ_FAILED: "file-read-failed",
  FILE_READ_SOURCE_FAILED: "file-read-source-failed",
  FILE_RENDER_FAILED: "file-render-failed",
  FILE_UNO_API_FAILED: "file-uno-api-failed",
  FILE_VISUAL_ACTION_UNAVAILABLE: "file-visual-action-unavailable",
  FILE_VISUAL_FAILED: "file-visual-failed",
  FILE_VISUAL_READ_FAILED: "file-visual-read-failed",
  FILE_VISUAL_REPORT_FAILED: "file-visual-report-failed",
  FILE_VISUAL_VERSION_FAILED: "file-visual-version-failed",
  FILE_WRITE_FAILED: "file-write-failed",
  FONT_NOT_FOUND: "FONT_NOT_FOUND",
  FORBIDDEN: "forbidden",
  HTML_SOURCE_INVALID: "HTML_SOURCE_INVALID",
  HTTP_CLIENT_DISCONNECTED: "http-client-disconnected",
  HTTP_REQUEST_FAILED: "http-request-failed",
  HTTP_RESPONSE_TOO_LARGE: "http-response-too-large",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  INCOMPLETE_TOOL_EXCHANGE: "incomplete-tool-exchange",
  INIT_ERROR: "init-error",
  INPUT_CAPACITY_EXCEEDED: "input-capacity-exceeded",
  INPUT_LIMIT: "input-limit",
  INSTRUCTION_REQUIRED: "instruction_required",
  INTEGRATION_NOT_FOUND: "integration_not_found",
  INTEGRATION_TEST_FAILED: "integration_test_failed",
  INTERNAL_ERROR: "internal_error",
  INTERRUPTED_TOOL_OUTCOME: "interrupted-tool-outcome",
  INVALID_ADMIN_PASSWORD: "invalid_admin_password",
  INVALID_AI_OPERATIONS_RANGE: "invalid_ai_operations_range",
  INVALID_AI_OPERATIONS_USER_ID: "invalid_ai_operations_user_id",
  INVALID_API_KEY: "INVALID_API_KEY",
  INVALID_CANDIDATE: "invalid_candidate",
  INVALID_IDEMPOTENCY_KEY: "invalid_idempotency_key",
  INVALID_INTEGRATION_ID: "invalid_integration_id",
  INVALID_REQUEST: "invalid_request",
  INVALID_REVIEW: "invalid_review",
  INVALID_SCOPE: "invalid_scope",
  INVALID_TAB_ID: "invalid_tab_id",
  INVALID_TIME: "invalid_time",
  INVALID_TIMEZONE: "invalid_timezone",
  INVALID_URL_ENCODING: "invalid_url_encoding",
  INVALID_CAPTURE_TIME: "invalid-capture-time",
  INVALID_FILE_ACTION: "invalid-file-action",
  INVALID_FILE_VISUAL_ACTION: "invalid-file-visual-action",
  INVALID_HANDOFF: "invalid-handoff",
  INVALID_INPUT: "invalid-input",
  INVALID_REQUEST_TOOL: "invalid-request",
  JAVASCRIPT_ENTRYPOINT_MISSING: "JAVASCRIPT_ENTRYPOINT_MISSING",
  JS1005: "JS1005",
  KNOWLEDGE_DOCUMENT_NOT_FOUND: "knowledge-document-not-found",
  KNOWLEDGE_OPERATION_FAILED: "knowledge-operation-failed",
  LIBREOFFICE_RENDER_FAILED: "LIBREOFFICE_RENDER_FAILED",
  LIBREOFFICE_RENDERER_UNAVAILABLE: "LIBREOFFICE_RENDERER_UNAVAILABLE",
  MAPS_INVALID_LIMIT: "maps-invalid-limit",
  MAPS_INVALID_RESPONSE: "maps-invalid-response",
  MAPS_MONTHLY_LIMIT: "maps-monthly-limit",
  MAPS_NETWORK_FAILED: "maps-network-failed",
  MAPS_NOT_FOUND: "maps-not-found",
  MAPS_OPERATION_FAILED: "maps-operation-failed",
  MEDIA_OPERATION_ABORTED: "media-operation-aborted",
  MEDIA_OPERATION_FAILED: "media-operation-failed",
  MEDIA_OPERATION_UNAVAILABLE: "media-operation-unavailable",
  MEMORY_EXTRACTION_DISABLED: "memory_extraction_disabled",
  METHOD_NOT_ALLOWED: "method_not_allowed",
  MISSING_NEW_EVIDENCE: "missing_new_evidence",
  MISSING_OBSERVATION: "missing-observation",
  MISSING_TOOL_CALL_ID: "missing-tool-call-id",
  MISSING_TOOL_RECEIPT: "missing-tool-receipt",
  MISSING_VIEWPORT_EVIDENCE: "missing-viewport-evidence",
  MISSING_WORKER: "missing-worker",
  MIXED_MODULE_SYSTEM: "MIXED_MODULE_SYSTEM",
  MODEL_IMAGE_INPUT_UNSUPPORTED: "model_image_input_unsupported",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  MODEL_PROVIDER_DISABLED: "model_provider_disabled",
  MODEL_IMAGE_INPUT_UNAVAILABLE: "model-image-input-unavailable",
  NO_COMPLETED_TURN: "no_completed_turn",
  NOT_FOUND: "not_found",
  OBSERVATION_UNAVAILABLE: "observation-unavailable",
  OFFICE_ARTIFACT_REOPEN_FAILED: "OFFICE_ARTIFACT_REOPEN_FAILED",
  OFFICE_PACKAGE_ENTRY_MISSING: "OFFICE_PACKAGE_ENTRY_MISSING",
  OFFICE_PRESERVE_ONLY_FEATURE_LOST: "OFFICE_PRESERVE_ONLY_FEATURE_LOST",
  OFFICE_RELATIONSHIP_TARGET_MISSING: "OFFICE_RELATIONSHIP_TARGET_MISSING",
  OFFICE_RENDER_FAILURE: "office-render-failure",
  OFFICE_RENDER_INFRASTRUCTURE_ERROR: "office-render-infrastructure-error",
  OFFICE_RUNTIME_VALIDATION_FAILED: "office-runtime-validation-failed",
  OUTPUT_WRITE_NOT_OBSERVED: "OUTPUT_WRITE_NOT_OBSERVED",
  OUTPUT_ERROR: "output-error",
  OVERSIZED_EMBEDDED_IMAGE: "OVERSIZED_EMBEDDED_IMAGE",
  PAGE_APPEARS_BLANK: "PAGE_APPEARS_BLANK",
  PAGE_IMAGE_EMPTY: "PAGE_IMAGE_EMPTY",
  PATCH_ATOMIC_CONFLICT: "PATCH_ATOMIC_CONFLICT",
  PATCH_INPUT_REJECTED: "PATCH_INPUT_REJECTED",
  PATCH_NO_CHANGES: "PATCH_NO_CHANGES",
  PAYLOAD_TOO_LARGE: "payload_too_large",
  PDF_HAS_NO_PAGES: "PDF_HAS_NO_PAGES",
  PDF_HEADER_INVALID: "PDF_HEADER_INVALID",
  PDF_PARSE_FAILED: "PDF_PARSE_FAILED",
  PPTX_CHART_HAS_NO_SERIES: "PPTX_CHART_HAS_NO_SERIES",
  PPTX_DUPLICATE_SHAPE_ID: "PPTX_DUPLICATE_SHAPE_ID",
  PPTX_ELEMENT_ID_MISSING: "PPTX_ELEMENT_ID_MISSING",
  PPTX_NO_SLIDES: "PPTX_NO_SLIDES",
  PPTX_OBJECT_OUT_OF_BOUNDS: "PPTX_OBJECT_OUT_OF_BOUNDS",
  PPTX_TABLE_COLUMN_WIDTH_INVALID: "PPTX_TABLE_COLUMN_WIDTH_INVALID",
  PPTX_TABLE_ROW_HEIGHT_INVALID: "PPTX_TABLE_ROW_HEIGHT_INVALID",
  PPTX_UNMAPPED_GENERATED_OBJECT: "PPTX_UNMAPPED_GENERATED_OBJECT",
  PRESENTATION_ANIMATION_TARGET_INVALID: "PRESENTATION_ANIMATION_TARGET_INVALID",
  PRESENTATION_CUSTOM_SHOW_INDEX_INVALID: "PRESENTATION_CUSTOM_SHOW_INDEX_INVALID",
  PRESENTATION_GEOMETRY_INVALID: "PRESENTATION_GEOMETRY_INVALID",
  PRESENTATION_MASTER_SELECTOR_INVALID: "PRESENTATION_MASTER_SELECTOR_INVALID",
  PREVIEW_UNAVAILABLE: "preview_unavailable",
  PROVIDER_RESPONSE: "provider-response",
  PYTHON_AST_UNAVAILABLE: "PYTHON_AST_UNAVAILABLE",
  QUEUED_MESSAGE_NOT_DELETABLE: "queued_message_not_deletable",
  REFRESHED_CONTEXT: "refreshed-context",
  REQUEST_FAILED: "request_failed",
  REQUEST_IN_PROGRESS: "request_in_progress",
  REQUEST_FAILED_TOOL: "request-failed",
  RESPONSE_OPERATION_FAILED: "response-operation-failed",
  RESUME_FAILED: "resume_failed",
  REVISION_CONFLICT: "revision_conflict",
  RUN_ALREADY_FINISHED: "run_already_finished",
  RUNTIME_SKILL_READ_REQUIRED: "RUNTIME_SKILL_READ_REQUIRED",
  SCHEDULE_ID_REQUIRED: "schedule_id_required",
  SCREENSHOT_TIMEOUT: "screenshot-timeout",
  SERVER_ERROR: "server-error",
  SESSION_BUSY: "session_busy",
  SKILL_READ_REQUIRED: "skill-read-required",
  SKILL_UNAVAILABLE: "skill-unavailable",
  SOURCE_UNIT_NOT_FOUND: "SOURCE_UNIT_NOT_FOUND",
  SOURCE_INPUT_LIMIT: "source-input-limit",
  STATE_CONFLICT: "state-conflict",
  STORAGE_QUOTA_EXCEEDED: "storage_quota_exceeded",
  STORAGE_OPERATION_FAILED: "storage-operation-failed",
  SUBAGENT_NOT_WAITING: "subagent_not_waiting",
  SUBAGENT_PREVIEW_UNAVAILABLE: "subagent_preview_unavailable",
  SUBAGENT_UNAVAILABLE: "subagent-unavailable",
  SURFACE_DISMISSAL_UNCERTAIN: "surface-dismissal-uncertain",
  TAB_SWITCH_FAILED: "tab_switch_failed",
  TERMINAL_DISABLED: "terminal-disabled",
  TERMINAL_FAILED: "terminal-failed",
  TERMINAL_INTERRUPTED: "terminal-interrupted",
  TERMINAL_OPERATION_FAILED: "terminal-operation-failed",
  TERMINAL_TIMED_OUT: "terminal-timed_out",
  TEXT_EDITOR_OPERATION_FAILED: "text-editor-operation-failed",
  TEXT_REWRITE_INCOMPLETE: "text-rewrite-incomplete",
  TIMEOUT: "timeout",
  TIMEZONE_REQUIRED: "timezone_required",
  TITLE_REQUIRED: "title_required",
  UNEXPECTED_FINISH_REASON: "unexpected-finish-reason",
  UNO_API_ARGUMENT_INVALID: "UNO_API_ARGUMENT_INVALID",
  UNO_PYTHON_IMPORT_UNSUPPORTED: "UNO_PYTHON_IMPORT_UNSUPPORTED",
  UNO_REQUIRED_CAPABILITY_MISSING: "UNO_REQUIRED_CAPABILITY_MISSING",
  UNO_RUNTIME_ERROR: "UNO_RUNTIME_ERROR",
  UNO_STYLE_PROPERTY_INFO_MISSING: "UNO_STYLE_PROPERTY_INFO_MISSING",
  UNO_WORKER_INTERNAL_ERROR: "UNO_WORKER_INTERNAL_ERROR",
  UNO_DRAFT_PATCH_CONFLICT: "uno-draft-patch-conflict",
  UNO_INFRASTRUCTURE_ERROR: "uno-infrastructure-error",
  UNREADABLE_EMBEDDED_IMAGE: "UNREADABLE_EMBEDDED_IMAGE",
  UNSUPPORTED_CONCLUSION: "unsupported-conclusion",
  UNSUPPORTED_TOOL: "unsupported-tool",
  UPLOAD_FAILED: "upload_failed",
  UPLOAD_USAGE_FAILED: "upload_usage_failed",
  VALIDATION_FAILED: "validation_failed",
  WORKER_VERSION_UNAVAILABLE: "worker-version-unavailable",
  XLSX_DIMENSION_INVALID: "XLSX_DIMENSION_INVALID",
  XLSX_DUPLICATE_SHEET_NAME: "XLSX_DUPLICATE_SHEET_NAME",
  XLSX_FORMULA_ERROR_LITERAL: "XLSX_FORMULA_ERROR_LITERAL",
  XLSX_NO_WORKSHEETS: "XLSX_NO_WORKSHEETS",
  MAPS_NOT_CONFIGURED: "maps-not-configured",
  MAPS_NO_ROUTE: "maps-no-route",
  JAVASCRIPT_SYNTAX: "JAVASCRIPT_SYNTAX",
  PYTHON_SYNTAX: "PYTHON_SYNTAX",
  PYTHON_UNDEFINED_NAME: "PYTHON_UNDEFINED_NAME",
  PYTHON_INDEX_OUT_OF_RANGE: "PYTHON_INDEX_OUT_OF_RANGE",
  UNO_BRIDGE_STARTUP: "UNO_BRIDGE_STARTUP",
  UNO_BRIDGE_DISPOSED: "UNO_BRIDGE_DISPOSED",
  UNO_RUNTIME_WARNING: "UNO_RUNTIME_WARNING",
  PRESENTATION_TEXT_OVERFLOW: "PRESENTATION_TEXT_OVERFLOW",
  PRESENTATION_OVERLAP: "PRESENTATION_OVERLAP",
  DUPLICATE_ELEMENT_ID: "DUPLICATE_ELEMENT_ID",
  FACADE_METHOD_ON_RAW_UNO_DOCUMENT: "FACADE_METHOD_ON_RAW_UNO_DOCUMENT",
  DRAFT_ENTRYPOINT_CALLED_DIRECTLY: "DRAFT_ENTRYPOINT_CALLED_DIRECTLY",
  CHART_DATA_ROLE_INVALID: "CHART_DATA_ROLE_INVALID",
  CHART_STYLE_INVALID: "CHART_STYLE_INVALID",
  PRESENTATION_TABLE_CELL_OUT_OF_RANGE: "PRESENTATION_TABLE_CELL_OUT_OF_RANGE",
} as const);

export const ERROR_CODE_PREFIXES = Object.freeze({
  JAVASCRIPT_DIAGNOSTIC: 'JS',
  OFFICE_RUNTIME_DIAGNOSTIC: 'RUNTIME_',
  MAPS_HTTP: 'maps-http-',
} as const);

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]
  | `JS${number}` | `RUNTIME_${string}` | `maps-http-${number}`;

const registeredCodes = new Set<string>(Object.values(ERROR_CODES));

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (registeredCodes.has(value)
    || /^JS\d+$/.test(value) || /^RUNTIME_[A-Z][A-Z0-9_]*$/.test(value) || /^maps-http-\d{3}$/.test(value));
}

export function normalizeErrorCode(value: unknown, fallback: ErrorCode = ERROR_CODES.APPLICATION_ERROR): ErrorCode {
  return isErrorCode(value) ? value : fallback;
}

/** Numeric protocol codes and operating-system errno remain in the original cause. */
export function getErrorCode(error: unknown, fallback: ErrorCode = ERROR_CODES.APPLICATION_ERROR): ErrorCode {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object' && !seen.has(current); depth++) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    if (isErrorCode(value.code)) return value.code;
    if (isErrorCode(value.failureCategory)) return value.failureCategory;
    if (value.name === 'AbortError') return ERROR_CODES.ABORTED;
    if (value.name === 'TimeoutError') return ERROR_CODES.TIMEOUT;
    if (value.name === 'ZodError' || value.name === 'AI_TypeValidationError') return ERROR_CODES.VALIDATION_FAILED;
    current = value.cause;
  }
  return fallback;
}

export class CodedError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string = code, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodedError';
    this.code = code;
  }

  override toString() { return `[${this.code}] ${this.name}: ${this.message}`; }
}

export class CodedAggregateError extends AggregateError {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, errors: Iterable<unknown>, message?: string, options?: ErrorOptions) {
    super(errors, message, options);
    this.code = code;
  }
}

export function toCodedError(error: unknown, fallback: ErrorCode = ERROR_CODES.APPLICATION_ERROR): Error & { code: ErrorCode } {
  if (error instanceof Error && isErrorCode((error as Error & { code?: unknown }).code)) {
    return error as Error & { code: ErrorCode };
  }
  const result = new CodedError(getErrorCode(error, fallback), errorMessage(error), { cause: error });
  if (error instanceof Error) result.name = error.name;
  return result;
}

export function errorText(error: unknown, fallback: ErrorCode = ERROR_CODES.APPLICATION_ERROR): string {
  return `[${getErrorCode(error, fallback)}] ${errorMessage(error)}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return String(error);
}

/** Preserve the payload while ensuring every failed API/tool result has a registered code. */
export function withErrorCode<T>(result: T, fallback: ErrorCode = ERROR_CODES.APPLICATION_ERROR): T {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const value = result as Record<string, unknown>;
  if (value.ok !== false && value.success !== false && value.accepted !== false && value.error === undefined) return result;
  const detail = value.error && typeof value.error === 'object' && !Array.isArray(value.error)
    ? value.error as Record<string, unknown> : undefined;
  const code = getErrorCode(value, getErrorCode(detail, fallback));
  return {
    ...value,
    code,
    ...(value.code !== undefined && value.code !== code ? { upstreamCode: value.code } : {}),
    ...(value.failureCategory !== undefined ? { failureCategory: code } : {}),
    ...(detail ? { error: {
      ...detail, code,
      ...(detail.code !== undefined && detail.code !== code ? { upstreamCode: detail.code } : {}),
    } } : {}),
  } as T;
}

export function javascriptDiagnosticCode(code: number): ErrorCode {
  return `${ERROR_CODE_PREFIXES.JAVASCRIPT_DIAGNOSTIC}${Number.isFinite(code) ? Math.max(0, Math.trunc(code)) : 0}`;
}

export function officeRuntimeDiagnosticCode(kind: unknown): ErrorCode {
  const suffix = String(kind || 'LAYOUT').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return `${ERROR_CODE_PREFIXES.OFFICE_RUNTIME_DIAGNOSTIC}${/^[A-Z]/.test(suffix) ? suffix : `LAYOUT_${suffix}`}`;
}

export function terminalCommandErrorCode(status: string): ErrorCode {
  return status === 'timed_out' ? ERROR_CODES.TERMINAL_TIMED_OUT
    : status === 'interrupted' ? ERROR_CODES.TERMINAL_INTERRUPTED : ERROR_CODES.TERMINAL_FAILED;
}

export function browserExecutionErrorCode(status: string | undefined): ErrorCode {
  const codes: Readonly<Record<string, ErrorCode>> = {
    completed: ERROR_CODES.BROWSER_COMPLETED,
    failed: ERROR_CODES.BROWSER_FAILED,
    timeout: ERROR_CODES.BROWSER_TIMEOUT,
    aborted: ERROR_CODES.BROWSER_ABORTED,
    crashed: ERROR_CODES.BROWSER_CRASHED,
  };
  return status ? codes[status] || ERROR_CODES.BROWSER_CODE_FAILED : ERROR_CODES.BROWSER_CODE_FAILED;
}

export function mapsHttpErrorCode(status: number): ErrorCode {
  return `${ERROR_CODE_PREFIXES.MAPS_HTTP}${Number.isFinite(status) ? Math.max(100, Math.min(599, Math.trunc(status))) : 500}`;
}
