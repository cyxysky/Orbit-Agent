import { getErrorCode } from "../../../errors.ts";
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { inspectPdfDocument } from '../pdf.ts';
import type { OfficeArtifactIssue } from './validation.ts';
import { ERROR_CODES } from '../../../errors.ts';


export type OfficeRendererResult = {
  available: boolean;
  outputPath?: string;
  renderer: 'libreoffice';
  status: 'failed' | 'passed' | 'unavailable';
  summary?: { pages: number; textCharacters: number };
  warning?: string;
};

async function pdfSummary(pdfPath: string) {
  return inspectPdfDocument(await readFile(pdfPath));
}

/** Validate the PDF produced by the same LibreOffice runtime used by UNO. */
export async function validateOfficeRendererMatrix(input: {
  libreOfficePdfPath?: string;
}) {
  const issues: OfficeArtifactIssue[] = [];
  const libreOffice: OfficeRendererResult = {
    available: Boolean(input.libreOfficePdfPath),
    outputPath: input.libreOfficePdfPath,
    renderer: 'libreoffice',
    status: input.libreOfficePdfPath ? 'passed' : 'unavailable',
  };
  if (input.libreOfficePdfPath) {
    try {
      await access(input.libreOfficePdfPath, constants.R_OK);
      libreOffice.summary = await pdfSummary(input.libreOfficePdfPath);
    } catch (error) {
      libreOffice.status = 'failed';
      issues.push({ code: getErrorCode(error, ERROR_CODES.LIBREOFFICE_RENDER_FAILED), message: `LibreOffice PDF verification failed: ${error instanceof Error ? error.message : String(error)}`, severity: 'error' });
    }
  } else {
    issues.push({ code: ERROR_CODES.LIBREOFFICE_RENDERER_UNAVAILABLE, message: 'LibreOffice did not provide a PDF renderer result.', severity: 'error' });
  }

  return {
    issues,
    passed: !issues.some((issue) => issue.severity === 'error'),
    policy: 'libreoffice-only' as const,
    renderers: { libreOffice },
  };
}
