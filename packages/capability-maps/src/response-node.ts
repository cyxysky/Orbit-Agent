import { ResponseOperationError, type ResponseHandler, type ResponseServerContext } from '@webpilot/capability-sdk';
import { mapResponse, type MapResponseParams } from './response.ts';
import { MapsError, mapsUrl, type MapRecord } from './core.ts';
import type { GoogleMapPayload } from './react.tsx';

export function createMapResponseHandlers(options: {
  resolve(mapId: string, context: ResponseServerContext): Promise<GoogleMapPayload | undefined>;
  read(mapId: string, context: ResponseServerContext): Promise<MapRecord | undefined>;
}): ResponseHandler<MapResponseParams>[] {
  return [{ definition: mapResponse, operations: {
    read: { async execute(params, input, context) {
      if (input !== undefined) throw new ResponseOperationError('读取内容不接受额外参数。');
      try {
        const payload = await options.resolve(params.mapId, context);
        if (!payload) throw new ResponseOperationError('地图不存在。', 404);
        return payload;
      } catch (error) {
        if (error instanceof MapsError) throw new ResponseOperationError(error.message, error.code === 'maps-monthly-limit' ? 429 : 400);
        throw error;
      }
    } },
  }, async export(params, context) {
    const record = await options.read(params.mapId, context);
    if (!record) throw new ResponseOperationError('地图不存在。', 404);
    return [{ format: 'markdown', body: `[Google Maps](${mapsUrl(record.request)})` }];
  } }];
}
