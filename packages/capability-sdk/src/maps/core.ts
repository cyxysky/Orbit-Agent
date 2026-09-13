import { z } from 'zod';

export const coordinateSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
export const waypointSchema = z.object({
  placeId: z.string().trim().min(1).max(256).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  location: coordinateSchema.optional(),
}).strict().refine(value => [value.placeId, value.address, value.location].filter(Boolean).length === 1, 'Use exactly one of placeId, address, location.');
export const mapRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('search'), query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(10).default(5) }).strict(),
  z.object({ action: z.literal('route'), origin: waypointSchema, destination: waypointSchema, travelMode: z.enum(['DRIVE', 'WALK', 'BICYCLE']).default('DRIVE') }).strict(),
  z.object({ action: z.literal('show'), center: coordinateSchema, zoom: z.number().int().min(1).max(20).default(13), markers: z.array(z.object({ position: coordinateSchema, label: z.string().trim().min(1).max(120) }).strict()).max(30).default([]) }).strict(),
]);
export const mapIdSchema = z.string().regex(/^map_[a-f0-9]{24}$/);
export const mapRecordSchema = z.object({ mapId: mapIdSchema, title: z.string().min(1).max(200), createdAt: z.string(), request: mapRequestSchema }).strict();
export type Coordinate = z.infer<typeof coordinateSchema>;
export type MapRequest = z.infer<typeof mapRequestSchema>;
export type MapRecord = z.infer<typeof mapRecordSchema>;
export type MapWaypoint = z.infer<typeof waypointSchema>;
export type MapPlace = { placeId: string; name: string; address: string; position: Coordinate; url: string; attributions: Array<{ name: string; url?: string }> };
export type MapView = {
  center?: Coordinate; zoom?: number; places: MapPlace[];
  markers: Array<{ position: Coordinate; label: string }>;
  route?: { path: Coordinate[]; distanceMeters: number; durationSeconds: number; warnings: string[]; travelMode: string };
  googleMapsUrl: string;
};
export interface MapStore {
  create(input: Pick<MapRecord, 'title' | 'request'>): Promise<MapRecord>;
  read(mapId: string): Promise<MapRecord | undefined>;
}
export class MapsError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'MapsError'; }
}
export function mapsUrl(request: MapRequest) {
  const params = new URLSearchParams({ api: '1' });
  if (request.action === 'route') {
    const label = (point: MapWaypoint) => point.address || (point.location ? `${point.location.lat},${point.location.lng}` : point.placeId!);
    params.set('origin', label(request.origin)); params.set('destination', label(request.destination));
    if (request.origin.placeId) params.set('origin_place_id', request.origin.placeId);
    if (request.destination.placeId) params.set('destination_place_id', request.destination.placeId);
    params.set('travelmode', { DRIVE: 'driving', WALK: 'walking', BICYCLE: 'bicycling' }[request.travelMode]);
    return `https://www.google.com/maps/dir/?${params}`;
  }
  params.set('query', request.action === 'search' ? request.query : `${request.center.lat},${request.center.lng}`);
  return `https://www.google.com/maps/search/?${params}`;
}
export function safeGoogleMapsUrl(value: unknown, fallback: string) {
  try { const url = new URL(String(value)); if (url.protocol === 'https:' && ['maps.google.com', 'www.google.com', 'maps.app.goo.gl'].includes(url.hostname)) return url.href; } catch { /* use trusted fallback */ }
  return fallback;
}
export function decodePolyline(encoded: string): Coordinate[] {
  if (encoded.length > 200000) throw new MapsError('maps-invalid-response', '路线数据过大。');
  const points: Coordinate[] = []; let offset = 0, lat = 0, lng = 0;
  const next = () => {
    let result = 0, shift = 0, value: number;
    do {
      if (offset >= encoded.length || shift > 30) throw new MapsError('maps-invalid-response', '路线编码无效。');
      value = encoded.charCodeAt(offset++) - 63;
      if (value < 0 || value > 63) throw new MapsError('maps-invalid-response', '路线编码无效。');
      result |= (value & 31) << shift; shift += 5;
    } while (value >= 32);
    return result & 1 ? ~(result >>> 1) : result >>> 1;
  };
  while (offset < encoded.length) { lat += next(); lng += next(); points.push(coordinateSchema.parse({ lat: lat / 1e5, lng: lng / 1e5 })); }
  return points;
}
