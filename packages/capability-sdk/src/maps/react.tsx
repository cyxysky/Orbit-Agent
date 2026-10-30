'use client';

import { useEffect, useRef, useState } from 'react';
import type { Coordinate, MapRecord, MapView } from './core.ts';

type GoogleMap = { fitBounds(bounds: unknown, padding?: number): void; setCenter(point: Coordinate): void; setZoom(zoom: number): void };
type Overlay = { setMap(map: GoogleMap | null): void };
type GoogleMapsApi = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => Overlay;
  Polyline: new (options: Record<string, unknown>) => Overlay;
  LatLngBounds: new () => { extend(point: Coordinate): void };
  event: { clearInstanceListeners(instance: unknown): void };
};
type MapsWindow = Window & { google?: { maps: GoogleMapsApi }; __orbitGoogleMapsReady?: () => void; gm_authFailure?: () => void };
let scriptLoad: { key: string; language: string; promise: Promise<GoogleMapsApi> } | undefined;
const authListeners = new Set<() => void>();
function loadGoogleMaps(key: string, language: string) {
  const target = window as MapsWindow;
  if (scriptLoad) {
    if (scriptLoad.key !== key || scriptLoad.language !== language) return Promise.reject(new Error('地图配置已变更，请刷新页面后重新打开。'));
    return scriptLoad.promise;
  }
  if (target.google?.maps?.Map) return Promise.resolve(target.google.maps);
  const promise = new Promise<GoogleMapsApi>((resolve, reject) => {
    const script = document.createElement('script');
    const previousAuthFailure = target.gm_authFailure;
    const fail = (message: string) => { clearTimeout(timer); script.remove(); delete target.__orbitGoogleMapsReady; scriptLoad = undefined; reject(new Error(message)); };
    const timer = setTimeout(() => fail('Google 地图加载超时，请检查浏览器网络后手动重试。'), 20000);
    target.gm_authFailure = () => { previousAuthFailure?.(); authListeners.forEach(listener => listener()); fail('Google 地图授权失败，请检查浏览器 Key、来源限制和结算配置。'); };
    target.__orbitGoogleMapsReady = () => {
      clearTimeout(timer); delete target.__orbitGoogleMapsReady;
      if (target.google?.maps) resolve(target.google.maps);
      else fail('Google 地图初始化失败。');
    };
    script.async = true;
    script.onerror = () => fail('无法加载 Google 地图，请检查浏览器网络。');
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, language, v: 'quarterly', loading: 'async', callback: '__orbitGoogleMapsReady' })}`;
    document.head.append(script);
  });
  scriptLoad = { key, language, promise };
  return promise;
}

export type GoogleMapPayload = { record: MapRecord; view: MapView; browserKey: string; language: string };
function MapIcon({ external = false }: { external?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {external ? <><path d="M14 3h7v7M21 3 10 14" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></> : <><path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3ZM9 3v15M15 6v15" /></>}
  </svg>;
}
function safeAttributionUrl(value?: string) {
  try { const url = new URL(value || ''); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined; } catch { return undefined; }
}

/** The package response adapter binds this view to a host-provided resource loader. */
export function GoogleMapRenderer({ title = 'Google 地图', load, className = '' }: {
  title?: string; load: (signal: AbortSignal) => Promise<GoogleMapPayload>; className?: string;
}) {
  const [payload, setPayload] = useState<GoogleMapPayload>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function open() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try {
      const next = await load(controller.signal);
      if (!controller.signal.aborted) setPayload(next);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '无法加载地图。'); }
    finally { if (!controller.signal.aborted) setLoading(false); if (request.current === controller) request.current = null; }
  }
  useEffect(() => {
    if (!payload || !canvas.current) return;
    let disposed = false;
    const overlays: Overlay[] = [];
    const container = canvas.current;
    const authFailure = () => { if (!disposed) { setReady(false); setError('Google 地图授权失败，请检查浏览器 Key、网站来源限制与结算配置。'); } };
    authListeners.add(authFailure);
    let api: GoogleMapsApi | undefined;
    loadGoogleMaps(payload.browserKey, payload.language).then(maps => {
      if (disposed) return;
      api = maps;
      const { view } = payload;
      const map = new maps.Map(container, {
        center: view.center || view.markers[0]?.position || { lat: 22.3193, lng: 114.1694 }, zoom: view.zoom || 13,
        gestureHandling: 'cooperative', mapTypeControl: true, fullscreenControl: true, streetViewControl: false,
      });
      mapRef.current = map;
      for (const [index, marker] of view.markers.entries()) overlays.push(new maps.Marker({ map, position: marker.position, title: marker.label, label: String(index + 1) }));
      if (view.route) overlays.push(new maps.Polyline({ map, path: view.route.path, strokeColor: '#46664d', strokeWeight: 5, strokeOpacity: 0.95 }));
      const points = view.route?.path || view.markers.map(marker => marker.position);
      if (points.length > 1) { const bounds = new maps.LatLngBounds(); points.forEach(point => bounds.extend(point)); map.fitBounds(bounds, 48); }
      else if (points.length === 1) map.setCenter(points[0]);
      setReady(true);
    }).catch(failure => { if (!disposed) setError(failure instanceof Error ? failure.message : '地图初始化失败。'); });
    return () => {
      disposed = true; authListeners.delete(authFailure);
      for (const overlay of overlays) { api?.event.clearInstanceListeners(overlay); overlay.setMap(null); }
      if (mapRef.current) api?.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null; container.replaceChildren();
    };
  }, [payload]);
  const view = payload?.view;
  const attributions = [...new Map((view?.places || []).flatMap(place => place.attributions).map(item => [`${item.name}:${item.url}`, item])).values()];
  return <figure className={`capability-google-map ${className}`}>
    <style>{mapStyles}</style>
    <header className="capability-google-map-header">
      <span className="capability-google-map-emblem"><MapIcon /></span>
      <div><strong>{payload?.record.title || title}</strong><small>Google Maps</small></div>
      {view && <a className="capability-google-map-external" href={view.googleMapsUrl} target="_blank" rel="noopener noreferrer" title="在 Google 地图中打开" aria-label="在 Google 地图中打开"><MapIcon external /></a>}
    </header>
    {!payload && <div className="capability-google-map-placeholder">
      <MapIcon /><p>查看地点与路线</p><span>点击后加载交互地图</span>
      <button type="button" onClick={open} disabled={loading}>{loading ? '正在加载…' : error ? '重新加载' : '打开地图'}</button>
    </div>}
    {payload && <div className="capability-google-map-body">
      <div className="capability-google-map-canvas" ref={canvas} aria-label={payload.record.title} />
      {!ready && !error && <p className="capability-google-map-loading" role="status">正在加载 Google 地图…</p>}
      {view?.route && <div className="capability-google-map-route"><strong>{(view.route.distanceMeters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km</strong><span>约 {Math.max(1, Math.round(view.route.durationSeconds / 60))} 分钟</span><small>未计实时路况</small></div>}
      {!!view?.places.length && <ol className="capability-google-map-places">{view.places.map((place, index) => <li key={place.placeId}>
        <button type="button" onClick={() => { mapRef.current?.setCenter(place.position); mapRef.current?.setZoom(16); }}><span>{index + 1}</span><div><strong>{place.name}</strong><small>{place.address}</small></div></button>
        <a href={place.url} target="_blank" rel="noopener noreferrer" title={`在 Google 地图中查看 ${place.name}`} aria-label={`在 Google 地图中查看 ${place.name}`}><MapIcon external /></a>
      </li>)}</ol>}
      {payload.record.request.action === 'search' && !view?.places.length && <p className="capability-google-map-note">没有找到匹配地点，请在对话中补充城市或更具体的地址。</p>}
      {view?.route && view.route.travelMode !== 'DRIVE' && <p className="capability-google-map-note">步行和骑行路线仍处于测试阶段，可能缺少人行道或骑行道路；请留意实际道路状况。</p>}
      {view?.route?.warnings.map((warning, index) => <p className="capability-google-map-note" key={index}>{warning}</p>)}
      {!!attributions.length && <div className="capability-google-map-note">{attributions.map((item, index) => <span key={index}>{safeAttributionUrl(item.url) ? <a href={safeAttributionUrl(item.url)} target="_blank" rel="noopener noreferrer">{item.name}</a> : item.name}{' '}</span>)}</div>}
    </div>}
    {error && <p className="capability-google-map-error" role="alert">{error}{payload ? ' 修正配置后刷新页面。' : ''}</p>}
  </figure>;
}
const mapStyles = `
.capability-google-map{margin:16px 0;overflow:hidden;border:1px solid var(--border,#dedfd1);border-radius:18px;background:var(--surface,#fffefa);color:var(--foreground,#30392f);box-shadow:0 2px 8px #28382605;font-family:inherit}
.capability-google-map *{box-sizing:border-box}.capability-google-map-header{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border,#dedfd1)}
.capability-google-map-emblem{display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--border,#dedfd1);border-radius:11px;color:#46664d;flex-shrink:0}.capability-google-map-header>div{min-width:0;flex:1}.capability-google-map-header strong{display:block;font-size:15px;line-height:1.5;overflow-wrap:anywhere}.capability-google-map-header small{display:block;font-size:11px;opacity:.6;margin-top:2px}
.capability-google-map a{color:inherit}.capability-google-map-external,.capability-google-map-places li>a{display:grid;place-items:center;width:34px;height:34px;border-radius:8px;background:transparent;flex-shrink:0}.capability-google-map-external:hover,.capability-google-map-places button:hover{background:#7186690a}
.capability-google-map-placeholder{min-height:220px;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:24px;gap:10px}.capability-google-map-placeholder>svg{width:30px;height:30px;color:#718669}.capability-google-map-placeholder p{margin:0;font-weight:600}.capability-google-map-placeholder>span{font-size:13px;opacity:.65}.capability-google-map-placeholder button{font:inherit;font-size:13px;border:1px solid var(--border,#dedfd1);color:inherit;background:transparent;border-radius:9px;padding:8px 18px;margin-top:4px;cursor:pointer}.capability-google-map-placeholder button:disabled{opacity:.6;cursor:wait}
.capability-google-map-canvas{height:420px;width:100%;background:#f5f5f0}.capability-google-map-route{display:flex;gap:16px;align-items:baseline;padding:16px 18px;border-top:1px solid var(--border,#dedfd1);flex-wrap:wrap}.capability-google-map-route strong{font-size:20px}.capability-google-map-route small{opacity:.6;margin-left:auto}
.capability-google-map-places{list-style:none!important;margin:0!important;padding:0 16px!important;max-height:260px;overflow:auto}.capability-google-map-places li{display:flex;align-items:center;gap:8px;border-top:1px solid var(--border,#dedfd1);padding:4px 0;margin:0!important}.capability-google-map-places button{display:flex;align-items:center;gap:12px;flex:1;min-width:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit;padding:10px 0;cursor:pointer}.capability-google-map-places button>span{font-size:12px;width:26px;height:26px;border:1px solid var(--border,#dedfd1);border-radius:50%;display:grid;place-items:center;flex-shrink:0}.capability-google-map-places strong{font-size:14px;display:block}.capability-google-map-places small{font-size:12px;opacity:.65;display:block;overflow-wrap:anywhere;margin-top:4px}.capability-google-map-note,.capability-google-map-error,.capability-google-map-loading{font-size:12px;line-height:1.7;margin:0;padding:12px 18px}.capability-google-map-error{color:#a33628;border-top:1px solid var(--border,#dedfd1)}
@media(max-width:520px){.capability-google-map-header{padding:12px;gap:10px}.capability-google-map-canvas{height:340px}.capability-google-map-route{padding:12px;gap:10px}.capability-google-map-places{padding:0 12px!important}}
`;
