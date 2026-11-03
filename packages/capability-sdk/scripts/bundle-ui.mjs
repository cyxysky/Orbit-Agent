import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Maintainer-only generation. Consumers receive the HTML; no bundler runs on install.
const require = createRequire(process.env.CAPABILITY_UI_BUILD_PACKAGE || import.meta.url);
const { build } = require('esbuild');
const packageRoot = fileURLToPath(new URL('../',import.meta.url));
const result=await build({entryPoints:[path.join(packageRoot,'src/mcp-ui/viewer.tsx')],bundle:true,write:false,
  outdir:path.join(packageRoot,'runtime/ui'),platform:'browser',format:'iife',target:'es2022',minify:true,metafile:true,
  jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
  conditions:['production','browser','import','default'],
  plugins:[{name:'ui-dependencies',setup(builder){
    builder.onResolve({filter:/^@modelcontextprotocol\/ext-apps$/},()=>({path:require.resolve('@modelcontextprotocol/ext-apps')}));
    builder.onLoad({filter:/excalidraw[\\/]dist[\\/]prod[\\/]index\.css$/},async args=>{
      // Assistant falls back to system fonts. Drawing fonts are loaded lazily
      // from EXCALIDRAW_ASSET_PATH, an origin declared in the resource CSP.
      const css=(await readFile(args.path,'utf8')).replace(/@font-face\s*\{[^}]*\}/g,'');
      return {contents:css,loader:'css'};
    });
  }}],loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.png':'dataurl','.svg':'dataurl'},legalComments:'eof'});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script');
// MCP stdio has a 10 MiB message ceiling. Keep the complete offline UI in one
// resource without external script origins or unsafe-eval.
const compressed=gzipSync(js,{level:9}).toString('base64');
const loader=`(async()=>{try{const bytes=Uint8Array.from(atob("${compressed}"),c=>c.charCodeAt(0));const code=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();const script=document.createElement('script');script.textContent=code;document.body.append(script);}catch(error){document.getElementById('root').textContent='无法加载可视化页面：'+error.message;}})();`;
const css=(result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'').replace(/<\/style/gi,'<\\/style');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>图表与地图</title><style>${css}</style></head><body><div id="root"></div><script>/*CAPABILITY_BOOTSTRAP*/</script><script>${loader}</script></body></html>`;
await mkdir(path.join(packageRoot,'runtime/ui'),{recursive:true});await writeFile(path.join(packageRoot,'runtime/ui/viewer.html'),html);
console.log(`Packaged visualization HTML: ${Buffer.byteLength(html)} bytes`);
if(process.env.CAPABILITY_UI_ANALYZE)console.log(Object.values(result.metafile.outputs).flatMap(output=>Object.entries(output.inputs)).sort((a,b)=>b[1].bytesInOutput-a[1].bytesInOutput).slice(0,12));
