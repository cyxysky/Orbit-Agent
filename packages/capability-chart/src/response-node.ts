import { z } from 'zod';
import { ResponseOperationError, type ResponseHandler, type ResponseServerContext } from '@webpilot/capability-sdk';
import { chartResponses, type ChartResponseParams } from './response.ts';
import { chartEngines, ChartRevisionConflict, type ChartRecord, type ChartUpdateInput } from './core.ts';

const updateInput = z.object({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  option: z.record(z.string(), z.unknown()),
  title: z.string().max(200).optional(), description: z.string().max(1000).optional(),
  height: z.number().int().min(240).max(720).optional(),
  engine: z.enum(chartEngines).optional(), renderer: z.enum(['canvas', 'svg']).optional(),
  maps: z.array(z.object({ name: z.string().min(1).max(160), geoJson: z.union([z.record(z.string(), z.unknown()), z.string().min(1)]), specialAreas: z.record(z.string(), z.unknown()).optional() }).strict()).max(12).optional(),
}).strict();

export function createChartResponseHandlers(options: {
  read(chartId: string, context: ResponseServerContext): Promise<ChartRecord | undefined>;
  update(chartId: string, update: ChartUpdateInput, expectedRevision: number, context: ResponseServerContext): Promise<ChartRecord | undefined>;
  exportImage?(chartId: string, context: ResponseServerContext): Promise<string | undefined>;
}): ResponseHandler<ChartResponseParams>[] {
  return chartResponses.map(definition => ({
    definition,
    operations: {
      read: { async execute(params, input, context) {
        if (input !== undefined) throw new ResponseOperationError('读取内容不接受额外参数。');
        const chart = await options.read(params.chartId, context);
        if (!chart) throw new ResponseOperationError('图表不存在。', 404);
        return chart;
      } },
      update: { mutates: true, async execute(params, value, context) {
        const parsed = updateInput.safeParse(value);
        if (!parsed.success) throw new ResponseOperationError('图表更新参数无效。');
        const { expectedRevision, ...update } = parsed.data;
        try {
          const chart = await options.update(params.chartId, update, expectedRevision, context);
          if (!chart) throw new ResponseOperationError('图表不存在。', 404);
          return chart;
        } catch (error) {
          if (error instanceof ChartRevisionConflict) throw new ResponseOperationError(error.message, 409);
          if (error instanceof ResponseOperationError) throw error;
          if (error instanceof Error && !('code' in error) && !error.message.startsWith('Unable to read chart')) throw new ResponseOperationError(error.message);
          throw error;
        }
      } },
    },
    async export(params, context) {
      const image = await options.exportImage?.(params.chartId, context);
      return image ? [{ format: 'image', artifactId: image }] : [{ format: 'markdown', body: definition.toText(params) }];
    },
  }));
}
