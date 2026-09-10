import { z } from 'zod';
import { readBoundedResponseText, type CapabilityConfiguration } from '@webpilot/capability-sdk';
import { coordinateSchema, decodePolyline, MapsError, mapsUrl, safeGoogleMapsUrl, type MapRequest, type MapView, type MapWaypoint } from './core.ts';

export type GoogleMapsOptions = {
  configuration: CapabilityConfiguration;
  fetch?: typeof fetch;
  reserveRequest: (kind: 'search' | 'route', signal?: AbortSignal) => Promise<void>;
};
const locationSchema = z.object({ latitude: z.number(), longitude: z.number() });
const placesSchema = z.object({ places: z.array(z.object({
  id: z.string(), displayName: z.object({ text: z.string() }), formattedAddress: z.string().optional(), location: locationSchema.optional(), googleMapsUri: z.string().optional(),
  attributions: z.array(z.object({ provider: z.string().optional(), providerUri: z.string().optional() })).optional(),
})).default([]) });
const routesSchema = z.object({ routes: z.array(z.object({ distanceMeters: z.number().nonnegative(), duration: z.string().regex(/^\d+(?:\.\d+)?s$/), polyline: z.object({ encodedPolyline: z.string() }), warnings: z.array(z.string()).optional() })).default([]) });
const waypoint = (point: MapWaypoint) => point.location ? { location: { latLng: { latitude: point.location.lat, longitude: point.location.lng } } } : point.placeId ? { placeId: point.placeId } : { address: point.address };

export function createGoogleMapsClient(options: GoogleMapsOptions) {
  const key = String(options.configuration.GOOGLE_MAPS_SERVER_KEY || '').trim();
  const languageCode = options.configuration.GOOGLE_MAPS_LANGUAGE || 'zh-CN';
  async function request(kind: 'search' | 'route', body: unknown, mask: string, signal?: AbortSignal) {
    if (!key) throw new MapsError('maps-not-configured', '请在设置 → 工具能力 → 地图中配置 Google 地图服务端 Key，并启用 Places API (New) 和 Routes API。请勿重复重试。');
    signal?.throwIfAborted();
    await options.reserveRequest(kind, signal);
    const abortSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]);
    let response: Response;
    try {
      response = await (options.fetch || fetch)(kind === 'search' ? 'https://places.googleapis.com/v1/places:searchText' : 'https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST', redirect: 'error', signal: abortSignal,
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask },
        body: JSON.stringify(body),
      });
    } catch {
      signal?.throwIfAborted();
      throw new MapsError('maps-network-failed', '无法连接 Google Maps API 或请求超时，请检查服务端网络。请求可能已计费，不会自动重试。');
    }
    if (!response.ok) {
      await response.body?.cancel();
      const explanation = response.status === 403 || response.status === 401 ? '请检查 API 是否启用、结算账户、Key 权限和 IP 限制。' : response.status === 429 ? '调用配额或速率已达到限制。' : response.status === 400 ? '地点或路线参数无效，请修正输入。' : '服务暂时不可用。';
      throw new MapsError(`maps-http-${response.status}`, `Google Maps 请求失败（HTTP ${response.status}）。${explanation} 请勿原样重复重试。`);
    }
    try { return JSON.parse(await readBoundedResponseText(response, 2 * 1024 * 1024)); }
    catch { throw new MapsError('maps-invalid-response', 'Google Maps 返回了无效或过大的数据。'); }
  }
  return {
    async resolve(input: MapRequest, signal?: AbortSignal): Promise<MapView> {
      const googleMapsUrl = mapsUrl(input);
      if (input.action === 'show') return { center: input.center, zoom: input.zoom, markers: input.markers, places: [], googleMapsUrl };
      if (input.action === 'search') {
        const data = placesSchema.parse(await request('search', { textQuery: input.query, pageSize: input.limit, languageCode }, 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.attributions', signal));
        const places = data.places.filter(place => place.location).map(place => ({
          placeId: place.id, name: place.displayName.text, address: place.formattedAddress || '',
          position: coordinateSchema.parse({ lat: place.location!.latitude, lng: place.location!.longitude }),
          url: safeGoogleMapsUrl(place.googleMapsUri, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName.text)}&query_place_id=${encodeURIComponent(place.id)}`),
          attributions: (place.attributions || []).map(item => ({ name: item.provider || '', url: item.providerUri })),
        }));
        return { places, markers: places.map(place => ({ position: place.position, label: place.name })), googleMapsUrl };
      }
      const data = routesSchema.parse(await request('route', {
        origin: waypoint(input.origin), destination: waypoint(input.destination), travelMode: input.travelMode,
        ...(input.travelMode === 'DRIVE' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
        computeAlternativeRoutes: false, languageCode, units: 'METRIC', polylineQuality: 'OVERVIEW', polylineEncoding: 'ENCODED_POLYLINE',
      }, 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.warnings', signal));
      const route = data.routes[0];
      if (!route) throw new MapsError('maps-no-route', '未找到可用路线，请检查起终点或选择其他出行方式。');
      const path = decodePolyline(route.polyline.encodedPolyline);
      if (path.length < 2) throw new MapsError('maps-no-route', '返回的路线没有可显示的路径。');
      return { places: [], markers: [{ position: path[0], label: '起点' }, { position: path[path.length - 1], label: '终点' }], googleMapsUrl,
        route: { path, distanceMeters: route.distanceMeters, durationSeconds: Number.parseFloat(route.duration), warnings: route.warnings || [], travelMode: input.travelMode } };
    },
  };
}
