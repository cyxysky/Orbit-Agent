import { defaultSchema, type Options as Schema } from 'rehype-sanitize';
import type { Root, RootContent } from 'hast';

const svgTags = ['svg', 'g', 'defs', 'title', 'desc', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask'];
const svgAttributes = ['xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'fillOpacity', 'fillRule', 'stroke', 'strokeWidth', 'strokeOpacity', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeDashoffset', 'opacity', 'transform', 'textAnchor', 'dominantBaseline', 'fontFamily', 'fontSize', 'fontWeight', 'dx', 'dy', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'offset', 'stopColor', 'stopOpacity', 'clipPath', 'clipPathUnits', 'mask', 'maskUnits'];

export const browserChatHtmlSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), ...svgTags],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className', /^language-./, 'math-inline', 'math-display']],
    ...Object.fromEntries(svgTags.map(tag => [tag, svgAttributes])),
  },
};

/** Sanitization prefixes IDs; keep local SVG paint/clip references aligned. */
export function rehypeBrowserChatSvgReferences() {
  return (tree: Root) => {
    const markCard = (node: RootContent) => {
      if (node.type !== 'element') return;
      if (node.tagName === 'svg' || node.tagName === 'div') node.properties.className = ['browser-chat-html-card'];
      else if (node.tagName === 'p') node.children.forEach(child => {
        if (child.type === 'element' && child.tagName === 'svg') child.properties.className = ['browser-chat-html-card'];
      });
    };
    tree.children.forEach(markCard);
    const visit = (node: Root | RootContent) => {
      if (node.type === 'element' && node.tagName === 'svg') {
        const bounds = String(node.properties.viewBox || '').trim().split(/[ ,]+/).map(Number);
        const width = bounds.length === 4 ? bounds[2] : Number(node.properties.width);
        const height = bounds.length === 4 ? bounds[3] : Number(node.properties.height);
        const firstShape = node.children.find(child => child.type === 'element' && !['defs', 'title', 'desc'].includes(child.tagName));
        // A full-canvas neutral rect is the document backdrop, not plotted data.
        if (firstShape?.type === 'element' && firstShape.tagName === 'rect') {
          const props = firstShape.properties;
          const fill = String(props.fill || '').toLowerCase();
          const lightNeutral = /^(?:white|#fff|#ffffff|#fafafa|#fafbfc|#f8fafc|#f9fafb|#f5f5f5)$/.test(fill);
          const covers = (value: unknown, expected: number) => value === '100%' || (expected > 0 && Number(value) === expected);
          if (lightNeutral && Number(props.x || 0) === (bounds[0] || 0) && Number(props.y || 0) === (bounds[1] || 0)
            && covers(props.width, width) && covers(props.height, height)) props.fill = 'transparent';
        }
      }
      if ('properties' in node) {
        for (const key of ['fill', 'stroke', 'clipPath', 'mask']) {
          const value = node.properties[key];
          if (typeof value === 'string' && /url\(/i.test(value)) {
            const match = /^url\(['"]?#([\w.-]+)['"]?\)$/.exec(value);
            if (match) node.properties[key] = `url(#user-content-${match[1]})`;
            else delete node.properties[key];
          }
        }
      }
      if ('children' in node) node.children.forEach(visit);
    };
    visit(tree);
  };
}
