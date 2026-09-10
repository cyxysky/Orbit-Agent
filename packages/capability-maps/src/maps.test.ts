import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createMapsTool, mapRequestSchema, MapsError } from './index.ts';
import { createGoogleMapsClient } from './google.ts';
import { createFileSystemMapStore, reserveMapsRequest } from './node.ts';

const directories: string[] = [];
async function temp() { const directory = await mkdtemp(path.join(os.tmpdir(), 'orbit-maps-test-')); directories.push(directory); return directory; }
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const configuration = { GOOGLE_MAPS_SERVER_KEY: 'test-server-key' };
const search = mapRequestSchema.parse({ action: 'search', query: 'Central coffee' });

describe('Google maps request boundaries', () => {
  it('does not call or reserve Google when the key is missing, or when quota is exhausted', async () => {
    const fetchMock = vi.fn(); const reserveRequest = vi.fn();
    await expect(createGoogleMapsClient({ configuration: {}, fetch: fetchMock, reserveRequest }).resolve(search)).rejects.toMatchObject({ code: 'maps-not-configured' });
    expect(reserveRequest).not.toHaveBeenCalled();
    reserveRequest.mockRejectedValue(new MapsError('maps-monthly-limit', 'limit'));
    await expect(createGoogleMapsClient({ configuration, fetch: fetchMock, reserveRequest }).resolve(search)).rejects.toMatchObject({ code: 'maps-monthly-limit' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('makes one Pro search request, returns safe links, and persists only the request', async () => {
    const directory = await temp();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ places: [{ id: 'place-123', displayName: { text: 'Coffee' }, formattedAddress: 'Central', location: { latitude: 22.28, longitude: 114.15 }, googleMapsUri: 'javascript:alert(1)' }] }));
    const tool = createMapsTool(createFileSystemMapStore(directory), { configuration, fetch: fetchMock, reserveRequest: async () => {} });
    const result = await tool.execute(tool.input.parse({ reason: 'find coffee', request: search }), { invocationId: 'one' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Search failed');
    const data = result.data as { mapId: string; places: Array<{ url: string }> };
    expect(data.places[0].url).toMatch(/^https:\/\/www.google.com\/maps/);
    const request = fetchMock.mock.calls[0][1]!;
    expect(new Headers(request.headers).get('X-Goog-FieldMask')).not.toMatch(/rating|openingHours|reviews|\*/);
    const raw = await readFile(path.join(directory, `${data.mapId}.json`), 'utf8');
    expect(raw).not.toContain('test-server-key'); expect(raw).not.toContain('place-123');
    expect(JSON.parse(raw).request.query).toBe(search.action === 'search' ? search.query : '');
    await tool.execute(tool.input.parse({ reason: 'read', mapId: data.mapId }), { invocationId: 'read' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(createFileSystemMapStore(directory).read('../../private')).rejects.toThrow();
  });
  it('uses traffic-unaware basic routes, decodes actual geometry, and rejects malformed input', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ routes: [{ distanceMeters: 500, duration: '120s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] }));
    const route = mapRequestSchema.parse({ action: 'route', origin: { placeId: 'origin' }, destination: { address: 'destination' } });
    const result = await createGoogleMapsClient({ configuration, fetch: fetchMock, reserveRequest: async () => {} }).resolve(route);
    expect(result.route?.path).toEqual([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ routingPreference: 'TRAFFIC_UNAWARE', origin: { placeId: 'origin' }, computeAlternativeRoutes: false });
    expect(() => mapRequestSchema.parse({ ...route, origin: { placeId: 'id', address: 'both' } })).toThrow();
    expect(() => mapRequestSchema.parse({ action: 'show', center: { lat: 200, lng: 0 } })).toThrow();
  });
  it('never retries a failed request or exposes upstream error bodies and keys', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('test-server-key internal diagnostic', { status: 403 }));
    const client = createGoogleMapsClient({ configuration, fetch: fetchMock, reserveRequest: async () => {} });
    await expect(client.resolve(search)).rejects.toMatchObject({ code: 'maps-http-403' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValue(new Error('test-server-key network diagnostic'));
    await expect(client.resolve(search)).rejects.toThrow('不会自动重试');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('respects abort before reserving or making a billable request', async () => {
    const fetchMock = vi.fn(); const reserveRequest = vi.fn(); const controller = new AbortController(); controller.abort();
    await expect(createGoogleMapsClient({ configuration, fetch: fetchMock, reserveRequest }).resolve(search, controller.signal)).rejects.toThrow();
    expect(reserveRequest).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('enforces one durable monthly ceiling under concurrent workers and resets at Pacific month boundary', async () => {
    const directory = await temp(); const now = new Date('2026-09-10T00:00:00Z');
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserveMapsRequest(directory, 'search', 3, undefined, now)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3);
    await expect(reserveMapsRequest(directory, 'search', 3, undefined, now)).rejects.toMatchObject({ code: 'maps-monthly-limit' });
    await expect(reserveMapsRequest(directory, 'search', 3, undefined, new Date('2026-10-01T06:59:59Z'))).rejects.toThrow();
    await expect(reserveMapsRequest(directory, 'search', 3, undefined, new Date('2026-10-01T07:00:00Z'))).resolves.toBeUndefined();
  });
});
