import { z } from 'zod';
import { defineCapabilityInput, defineResponseType, type ResponseBlock } from '@webpilot/capability-sdk';

const params = z.object({ chartId: z.string().regex(/^chart_\d{6}$/), title: z.string().trim().min(1).max(200).optional() }).strict();
export type ChartResponseParams = z.infer<typeof params>;
const input = defineCapabilityInput(z.toJSONSchema(params), value => params.parse(value));
function definition(type: string, description: string) {
  return defineResponseType({ type, description, params: input, tools: ['chart'],
    examples: [{ chartId: 'chart_000001' }],
    resource: value => ({ topic: 'chart', id: value.chartId }),
    toText: value => value.title || '交互内容请在网页对话中查看。',
  });
}
export const chartResponse = definition('com.webpilot.chart', 'Display a saved ECharts or Three.js chart. Copy the block returned by the successful chart tool.');
export const canvasResponse = definition('com.webpilot.canvas', 'Display a saved editable Excalidraw canvas. Copy the block returned by the successful chart tool.');
export const chartResponses = [chartResponse, canvasResponse];
export function chartResponseBlock(chart: { chartId: string; engine?: string; title?: string }): ResponseBlock {
  return { type: chart.engine === 'excalidraw' ? canvasResponse.type : chartResponse.type,
    params: { chartId: chart.chartId, ...(chart.title ? { title: chart.title } : {}) } };
}
