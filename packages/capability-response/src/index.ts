import { z } from 'zod';
import { defineResponseType, defineCapabilityInput, type ResponseBlock } from '@webpilot/capability-sdk';

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
  props: z.record(z.string(), uiValueSchema).optional().describe('Primitive props: title/description; text/tone; columns; label/value/detail; locale/timeZone/dateStyle/timeStyle; items[{label,value}]; href.'),
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
export const coreResponses = [markdownResponse, uiResponse];
