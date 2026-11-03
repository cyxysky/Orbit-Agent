import type { CapabilitySkill } from '../index.ts';
export const textEditorRuntimeSkill = Object.freeze({
  id: 'system-text-editor-runtime', title: 'Text Editor', required: true,
  summary: '<system_skill id="system-text-editor-runtime"><title>文本编辑</title><description>独立保存、编辑和导出纯文本、Markdown 与 HTML 文档。</description></system_skill>',
  activation: [{ toolName: 'textEditor' }],
  content: `Use textEditor for independent documents, including notes, prose, Markdown and HTML source.
1. All actions execute without human confirmation. Work within the user's requested scope and preserve unrelated text.
2. create accepts title, format (text/markdown/html) and content; persist the requested text immediately and retain documentId. list returns document metadata. Reuse the same documentId for later work.
3. read returns source text and contentRange. Long documents can be read in pages with offset/limit (up to 8000 UTF-16 characters), following nextOffset. A partial read never authorizes replacing the complete source. edit accepts ordered {oldText,newText} replacements; each oldText must match exactly once. The whole edit batch rolls back on any missing or ambiguous match.
4. write replaces complete content or changes title/format; append adds exact content at the end. Empty content and empty newText are valid. Optional expectedContent prevents overwriting a changed source snapshot. No version counters, chapters, outlines, approval or reviewer calls are required.
5. HTML is source text with a sandboxed rendering preview in the editor. Markdown uses formatted preview. Preserve syntax and formatting unless the user requests changing them. The GUI can perform AI rewrites on a selection or the whole document; you can perform the requested edits directly with this tool.
6. export publishes the current saved source as .txt, .md or .html and returns real artifact links. Deliver returned URLs; do not invent download paths. delete removes only the selected document.`,
} satisfies CapabilitySkill);
