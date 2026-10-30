/** Framework-neutral Office document and workflow data contracts. */
export type OfficeCellValue = string | number | boolean | null;

export type OfficeDocumentKind = 'presentation' | 'spreadsheet' | 'word';

/** Authoring decisions, not a claim that the rendered artifact passed design review. */
export type OfficeDesignBrief = {
  mode: 'template' | 'bespoke';
  audience?: string;
  objective?: string;
  reference?: string;
  directions?: Array<{
    id: string;
    concept: string;
    composition: string;
    typography: string;
    imagery: string;
  }>;
  selectedDirection?: string;
  selectionReason?: string;
  rhythm?: string;
  preserve?: string[];
  avoid?: string[];
};

export type OfficeVisualQaCheckStatus = 'failed' | 'not-applicable' | 'passed';

export type OfficeVisualQaPageChecks = {
  overlap: OfficeVisualQaCheckStatus;
  clipping: OfficeVisualQaCheckStatus;
  alignment: OfficeVisualQaCheckStatus;
  spacing: OfficeVisualQaCheckStatus;
  typography: OfficeVisualQaCheckStatus;
  contrast: OfficeVisualQaCheckStatus;
  visualHierarchy: OfficeVisualQaCheckStatus;
  chartTableLegibility: OfficeVisualQaCheckStatus;
  imageQuality: OfficeVisualQaCheckStatus;
};

export type OfficeVisualQaDeckChecks = {
  templateConsistency: 'failed' | 'passed';
  typographyConsistency: 'failed' | 'passed';
  colorConsistency: 'failed' | 'passed';
  spacingRhythm: 'failed' | 'passed';
  componentConsistency: 'failed' | 'passed';
  /** Required for briefs explicitly planned as bespoke; optional for legacy drafts. */
  designIntent?: 'failed' | 'passed';
  compositionRhythm?: 'failed' | 'passed';
  contentConsistency?: 'failed' | 'passed';
  sourceTraceability?: 'failed' | 'passed';
};

export type OfficeVisualQaIssue = {
  type: string;
  description: string;
  region?: string;
  severity?: 'error' | 'warning';
};

export type OfficeVisualQaDeckReview = {
  status: 'failed' | 'passed';
  observation: string;
  checks: OfficeVisualQaDeckChecks;
  issues: OfficeVisualQaIssue[];
};

/** A planned document plus its executable source draft. */
export type OfficeDocumentDraft = {
  createdAt: string;
  documentId: string;
  documentType: OfficeDocumentKind;
  fileName: string;
  intent?: string;
  design?: OfficeDesignBrief;
  /** Create a new file or modify a user-supplied Office document in place. */
  operation?: 'create' | 'modify';
  /** Program runtime selected when the workspace is planned. Existing-file modification always uses UNO. */
  generator?: 'javascript' | 'uno' | 'html';
  /** Digest of the most recently delivered executable facade module. */
  unoApiCatalogDigest?: string;
  /** First module delivery time. */
  unoApiCatalogLoadedAt?: string;
  /** Module query -> installed-catalog digest, used to recognize repeated lookups. */
  unoApiModuleDigests?: Record<string, string>;
  /** Bound source file for a real existing-document modification workspace. */
  sourceDocument?: {
    assetName: string;
    attachmentId: string;
    bytes: number;
    fileName: string;
    sha256: string;
  };
  /** Complete Python source run verbatim by the LibreOffice UNO worker. */
  program?: string;
  /** SHA-256 of the workspace draft.py content, used to detect split-brain metadata. */
  sourceDigest?: string;
  /** Receipt committed with source bytes. Only the identical latest edit at this resulting revision is replayable. */
  lastSourceEdit?: {
    requestDigest: string;
    beforeDigest: string;
    afterDigest: string;
    totalHunks: number;
  };
  /** Digest of the current source after static analysis, execution, reopen, and structural validation pass. */
  validatedSourceDigest?: string;
  validationStatus?: 'failed' | 'pending' | 'passed';
  /** Failed validations in this repair sequence; may have different causes and source versions. Not a bridge retry count. */
  validationFailureCount?: number;
  /** Source/worker revision actually checked, not the time the draft was last read or saved. */
  validationEvidence?: {
    sourceDigest: string;
    workerDigest: string | null;
    checkedAt: string;
    scope: 'document' | 'source-unit';
    sourceUnitPath?: string;
    stage: 'static-analysis' | 'execution' | 'artifact-validation' | 'complete';
  };
  validationDiagnostics?: Array<{
    code?: string;
    column?: number;
    elementId?: string;
    elementIds?: string[];
    line?: number;
    locator?: Record<string, unknown>;
    message: string;
    page?: number;
    severity?: 'error' | 'warning';
    shapes?: number[];
    sourceExcerpt?: string;
    target?: string;
    unitPath?: string;
  }>;
  /** Stable source-to-artifact identity records emitted by the active authoring runtime. */
  elementMap?: Array<{
    artifactName?: string;
    column?: number;
    elementId: string;
    kind: string;
    line?: number;
    locator?: Record<string, unknown>;
    unitPath?: string;
  }>;
  /** Deterministic LibreOffice renderer validation for the validated source. */
  rendererValidation?: Record<string, unknown>;
  /** Logical page/section units from explicit markers or inferred presentation slide blocks. */
  sourceUnits?: Array<{
    path: string;
    sourceDigest: string;
    validatedDigest?: string;
    status: 'failed' | 'pending' | 'passed';
  }>;
  workflow?: {
    state: 'authoring' | 'completed' | 'failed' | 'planned' | 'qa-pending' | 'render-ready' | 'rendering' | 'validating';
    checkpointAt: string;
    error?: string;
    recoveredFrom?: 'rendering' | 'validating';
    renderedDigest?: string;
  };
  /** Artifact identity of the last published source. A later edit makes this stale. */
  renderedArtifactId?: string;
  /** Current published source digest. */
  renderedDigest?: string;
  renderedFileName?: string;
  /** Version-bound, server-recorded complete visual inspection state. */
  visualQaArtifactId?: string;
  visualQaDigest?: string;
  visualQaPageCount?: number;
  visualQaSeenPages?: number[];
  visualQaReviews?: Array<{
    pageNumber: number;
    status: 'failed' | 'passed';
    observation: string;
    checks: OfficeVisualQaPageChecks;
    issues: OfficeVisualQaIssue[];
  }>;
  /** Required cross-page consistency judgment for the exact rendered artifact. */
  visualQaDeckReview?: OfficeVisualQaDeckReview;
  /** Exact rendered screenshot hashes used to safely reuse passed reviews across published outputs. */
  visualQaPageDigests?: Array<{ pageNumber: number; screenshotDigest: string }>;
  visualQaReviewCache?: Array<{
    screenshotDigest: string;
    status: 'failed' | 'passed';
    observation: string;
    checks: OfficeVisualQaPageChecks;
    issues: OfficeVisualQaIssue[];
  }>;
  updatedAt: string;
};
