import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readExcalidrawFont } from '../dist/chart/node.js';

const mime = 'text/html;profile=mcp-app';
const uri = 'ui://capability-sdk/visualization.html';
const root = new URL('../runtime/ui/', import.meta.url);
const json = (res, status, data) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data)); };

/** One UI service per mounted MCP host. Access is scoped to returned artifacts. */
export async function createMcpVisualization({ tools, invoke, options = {} }) {
  const visualTools = new Map(Object.entries(tools).flatMap(([name, resolved]) =>
    resolved.capabilityId === 'com.webpilot.chart' ? [[name, 'chart']]
      : resolved.capabilityId === 'com.webpilot.maps' ? [[name, 'maps']] : []));
  if (!visualTools.size || options.enabled === false) return undefined;
  const template = await readFile(new URL('viewer.html', root), 'utf8');
  const views = new Map(); const byArtifact = new Map();
  const serviceKey = randomBytes(24).toString('hex');
  let http; let origin; let starting; let closing = false;

  async function payload(view) {
    const result = await invoke(view.toolName, {reason:'Read visualization',
      ...(view.kind === 'chart' ? {action:'read',chartId:view.id} : {mapId:view.id})});
    if (!result.ok) throw new Error(result.error.message);
    if (view.kind === 'chart') return {...view, record:result.data.chart};
    const record = result.data;
    const map = options.loadMap ? await options.loadMap(record.mapId, record) : undefined;
    return {...view, record, map};
  }
  function page(initial) {
    const encoded = JSON.stringify(initial).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    return template.replace('/*CAPABILITY_BOOTSTRAP*/',`window.__CAPABILITY_UI__=${encoded};`);
  }
  async function start() {
    if (closing) throw new Error('Visualization host is closed.');
    if (starting) return starting;
    starting = (async () => {
      http = createServer((req,res) => void handle(req,res).catch(error=>{
        if (!res.headersSent) json(res,400,{error:error.message}); else res.end();
      }));
      await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(options.port || 0,'127.0.0.1',resolve);});
      origin = `http://127.0.0.1:${http.address().port}`;
      http.unref(); return origin;
    })();
    return starting;
  }
  async function handle(req,res) {
    if (req.headers.host !== new URL(origin).host) return json(res,403,{error:'Invalid preview host'});
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('x-content-type-options','nosniff');
    const url = new URL(req.url, origin);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== serviceKey) return json(res,404,{error:'Preview not found'});
    if (segments[1] === 'fonts' && req.method === 'GET') {
      const bytes = await readExcalidrawFont(segments.slice(1));
      if (!bytes) return json(res,404,{error:'Font not found'});
      res.writeHead(200,{'content-type':'font/woff2','cache-control':'private, max-age=3600'});return res.end(bytes);
    }
    const view = views.get(segments[1]);
    if (!view) return json(res,404,{error:'Preview expired; call chart/maps again'});
    if (segments[2] === 'data' && req.method === 'GET') return json(res,200,await payload(view));
    if (segments[2] === 'data' && req.method === 'POST') {
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return json(res,403,{error:'Invalid preview request origin'});
      if (view.kind !== 'chart' || options.readOnly) return json(res,403,{error:'This preview is read-only'});
      const chunks=[];let bytes=0;for await (const chunk of req){bytes+=chunk.length;if(bytes>5*1024*1024)throw new Error('Chart update is too large');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result=await invoke(view.toolName,{action:'update',reason:'Save user chart edit',chartId:view.id,option:input.option,expectedRevision:input.expectedRevision});
      if(!result.ok)return json(res,result.error.code==='chart-revision-conflict'?409:400,{error:result.error.message});
      return json(res,200,{...view,record:result.data.chart});
    }
    if (segments.length!==2 || req.method!=='GET') return json(res,404,{error:'Preview not found'});
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
      'content-security-policy':"default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com; worker-src blob:; frame-ancestors 'none'; base-uri 'none'"});
    res.end(page({mode:'browser',dataUrl:`${origin}/${serviceKey}/${view.token}/data`,assetPath:`${origin}/${serviceKey}/`,readOnly:options.readOnly===true}));
  }
  if (options.preview !== false) await start();
  return {
    toolMeta(name) { return visualTools.has(name) ? {ui:{resourceUri:uri}} : {}; },
    register(server) {
      server.registerResource('capability-visualization',uri,{mimeType:mime,description:'Interactive charts and maps'},async()=>({contents:[{
        uri,mimeType:mime,text:page({mode:'app',readOnly:options.readOnly===true}),
        _meta:{ui:{prefersBorder:true,csp:{
          resourceDomains:['https://maps.googleapis.com','https://maps.gstatic.com','https://*.googleapis.com','https://*.gstatic.com','https://*.google.com','https://fonts.googleapis.com','https://fonts.gstatic.com',...(origin?[origin]:[])],
          connectDomains:['https://*.googleapis.com','https://*.gstatic.com','https://*.google.com',...(origin?[origin]:[])],
        }}}},]}));
    },
    async decorate(name,result) {
      const kind=visualTools.get(name);const id=kind==='chart'?result.data?.chartId:result.data?.mapId;
      if(!kind||!result.ok||!id)return {};
      const artifactKey=`${name}:${id}`;let view=byArtifact.get(artifactKey);
      if(!view){view={kind,id,toolName:name,token:randomBytes(24).toString('hex')};views.set(view.token,view);byArtifact.set(artifactKey,view);}
      if(views.size>200){const oldest=views.values().next().value;views.delete(oldest.token);byArtifact.delete(`${oldest.toolName}:${oldest.id}`);}
      if(options.preview!==false){await start();view.previewUrl=`${origin}/${serviceKey}/${view.token}`;view.assetPath=`${origin}/${serviceKey}/`;}
      const initial = kind==='chart' && result.data.chart ? {...view,record:result.data.chart} : await payload(view);
      const content=view.previewUrl?[{type:'text',text:`Interactive preview: ${view.previewUrl} (available while this MCP server is running)`}]:[];
      if (options.staticImages!==false && kind==='chart' && (!initial.record.engine || initial.record.engine==='echarts')) {
        try {
          const echarts=await import('echarts');const {default:sharp}=await import('sharp');
          for(const map of initial.record.maps||[])echarts.registerMap(map.name,typeof map.geoJson==='string'?{svg:map.geoJson}:map.geoJson,map.specialAreas);
          const chart=echarts.init(null,undefined,{renderer:'svg',ssr:true,width:960,height:initial.record.height||480});
          try {chart.setOption({...initial.record.option,animation:false});const bytes=await sharp(Buffer.from(chart.renderToSVGString())).png().toBuffer();content.push({type:'image',mimeType:'image/png',data:bytes.toString('base64')});}
          finally{chart.dispose();}
        } catch(error){content.push({type:'text',text:`Static preview unavailable: ${error.message}`});}
      }
      return { _meta:{'capability/visualization':initial},
        content };
    },
    async close(){closing=true;views.clear();byArtifact.clear();if(starting)await starting.catch(()=>{});if(http?.listening){http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}},
  };
}
