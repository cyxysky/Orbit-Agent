import type { CapabilitySkill } from '@webpilot/capability-sdk';

const pdfGuidance = `# PDF authoring and inspection

Use this reference for PDF layout, pagination and delivery review. Keep the existing file runtime contract and selected engine.

## Content and appearance need different evidence

Use file.readContent with artifactId/attachmentId and contentPages for text, values and citations. Extracted text does not establish reading order, font fidelity, table alignment or whether a label is visible. For appearance, use file.visualIndex and file.visualRead on the actual rendered artifact. A preview of another draft or the source Office file cannot verify the final PDF.

Create PDFs through the existing plan/generate/render or supported convert path. Edit the source draft and render again. Reuse the documentId and current artifact/version. Do not write HTML or plain text with a .pdf suffix, invoke unavailable Python libraries, or invent a converter.

## Design for pages

Identify audience, page size/orientation, content order, typography and recurring header/footer rules. Fit the longest real labels and representative dense tables early. Use fonts with the required language coverage; inspect Chinese characters, symbols and mathematical notation after rendering. Preserve intended punctuation instead of imposing an English-only substitution policy.

Use consistent margins, type hierarchy, paragraph spacing and figure treatment. Keep captions with figures, headings with following content, and repeated table headers legible after page breaks. Avoid stranded headings, empty trailing pages and footer collisions. Charts need readable axes, units, categories and legends; images must retain aspect ratio and useful resolution at final size. Sources and links must be human-readable, without internal tool tokens or unresolved placeholders.

## Review the delivered version

Inspect each required page at readable size through the existing visual QA workflow. Check clipping, overlap, substituted glyphs, broken tables, unexpected blank pages, blurry images, spacing and page-number/section transitions. Compare pages as one document as well as individually. Text extraction can verify a value but cannot replace visual inspection.

Record defects against the exact artifact/version and page. Correct the source, render again and inspect the affected pages plus pages whose flow changed; submit the current version's required visualReport. Successful conversion alone is not a visual pass. If image inspection is unavailable, accurately report the limitation through the existing workflow; never manufacture a passed review. Deliver the final artifact's returned downloadUrl, not an intermediate preview.
`;

/** Valid starter data, disclosed only with the notebook reference. */
const notebookStarter = {
  cells: [
    { cell_type: 'markdown', id: 'purpose', metadata: {}, source: ['# Analysis notebook\n', '\n', 'Describe the question, data source and expected result.\n'] },
    { cell_type: 'code', id: 'setup', metadata: {}, execution_count: null, outputs: [], source: ['from pathlib import Path\n', '\n', '# Add dependencies and inputs required by this task.\n'] },
  ],
  metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } },
  nbformat: 4, nbformat_minor: 5,
};

/** Adapted from openai/skills; see ../THIRD_PARTY_NOTICES.md (Apache-2.0). */
const notebookGuidance = `# Jupyter notebook files

Create or edit .ipynb artifacts through file.write, using valid notebook JSON as content. Saving a notebook does not execute cells. File.readContent can recover an existing notebook for revision. Keep the file runtime's size limit, immutable-artifact behavior and delivery contract.

## Choose the structure from the task

- Experiment/analysis: question or hypothesis, input provenance and setup, baseline, controlled variations, measurements/plots, interpretation and limitations. Keep settings together; distinguish observations from hypotheses and record seeds when randomness affects comparison.
- Tutorial: audience and prerequisites, learning outcome, minimal runnable example, explained steps, an exercise when useful, and recap. Explain what each output means.
- Existing notebook: preserve intent, kernel/language, cell order, IDs, metadata and attachments unless a change is necessary. Inspect before editing; do not recreate a notebook just to change one cell.

## Valid notebook structure

Start from this shape, replace the placeholder prose/setup with the requested content, and add focused Markdown/code cells. Serialize a data structure with JSON.stringify or an equivalent serializer in an available code tool; avoid hand-concatenated JSON escapes. Pass the finished JSON to the separate file tool, never call file as a JavaScript global in browser code.

\`\`\`json
${JSON.stringify(notebookStarter, null, 2)}
\`\`\`

Cells remain ordered. New cells need unique stable IDs of 1-64 letters, digits, hyphens or underscores. Source is a string or an array of strings with the intended newline characters. Code cells require execution_count and outputs. New or modified unexecuted code cells use execution_count: null and outputs: []; never invent execution counts, plots or measurements. Preserve existing outputs only while they correspond to unchanged code and inputs.

## Reproducibility and review

Each code cell should perform one coherent step. Put imports/configuration before use, identify dependencies and input files, and avoid hidden state from an earlier kernel. Use relative paths suitable for the reader; do not embed credentials or machine-specific paths. Summarize large tables/logs while retaining source references.

Check JSON parsing, notebook version, cell types, required fields, unique IDs, source types and ordered dependencies. When execution is requested and an appropriate runtime with actual dependencies/data is available, run from top to bottom in a clean kernel and inspect outputs/charts. Otherwise describe the notebook as generated or structurally checked, not executed. Execution is a separate capability subject to the user's scope.

Deliver the .ipynb through the returned downloadUrl. Notebook JSON does not use Office rendering; the file capability does not supply a Jupyter kernel.
`;

export const fileAuthoringReferenceSkills: readonly CapabilitySkill[] = Object.freeze([
  { id: 'system-file-pdf-authoring', title: 'PDF authoring and visual review',
    description: 'Optional PDF page layout, typography, pagination, content checks and final rendered review.', content: pdfGuidance },
  { id: 'system-file-jupyter-notebook', title: 'Jupyter notebook authoring',
    description: 'Optional .ipynb creation/editing, experiment/tutorial structure, valid starter cells and execution verification.', content: notebookGuidance },
].map(({ description, ...reference }) => Object.freeze({
  ...reference, required: false,
  summary: `<system_skill>\n<id>${reference.id}</id>\n<title>${reference.title}</title>\n<description>${description}</description>\n<required>false</required>\n</system_skill>`,
})));

export const fileAuthoringReferenceRouting = `## Format authoring references (read when relevant)

Use skill action=read with system-file-pdf-authoring for PDF layout/pagination and rendered review, or system-file-jupyter-notebook for .ipynb creation/editing and reproducibility. These optional references use existing file APIs; ordinary text writes and unrelated reads do not require them. Reuse their content while available; do not load every reference for every file task.
`;
