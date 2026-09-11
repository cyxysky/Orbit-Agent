import { z } from 'zod';
import { defineCapabilityInput, defineResponseType, type ResponseBlock } from '@webpilot/capability-sdk';
import { mapIdSchema } from './core.ts';

const params = z.object({ mapId: mapIdSchema, title: z.string().trim().min(1).max(200).optional() }).strict();
export type MapResponseParams = z.infer<typeof params>;
export const mapResponse = defineResponseType({
  type: 'com.webpilot.maps', description: 'Display a saved Google map. Copy the block returned by the successful maps tool.',
  tools: ['maps'],
  params: defineCapabilityInput(z.toJSONSchema(params), value => params.parse(value)),
  examples: [{ mapId: 'map_0123456789abcdef01234567' }],
  resource: value => ({ topic: 'map', id: value.mapId }),
  toText: value => value.title || '交互地图请在网页对话中查看。',
});
export const mapResponses = [mapResponse];
export function mapResponseBlock(record: { mapId: string; title?: string }): ResponseBlock {
  return { type: mapResponse.type, params: { mapId: record.mapId, ...(record.title ? { title: record.title } : {}) } };
}
