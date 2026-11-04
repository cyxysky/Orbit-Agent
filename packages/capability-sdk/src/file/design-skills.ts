import type { CapabilitySkill } from '../index.ts';

const shared = {
  id: 'system-file-design-craft', title: 'Document design craft',
  content: `# Document design craft
Adapted from Impeccable (Operate/Read and craft-floor), design, and design-system. Apply to the requested artifact, not the host application's appearance. Tool schemas and native document APIs remain authoritative.

1. Establish audience, purpose, reading setting, and the user's actual reference. Preserve supplied content, branding and source data. Do not invent facts or impose a generic house palette.
2. Choose a concrete composition before authoring: hierarchy, typography, imagery, spacing and data expression. Quality adjectives and a new color scheme are not a design direction. For substantial bespoke work, compare 2–3 concise directions and select one; do not generate several complete documents.
3. Define a small shared token set: background/text/accent roles, font family and sizes, spacing steps, margins and repeated component styles. Use it across the artifact, with appropriate variations by page purpose. Consistent design does not require identical page layouts.
4. Build hierarchy through meaningful grouping, alignment, whitespace and typography. Avoid a repeated title/subtitle/rule/equal-card shell, tiny text, gratuitous rounded boxes, decorative gradients and icons used as filler. Strong references take precedence over these defaults.
5. Use relevant real imagery when it supports the message. Use native tables, diagrams and editable charts for actual evidence; retain honest axes, labels, units and sources. Never fabricate scores, measurements or citations to populate a layout.
6. Make every page readable: comfortable type, sufficient contrast (4.5:1 for normal text), stable margins, no overlap, cropped content or orphaned headings. Group related information closely and separate distinct sections visibly.
7. Render and inspect the actual output at its intended reading size, including the densest page. Then inspect the full ordered artifact for visual rhythm and consistency. Repair the existing draft. Reading source or a successful render is not visual inspection; follow the current file visualRead/visualReport contract.
`,
};

const formats = {
  presentation: {
    id: 'system-file-design-presentation', title: 'Presentation composition',
    content: `# Presentation composition
Adapted from the slides, design and design-system skills. These are composition principles; create the user's requested native PPTX/PDF using the file capability's selected engine, not an HTML substitute.

- Start from the audience's decision and an evidence-led narrative. A substantive slide communicates one main claim, its evidence and the implication. Write a useful conclusion as the heading when the evidence supports it.
- Compose cover, section, comparison, evidence and conclusion pages according to their different purposes. Use a dominant chart/image, a comparison, an annotated process or a typographic statement where appropriate. Vary the composition when the content changes; keep comparable pages deliberately comparable.
- Fix a grid, safe margins, alignment lines and a restrained type scale. For a normal projected deck, start around 28–32 pt for body text and 36–48 pt for main headings, then verify at the intended display size. Shorten copy before shrinking type. Avoid dense paragraphs, clipped labels and forced word breaks.
- Use a coherent palette with semantic roles and selective emphasis. A lime accent, black card or rounded rectangle is not a substitute for hierarchy. Match any supplied reference and brand instead of restyling by default.
- Prefer editable native charts and diagrams. Show the real unit, period and source; emphasize the evidence that supports the claim. Keep chart labels legible and avoid redundant legends, dense point labels and misleading scales.
- Use intentional image crops and consistent visual treatment. Keep photos/illustrations meaningful. Do not use arbitrary shapes, emoji or stock symbols merely to fill empty space.
- Inspect opening, densest evidence and conclusion compositions early, then review every slide and the full deck. Verify heading/body hierarchy, margins, alignment, page-to-page rhythm, data semantics and image quality before delivery.
`,
  },
  word: {
    id: 'system-file-design-word', title: 'Document reading and layout',
    content: `# Document reading and layout
Apply Impeccable Read-mode hierarchy and design-system consistency to native document authoring.

- Organize the document around the reader's questions, with real heading levels and a concise opening. Use paragraph, list and table styles instead of positioning every text item as an independent shape.
- Use a restrained typography scale, readable body measure (roughly 65–75 characters where suitable), comfortable line spacing, consistent margins and more space before headings than after them. Preserve requested reference formatting.
- Use columns, callouts and illustrations when the content benefits; avoid repeated bordered cards and ornamental rules. Keep explanatory text, figures, captions and sources together.
- Make tables readable, repeat header rows across pages, align numeric columns, show units and avoid narrow columns that split words. Keep page numbering and headers/footers quiet.
- Inspect actual pagination, widows/orphans, heading breaks, figure anchors, tables and the first/last page. Correct content flow and spacing rather than shrinking the whole document.
`,
  },
  spreadsheet: {
    id: 'system-file-design-spreadsheet', title: 'Spreadsheet information design',
    content: `# Spreadsheet information design
Apply design-system tokens and Operate-mode precision to an editable spreadsheet.

- Give the workbook a clear reading order: purpose, inputs, calculations and results. Use meaningful sheet names, consistent headings and an explicit distinction between editable inputs, formulas and totals.
- Use a restrained palette, one readable font, consistent row/column spacing, number/date formats and units. Align numbers for comparison. Avoid merging data regions or using decorative borders around every cell.
- Keep data tabular with filters/frozen headers where useful. Calculate derived values from one source dataset; do not independently retype totals or present assumptions as facts.
- Match charts to the comparison, label real units and periods, and retain honest axes. Highlight actionable values selectively, with labels in addition to color.
- Inspect both screen readability and any requested printed/exported pages: column widths, clipped values, page breaks, chart labels and repeated headers. Preserve editability and formulas.
`,
  },
} as const;

export const fileDesignSkills: readonly CapabilitySkill[] = Object.freeze([shared, ...Object.values(formats)].map(skill => Object.freeze({ ...skill, summary: '', required: false })));

export function officeDesignSkillReferences(type: keyof typeof formats) {
  return [shared, formats[type]].map(skill => ({ skillId: skill.id, title: skill.title }));
}
