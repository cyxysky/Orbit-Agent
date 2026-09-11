'use client';

import { lazy, useCallback } from 'react';
import { defineResponseRenderer, type ResponseComponentProps } from '@webpilot/capability-response/react';
import { mapResponse, type MapResponseParams } from './response.ts';
import type { GoogleMapPayload } from './react.tsx';

const MapView = lazy(() => import('./react.tsx').then(module => ({ default: module.GoogleMapRenderer })));
function MapResponseView({ params, context }: ResponseComponentProps<MapResponseParams>) {
  const load = useCallback((signal: AbortSignal) => context.request<GoogleMapPayload>(
    { type: mapResponse.type, params: { mapId: params.mapId } }, 'read', undefined, signal), [context, params.mapId]);
  return <MapView title={params.title} load={load} />;
}
export const mapResponseRenderers = [defineResponseRenderer({ definition: mapResponse, component: MapResponseView })];
