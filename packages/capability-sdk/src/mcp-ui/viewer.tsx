import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { ChartRenderer } from '../chart/react.tsx';
import { GoogleMapRenderer } from '../maps/react.tsx';
import { mapsUrl } from '../maps/core.ts';
import './viewer.css';
import { CodedError, ERROR_CODES } from '../errors.ts';


const config = (window as any).__CAPABILITY_UI__ || { mode: 'app' };
const root = createRoot(document.getElementById('root')!);
let current: any;
const app = config.mode === 'app' ? new App({ name: 'Capability visualization', version: '1.0.0' }, {
  availableDisplayModes: ['inline', 'fullscreen', 'pip'],
}) : undefined;
let hostContext: McpUiHostContext = {};
const hostListeners = new Set<() => void>();
const subscribeHost = (listener: () => void) => {
  hostListeners.add(listener);
  return () => { hostListeners.delete(listener); };
};
const getHostContext = () => hostContext;

function hostStyles(ctx?: McpUiHostContext) {
  if (!ctx) return;
  // Notifications contain only changed fields; a theme update must not exit fullscreen.
  const modeChanged = ctx.displayMode !== undefined && ctx.displayMode !== hostContext.displayMode;
  hostContext = { ...hostContext, ...ctx,
    // A previous mode's fixed height cannot constrain the new mode. Hosts that
    // send only displayMode use the iframe viewport until new dimensions arrive.
    ...(modeChanged && !ctx.containerDimensions ? { containerDimensions: undefined } : {}),
  };
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  const dimensions = hostContext.containerDimensions;
  const fixedHeight = dimensions && 'height' in dimensions && dimensions.height > 0;
  // The host can announce its target height before resizing the iframe. Using
  // that height also lets autoResize report the expanded size back to the host.
  if (fixedHeight) document.documentElement.style.setProperty('--capability-host-height', `${dimensions.height}px`);
  else document.documentElement.style.removeProperty('--capability-host-height');
  document.documentElement.dataset.capabilityLayout =
    hostContext.displayMode === 'fullscreen' || hostContext.displayMode === 'pip' || fixedHeight ? 'fill' : 'content';
  hostListeners.forEach(listener => listener());
}

async function changeFullscreen(fullscreen: boolean) {
  if (!app) return;
  const result = await app.requestDisplayMode({ mode: fullscreen ? 'fullscreen' : 'inline' });
  hostStyles({ displayMode: result.mode });
}

async function downloadFile(data: Blob | string, filename: string) {
  if (!app) return;
  const file = typeof data === 'string' ? (() => {
    const match = /^data:([^;,]+);base64,(.*)$/.exec(data);
    if (!match) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, '无法读取导出图片。');
    return new Blob([Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))], {type:match[1]});
  })() : data;
  const encoded = await new Promise<string>((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
  if (!app.getHostCapabilities()?.downloadFile) {
    if (!current.previewUrl || !current.exportToolName) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, '当前宿主不支持下载；请启用浏览器预览后导出。');
    const prepared = await app.callServerTool({name:current.exportToolName,arguments:{
      token:current.token,filename,mimeType:file.type.split(';')[0],base64:encoded,
    }});
    const url = (prepared.structuredContent as any)?.url;
    if (prepared.isError || !url) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, prepared.content?.filter(c=>c.type==='text').map(c=>(c as any).text).join('\n') || '导出失败。');
    const result = await app.openLink({url});
    if (result.isError) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, '宿主未打开下载链接；请在浏览器预览中导出。');
    return;
  }
  const result = await app.downloadFile({contents:[{type:'resource',resource:{
    uri:`file:///${encodeURIComponent(filename)}`,mimeType:file.type || 'application/octet-stream',blob:encoded,
  }}]});
  if (result.isError) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, '下载未完成：宿主取消或拒绝了下载。');
}

async function request(action: 'read' | 'update', input: any = {}) {
  if (app) {
    const result = await app.callServerTool({ name: current.toolName, arguments: {
      reason: action === 'read' ? 'Refresh visualization' : 'Save chart edit',
      ...(current.kind === 'chart' ? {action, chartId: current.id, ...input} : {mapId: current.id}),
    } });
    if (result.isError) throw Object.assign(new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, result.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') || '操作失败'), {
      code: (result.structuredContent as any)?.error?.code,
    });
    const view = result._meta?.['capability/visualization'];
    if (!view) throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, '服务没有返回可视化数据，请重新调用工具。');
    current = view;
    return view;
  }
  const response = await fetch(config.dataUrl, action === 'update'
    ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)} : undefined);
  const value = await response.json();
  if (!response.ok) throw Object.assign(new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, value.error || '读取失败'), {status:response.status});
  current = value; return value;
}

class Boundary extends React.Component<any, {error:string}> {
  state = {error:''};
  static getDerivedStateFromError(error: Error) { return {error:error.message}; }
  render(){return this.state.error ? <div role="alert">无法显示此内容：{this.state.error}</div> : this.props.children;}
}

function MapFallback({view}: {view:any}) {
  const record = view.record;
  const data = view.map?.view || (record.request.action === 'show'
    ? {center:record.request.center,markers:record.request.markers} : {markers:[]});
  const points = data.route?.path || data.markers.map((marker:any) => marker.position);
  const positions = points.length ? points : data.center ? [data.center] : [];
  const lngs = positions.map((p:any)=>p.lng), lats = positions.map((p:any)=>p.lat);
  const minX=Math.min(...lngs), maxX=Math.max(...lngs), minY=Math.min(...lats), maxY=Math.max(...lats);
  const xy=(p:any)=>[maxX===minX?400:80+(p.lng-minX)/(maxX-minX)*640,maxY===minY?200:320-(p.lat-minY)/(maxY-minY)*240];
  return <section className="map-fallback">
    <h2>{record.title || '地图'}</h2>
    {positions.length>0 && <svg viewBox="0 0 800 400" role="img" aria-label="位置示意图，无地图底图">
      <rect width="800" height="400" rx="16" fill="#edf2f7"/>
      {data.route && <polyline points={positions.map((p:any)=>xy(p).join(',')).join(' ')} fill="none" stroke="#4372b9" strokeWidth="4"/>}
      {positions.filter((_:any,i:number)=>!data.route||i===0||i===positions.length-1).map((p:any,i:number)=><g key={i}><circle cx={xy(p)[0]} cy={xy(p)[1]} r="8" fill="#385a8c"/><text x={xy(p)[0]+14} y={xy(p)[1]+4}>{i+1}</text></g>)}
    </svg>}
    <p>未配置交互地图底图；可在 Google Maps 中查看地点和路线。</p>
    <ul>{(data.markers||[]).map((marker:any,i:number)=><li key={i}>{marker.label}（{marker.position.lat}, {marker.position.lng}）</li>)}</ul>
    <a href={mapsUrl(record.request)} target="_blank" rel="noreferrer">在 Google Maps 中打开</a>
  </section>;
}

function Viewer({initial}: {initial:any}) {
  const [view,setView] = useState(initial);
  const host = useSyncExternalStore(subscribeHost, getHostContext);
  return <main className="capability-viewer">
    <Boundary key={view.id}>
      {view.kind === 'chart' ? <ChartRenderer chart={view.record} excalidraw={{assetPath:app ? undefined : view.assetPath,langCode:'zh-CN'}}
        onDownload={app ? downloadFile : undefined}
        fullscreen={app ? host.displayMode === 'fullscreen' : undefined}
        onFullscreenChange={app ? changeFullscreen : undefined}
        onReload={async()=>{const next=await request('read');setView(next);return next.record;}}
        onSave={config.readOnly ? undefined : async(next,expectedRevision)=>{const value=await request('update',{option:next.option,expectedRevision});setView(value);return value.record;}} />
        : view.map?.browserKey ? <GoogleMapRenderer title={view.record.title} load={async()=>view.map}/>
        : <MapFallback view={view}/>}</Boundary>
  </main>;
}

function show(view:any){current=view;root.render(<Viewer key={`${view.id}:${view.record?.revision||0}`} initial={view}/>);(window as any).__CAPABILITY_READY__=true;}
root.render(<p role="status">正在等待图表或地图…</p>);
if (app) {
  app.ontoolresult = result => {const view=result._meta?.['capability/visualization'];if(view)show(view);else if(result.isError)root.render(<p role="alert">工具执行失败，请修正输入后重试。</p>);};
  app.onhostcontextchanged = hostStyles;
  app.onteardown = async () => {root.unmount();return {};};
  app.connect().then(()=>hostStyles(app.getHostContext())).catch(error=>root.render(<p role="alert">无法连接 MCP Apps 宿主：{String(error)}</p>));
} else request('read').then(show).catch(error=>root.render(<p role="alert">{String(error)}</p>));
