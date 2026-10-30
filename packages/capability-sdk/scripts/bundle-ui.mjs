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
    builder.onLoad({filter:/excalidraw[\\/]dist[\\/]prod[\\/].*\.js$/},async args=>{
      let code=await readFile(args.path,'utf8');
      const paths=[...new Set([...code.matchAll(/"(\.\/fonts\/(?:Excalifont|Virgil|Cascadia|ComicShanns)\/[^"\n]+\.woff2)"/g)].map(m=>m[1]))];
      for(const font of paths){const bytes=await readFile(path.resolve(path.dirname(args.path),font));code=code.split(JSON.stringify(font)).join(JSON.stringify(`data:font/woff2;base64,${bytes.toString('base64')}`));}
      return {contents:code,loader:'js'};
    });
  }}],loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.png':'dataurl','.svg':'dataurl'},legalComments:'eof'});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script');
// MCP stdio has a 10 MiB message ceiling. Keep the complete offline UI in one
// resource without external script origins or unsafe-eval.
const compressed=gzipSync(js,{level:9}).toString('base64');
const loader=`(async()=>{try{const bytes=Uint8Array.from(atob("${compressed}"),c=>c.charCodeAt(0));const code=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();const script=document.createElement('script');script.textContent=code;document.body.append(script);}catch(error){document.getElementById('root').textContent='无法加载可视化页面：'+error.message;}})();`;
const css=(result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'').replace(/<\/style/gi,'<\\/style');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>图表与地图</title><style>body{margin:0;background:var(--color-background-primary,#f8fafc);color:var(--color-text-primary,#182435);font:14px system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:16px}nav{display:flex;align-items:center;gap:10px;margin-bottom:14px}nav span{flex:1}button{cursor:pointer;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#20324a;padding:7px 12px}footer{padding:12px;color:#667085;font-size:12px}[role=alert]{color:#b42318;padding:12px}.map-fallback{background:#fff;border:1px solid #dbe2ea;border-radius:16px;padding:24px}.map-fallback svg{width:100%;max-height:450px}a{color:#315d9c}${css}</style></head><body><div id="root"></div><script>/*CAPABILITY_BOOTSTRAP*/</script><script>${loader}</script></body></html>`;
await mkdir(path.join(packageRoot,'runtime/ui'),{recursive:true});await writeFile(path.join(packageRoot,'runtime/ui/viewer.html'),html);
console.log(`Packaged visualization HTML: ${Buffer.byteLength(html)} bytes`);
if(process.env.CAPABILITY_UI_ANALYZE)console.log(Object.values(result.metafile.outputs).flatMap(output=>Object.entries(output.inputs)).sort((a,b)=>b[1].bytesInOutput-a[1].bytesInOutput).slice(0,12));
