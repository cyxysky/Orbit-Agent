import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Regenerates the offline design artifact only; it does not build the application.
const root=path.dirname(fileURLToPath(import.meta.url));
let html=await readFile(path.join(root,'index.html'),'utf8');
for(const file of ['base.css','settings.css','workspaces.css','overlays.css','refinements.css']){
  const css=await readFile(path.join(root,file),'utf8');
  html=html.replace(`<link rel="stylesheet" href="${file}">`,()=>`<style>${css}</style>`);
}
for(const file of ['shared.js','settings.js','workspaces.js','overlays.js','shell.js']){
  const code=(await readFile(path.join(root,file),'utf8')).replace(/<\/script/gi,'<\\/script');
  html=html.replace(`<script src="${file}"></script>`,()=>`<script>${code}</script>`);
}
html=html.replace('<a class="review-index" href="comparison.html" target="_blank">并排对比</a>','');
await writeFile(path.join(root,'orbit-layouts.html'),html);
console.log('Updated orbit-layouts.html');
