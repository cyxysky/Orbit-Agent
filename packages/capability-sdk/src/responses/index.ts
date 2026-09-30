import { z } from 'zod';
import { defineResponseType, defineCapabilityInput, type ResponseBlock } from '../index.ts';

const uiValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(uiValueSchema).max(100),
  z.record(z.string(), uiValueSchema),
]));

export const uiNodeSchema: z.ZodType<UINode> = z.lazy(() => z.object({
  type: z.enum([
    'card',
    'stack',
    'row',
    'grid',
    'text',
    'markdown',
    'heading',
    'badge',
    'time',
    'stat',
    'progress',
    'divider',
    'keyValue',
    'timeline',
    'link',
  ]).describe('Declarative primitive. Compose time cards with card/stack/time; metrics with grid/stat/progress; details with keyValue/timeline.'),
  props: z.record(z.string(), uiValueSchema).optional().describe('Primitive props: title/description; text/tone; columns; label/value/detail; locale/timeZone/dateStyle/timeStyle; items[{label,value}]; link: href and label (text is also accepted for the visible link caption).'),
  children: z.array(z.union([z.string().max(10_000), uiNodeSchema])).max(100).optional(),
}).strict());

export type UINode = {
  type: 'card' | 'stack' | 'row' | 'grid' | 'text' | 'markdown' | 'heading' | 'badge' | 'time' | 'stat' | 'progress' | 'divider' | 'keyValue' | 'timeline' | 'link';
  props?: Record<string, unknown>;
  children?: Array<string | UINode>;
};


export const markdownParams = z.object({ text: z.string().min(1).max(40_000) }).strict();
export const markdownResponse = defineResponseType({
  type: 'core.markdown', description: 'Markdown prose in an ordered response.',
  params: defineCapabilityInput(z.toJSONSchema(markdownParams), value => markdownParams.parse(value)),
  examples: [{ text: 'Here are the results.' }],
  toText: params => params.text,
  mapText: (params, transform) => ({ text: transform(params.text) }),
  partial(value) {
    const result = markdownParams.safeParse(value);
    return result.success ? result.data : undefined;
  },
});
export function markdownBlock(text: string): ResponseBlock { return { type: markdownResponse.type, params: { text } }; }

export const htmlParams = z.object({
  html: z.string().min(1).max(100_000).describe('HTML fragment to render directly, without Markdown fences. Use semantic HTML, inline SVG, links and native details/summary interactions. Scripts, event handlers, forms, embeds and remote assets are unavailable.'),
  css: z.string().max(40_000).optional().describe('Optional CSS scoped to this isolated HTML document. Style tags and inline styles in html are also supported. Keep html, body and the outer content wrapper transparent so the response blends into the conversation; reserve background fills for meaningful inner elements such as cards or diagrams. Use responsive layouts with natural content height, system fonts, inline SVG or data images; no external assets. The conversation owns vertical scrolling: do not use viewport heights (vh/dvh), fixed heights, max-height or overflow:auto/scroll on the page or its outer content wrapper.'),
  title: z.string().min(1).max(200).describe('Short accessible title for this UI block.'),
  text: z.string().min(1).max(20_000).describe('Plain-text equivalent including important facts and download URLs, for history, copying and clients without HTML rendering.'),
}).strict();
export type HTMLResponseParams = z.infer<typeof htmlParams>;
export const htmlResponse = defineResponseType({
  type: 'core.html',
  description: 'Custom HTML/CSS UI rendered in an isolated, auto-sized frame. Prefer this for bespoke visual layouts and polished deliverables. Supply html, optional css, title and a complete plain-text equivalent in text. Use restrained typography, generous whitespace and responsive layouts; avoid wrapping every section in bordered cards. JavaScript, event handlers, forms, remote resources and parent-page access are unavailable. Use real artifact URLs in anchors; never invent download links. Theme variables --foreground, --muted, --panel, --border, --accent and --accent-strong are available.',
  params: defineCapabilityInput(z.toJSONSchema(htmlParams), value => htmlParams.parse(value)),
  examples: [{ title: 'Summary', text: 'Three sections are ready for review.', html: '<section><p class="eyebrow">READY FOR REVIEW</p><h2>Three sections, one clear story.</h2><p>The updated content is ready to explore.</p></section>', css: 'section{padding:24px 0}h2{font-size:24px;font-weight:500;margin:8px 0}.eyebrow{font-size:11px;letter-spacing:.14em;color:var(--muted)}' }],
  toText: params => params.text,
  mapText: (params, transform) => ({ ...params, text: transform(params.text) }),
});

const uiParams = z.object({ tree: uiNodeSchema }).strict();
// Recursive schemas use root-local references; the registry relocates them when composing tool schemas.
export const uiResponse = defineResponseType({
  type: 'core.ui', description: 'Declarative cards and layouts. Compose the registered primitives in tree.',
  params: defineCapabilityInput(z.toJSONSchema(uiParams), value => uiParams.parse(value)),
  toText: params => uiText(params.tree),
  mapText: (params, transform) => ({ tree: mapUI(params.tree, transform) }),
});
function uiText(node: UINode): string {
  const props = node.props || {};
  return [props.title, props.text, props.label, props.value, props.detail,
    ...(node.children || []).map(child => typeof child === 'string' ? child : uiText(child))]
    .filter(value => typeof value === 'string' || typeof value === 'number').join('\n');
}
function mapUI(node: UINode, transform: (text: string) => string): UINode {
  return { ...node, ...(node.type === 'markdown' && typeof node.props?.text === 'string'
    ? { props: { ...node.props, text: transform(node.props.text) } } : {}),
    ...(node.children ? { children: node.children.map(child => typeof child === 'string' ? child : mapUI(child, transform)) } : {}) };
}
export const coreResponses = [markdownResponse, uiResponse, htmlResponse];
