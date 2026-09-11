import { mapResponses, mapResponseBlock } from './response.ts';
import { z } from 'zod';
import { defineCapabilityInput, defineCapabilityTool, type CapabilityManifest, type CapabilityProvider, type CapabilityRunContext } from '@webpilot/capability-sdk';
import { mapIdSchema, mapRequestSchema, MapsError, type MapStore } from './core.ts';
import { createGoogleMapsClient, type GoogleMapsOptions } from './google.ts';
import { mapsCapabilitySettings } from './settings.ts';
export * from './core.ts';
export * from './google.ts';
export * from './settings.ts';

const parser = z.object({ reason: z.string().trim().min(1).max(300), title: z.string().trim().min(1).max(200).optional(), request: mapRequestSchema.optional(), mapId: mapIdSchema.optional() }).strict()
  .refine(input => Boolean(input.request) !== Boolean(input.mapId), 'Provide request to search/route/show, or mapId to read the saved request, never both.');
export const mapsToolInput = defineCapabilityInput(z.toJSONSchema(parser), value => parser.parse(value));
export const mapsCapabilityManifest = {
  schemaVersion: 1, id: 'com.webpilot.maps', name: 'Maps', version: '0.1.0',
  description: 'Google Maps place search, basic routes, and interactive maps.',
  permissions: ['network:google-maps', 'artifact:read', 'artifact:write', 'renderer:maps'],
  configuration: { settings: mapsCapabilitySettings },
  responses: mapResponses,
  skills: [{
    id: 'system.maps', title: 'Google Maps Runtime', required: true, activation: [{ toolName: 'maps' }],
    summary: '<system_skill><id>system.maps</id><title>地图</title><description>Google 地点搜索、路线规划和可交互地图。</description><required>true</required></system_skill>',
    content: `# Google Maps
Use maps with request.action search, route or show. Supply reason and an optional concise title.
search: query should include a city/region; limit defaults to 5 (maximum 10). Returns real Google places and a mapId.
route: origin/destination each use exactly one of {placeId}, {address}, {location:{lat,lng}}. Prefer placeId from successful search; ask about ambiguous destinations instead of guessing. travelMode DRIVE, WALK or BICYCLE. This computes a basic route without live traffic, never claim live traffic or turn-by-turn navigation. Walking/cycling coverage varies; include returned warnings.
show: center:{lat,lng}, optional zoom and markers:[{position:{lat,lng},label}]. Only use coordinates supported by user input or tool evidence.
Pass mapId alone (with reason) to read a saved request without external API calls. A record stores the request, not a permanently cached Google response. Opening its interactive card may fetch fresh data and incur another request.
On success copy the exact content[].block with type com.webpilot.maps into finalResponse.blocks. Its params contain mapId and optional title. Never invent IDs, render maps through chart, or invent reviews, ratings, opening hours, routes or distances. Include Google Maps links for external messaging clients.
No automatic retries on errors, missing configuration or quota exhaustion. Do not substitute browser scraping to bypass limits. Keys come from host settings; never ask users to paste keys into a conversation.
Each search is Text Search Pro; each route uses Compute Routes Essentials. Do not fan out into repeated speculative searches.`,
  }],
} as const satisfies CapabilityManifest;

export function createMapsTool(store: MapStore, options: GoogleMapsOptions) {
  const client = createGoogleMapsClient(options);
  return defineCapabilityTool<z.infer<typeof parser>, unknown>({
    name: 'maps', description: 'Search Google places, compute a basic route, or create an interactive map. Supply request or read an existing mapId. Copy the returned response block into finalResponse.blocks to display the map.',
    input: mapsToolInput, policy: { concurrency: 'serial', concurrencyGroup: 'maps', permissions: mapsCapabilityManifest.permissions },
    async execute(input, context) {
      try {
        context.abortSignal?.throwIfAborted();
        if (input.mapId) {
          const record = await store.read(input.mapId);
          return record ? { ok: true, summary: 'Saved map request.', data: record, content: [{ type: 'response', block: mapResponseBlock(record) }] } : { ok: false, error: { code: 'maps-not-found', message: '地图不存在。' } };
        }
        const request = mapRequestSchema.parse(input.request);
        const view = await client.resolve(request, context.abortSignal);
        context.abortSignal?.throwIfAborted();
        const record = await store.create({ title: input.title || (request.action === 'search' ? request.query.slice(0, 200) : request.action === 'route' ? '路线规划' : '地图'), request });
        // Route geometry is used by the renderer, not copied into model history.
        const routeSummary = view.route ? { distanceMeters: view.route.distanceMeters, durationSeconds: view.route.durationSeconds, warnings: view.route.warnings, travelMode: view.route.travelMode } : undefined;
        return { ok: true, summary: request.action === 'search' ? `Google Maps 找到 ${view.places.length} 个地点。` : 'Google 地图已创建。',
          data: { mapId: record.mapId, title: record.title, places: view.places, ...(view.route ? { route: routeSummary } : {}), googleMapsUrl: view.googleMapsUrl },
          content: [{ type: 'response', block: mapResponseBlock(record) }] };
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        return { ok: false, error: { code: error instanceof MapsError ? error.code : 'maps-operation-failed', message: error instanceof MapsError ? error.message : '地图操作失败，请检查输入或存储服务。', retryable: false } };
      }
    },
  });
}
export function createMapsCapability(options: { createStore(context: CapabilityRunContext): MapStore | Promise<MapStore>; createClientOptions(context: CapabilityRunContext): GoogleMapsOptions }): CapabilityProvider {
  return { manifest: mapsCapabilityManifest, async createRuntime(context) {
    const store = await options.createStore(context);
    return { tools: { maps: createMapsTool(store, options.createClientOptions(context)) },
      health: async () => ({ status: context.configuration.GOOGLE_MAPS_SERVER_KEY && context.configuration.GOOGLE_MAPS_BROWSER_KEY ? 'healthy' : 'degraded', message: 'Google Maps requires separate browser and server keys.' }),
      dispose: async () => {},
    };
  } };
}
