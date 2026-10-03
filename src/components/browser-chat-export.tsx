import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { DeclarativeResponseView, createHTMLResponseDocument, HTML_FRAME_SANDBOX } from '@cjfclonedeep/capability-sdk/responses/react';
import { htmlParams, type UINode } from '@cjfclonedeep/capability-sdk/responses';
import type { ChartRecord } from '@cjfclonedeep/capability-sdk/chart';
import type { GoogleMapPayload } from '@cjfclonedeep/capability-sdk/maps/react';
import type { BrowserChatSessionSnapshot } from '@/server/ai/agents/browser-chat.service';
import type { StepExecutionResult } from '@/server/ai/schemas/runtime.schema';
import type { BrowserChatFinalBlock } from '@/lib/browser-chat-ui-message';
import { browserChatExecutionParts } from '@/lib/browser-chat-ui-message';
import { browserChatArtifactOpenUrl, browserChatArtifactsFromSteps, mergeBrowserChatArtifactSummaries, resolveBrowserChatArtifactReference, type BrowserChatArtifactSummary } from '@/lib/browser-chat-artifacts';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { browserChatOrderedResponseParts, normalizeBrowserChatMarkdown, remarkBrowserChatCjkStrong, remarkBrowserChatArtifactLinks } from './browser-chat-markdown';
import { browserChatHtmlSchema, rehypeBrowserChatSvgReferences } from './browser-chat-html';
import { createResponseContext } from './response-context';

export type BrowserChatExportSnapshot = Pick<BrowserChatSessionSnapshot, 'id' | 'title' | 'messages' | 'steps' | 'subagents'> & { exportedAt: string };
type Asset = { id: string; name: string; mime: string; data: string; bytes: number };
const maxAssetBytes = 256 * 1024 * 1024;
export const escapeExportHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export const exportJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const safeName = (value: string) => value.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').slice(0, 160) || 'conversation';

function blobData(blob: Blob, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    signal.throwIfAborted();
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取导出资源。'));
    reader.onloadend = () => signal.removeEventListener('abort', abort);
    reader.readAsDataURL(blob);
  });
}

class ExportAssets {
  readonly assets = new Map<string, Asset>();
  readonly urls = new Map<string, Asset>();
  private bytes = 0;
  constructor(readonly signal: AbortSignal) {}
  key(value: string) {
    const url = new URL(value, window.location.href);
    if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) throw new Error('资源地址无效。');
    if (url.pathname.includes('/api/artifacts/')) url.searchParams.delete('download');
    url.hash = '';
    return url.href;
  }
  async add(blob: Blob, name: string): Promise<Asset> {
    this.signal.throwIfAborted();
    if (this.bytes + blob.size > maxAssetBytes) throw new Error('附件总大小超过单个 HTML 导出的 256 MB 上限。');
    this.bytes += blob.size;
    const asset = { id: `asset-${this.assets.size + 1}`, name: safeName(name), mime: blob.type || 'application/octet-stream', data: await blobData(blob, this.signal), bytes: blob.size };
    this.assets.set(asset.id, asset);
    return asset;
  }
  async read(value: string, name?: string) {
    const key = this.key(value);
    const cached = this.urls.get(key);
    if (cached) return cached;
    const url = new URL(key);
    const label = name || (['data:', 'blob:'].includes(url.protocol) ? 'image' : decodeURIComponent(url.pathname.split('/').at(-1) || 'file'));
    try {
      const response = await fetch(key, { signal: AbortSignal.any([this.signal, AbortSignal.timeout(60_000)]), credentials: url.origin === window.location.origin ? 'same-origin' : 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (this.bytes + Number(response.headers.get('content-length') || 0) > maxAssetBytes) throw new Error('资源过大，超出 256 MB 导出上限');
      const asset = await this.add(await response.blob(), label);
      this.urls.set(key, asset);
      return asset;
    } catch (error) {
      this.signal.throwIfAborted();
      throw new Error(`无法内嵌“${label}”：${error instanceof Error ? error.message : String(error)}。未生成不完整的导出文件。`);
    }
  }
  link(asset: Asset, label = asset.name) {
    return `<a href="#${asset.id}" data-export-asset="${asset.id}" download="${escapeExportHtml(asset.name)}">${escapeExportHtml(label)}</a>`;
  }
  async inline(root: ParentNode) {
    for (const element of root.querySelectorAll<HTMLElement>('img,video,audio,source')) {
      for (const name of ['src', 'poster']) {
        const value = element.getAttribute(name);
        if (!value) continue;
        const asset = await this.read(value);
        if (element.tagName === 'IMG' && !asset.mime.startsWith('image/')) throw new Error(`图片 ${asset.name} 返回了非图片内容。`);
        element.setAttribute(name, asset.data);
      }
      element.removeAttribute('srcset'); element.removeAttribute('loading');
    }
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = anchor.getAttribute('href')!;
      if (href.startsWith('#') || href.startsWith('about:srcdoc#')) continue;
      if (/^(mailto|tel):/i.test(href)) continue;
      let key: string;
      try { key = this.key(href); } catch { anchor.removeAttribute('href'); continue; }
      let asset = this.urls.get(key);
      if (!asset && new URL(key).origin === window.location.origin && new URL(key).pathname.includes('/api/artifacts/')) asset = await this.read(href);
      if (asset) {
        anchor.href = `#${asset.id}`; anchor.dataset.exportAsset = asset.id; anchor.download = asset.name; anchor.removeAttribute('target');
      } else { anchor.href = key; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
    }
  }
}

const css = `
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:var(--background,#f6f6f1);color:var(--foreground,#303b30);font:15px/1.8 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1000px;margin:0 auto;padding:48px 32px}header.archive-header{padding-bottom:32px;border-bottom:1px solid var(--border,#dedfd7);margin-bottom:40px}h1{font-size:26px;line-height:1.4;margin:0 0 12px}.meta,figcaption,.message-meta{font-size:13px;color:var(--muted,#777d6e)}article{margin:36px 0;min-width:0}.message-meta{margin-bottom:12px;display:flex;gap:16px}.message-body{overflow-wrap:anywhere}.user .message-body{background:var(--panel,#fff);padding:18px 24px;border-radius:20px;white-space:pre-wrap}.assistant .message-body> :first-child{margin-top:0}a{color:var(--accent-strong,#426c48);text-underline-offset:3px}img,svg,video{max-width:100%;height:auto}audio{max-width:100%}figure{margin:24px 0}figure img{display:block;width:auto;margin:0 auto}figcaption{margin-top:10px}pre{padding:16px;border-radius:12px;background:var(--panel,#fff);white-space:pre-wrap;overflow-wrap:anywhere}code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}th,td{padding:9px 13px;border:1px solid var(--border,#dedfd7);text-align:left}th{background:var(--panel,#fff)}blockquote{margin:16px 0;padding-left:18px;border-left:3px solid var(--border,#dedfd7);color:var(--muted,#777d6e)}.files{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.files a{display:inline-flex;gap:8px;padding:8px 14px;border:1px solid var(--border,#dedfd7);border-radius:10px;text-decoration:none}summary{cursor:pointer;color:var(--muted,#777d6e)}details{margin:16px 0}iframe{display:block;width:100%;border:0;min-height:48px}math[display=block]{display:block;overflow:auto;margin:18px 0}footer{margin-top:48px;color:var(--muted,#777d6e);font-size:12px}@media(max-width:640px){main{padding:24px 16px}}@media print{body{background:white;color:black}main{max-width:none;padding:0}article{break-inside:avoid}a{color:inherit}details:not([open]){display:none}}
`;

const runtimeScript = `
const assets=JSON.parse(document.getElementById('export-assets').textContent);
function download(id){const file=assets[id];if(!file)return;const raw=atob(file.data.slice(file.data.indexOf(',')+1));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:file.mime}));const a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
document.addEventListener('click',e=>{const a=e.target.closest?.('a[data-export-asset]');if(a){e.preventDefault();download(a.dataset.exportAsset);}});
window.addEventListener('message',e=>{const frame=[...document.querySelectorAll('iframe[data-export-frame]')].find(f=>f.contentWindow===e.source);if(!frame)return;if(e.data?.type==='capability-html-height'&&e.data.nonce===frame.dataset.exportFrame&&Number.isFinite(e.data.height)){frame.style.height=Math.max(48,e.data.height)+'px';}if(e.data?.type==='export-file')download(e.data.id);});
for(const frame of document.querySelectorAll('iframe[data-export-frame]')){const ready=()=>frame.contentWindow?.postMessage({type:'export-ready'},'*');frame.addEventListener('load',ready);ready();}
`;

/** Build from the complete snapshot, never from only the currently mounted DOM. */
export async function buildBrowserChatExport(snapshot: BrowserChatExportSnapshot, options: { locale: string; signal: AbortSignal; onProgress: (text: string) => void }) {
  const { signal } = options;
  const assets = new ExportAssets(signal);
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const computed = getComputedStyle(document.documentElement);
  const theme: Record<string, string> = Object.fromEntries(['--background', '--foreground', '--muted', '--panel', '--border', '--accent', '--accent-strong', '--app-font-sans'].map(name => [name, computed.getPropertyValue(name).trim()]).filter(([, value]) => value));
  theme['color-scheme'] = computed.colorScheme;
  const context = createResponseContext({ sessionId: snapshot.id, locale: options.locale, translate: text => text, renderMarkdown: text => text });
  const charts = new Map<string, string>();
  const markdown = (text: string, files: BrowserChatArtifactSummary[] = []) => <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath, remarkBrowserChatCjkStrong, remarkBrowserChatArtifactLinks]}
    rehypePlugins={[rehypeRaw, [rehypeSanitize, browserChatHtmlSchema], rehypeBrowserChatSvgReferences, [rehypeKatex, { output: 'mathml' }]]}
    urlTransform={(url, key) => defaultUrlTransform(resolveBrowserChatArtifactReference(url, files, key === 'src'))}>
    {normalizeBrowserChatMarkdown(text)}
  </ReactMarkdown>;
  async function markup(html: string) {
    const template = document.createElement('template'); template.innerHTML = html;
    // React may emit image preload hints; resources are embedded below.
    template.content.querySelectorAll('link').forEach(node => node.remove());
    await assets.inline(template.content);
    return template.innerHTML;
  }
  async function block(value: BrowserChatFinalBlock, files: BrowserChatArtifactSummary[]): Promise<string> {
    signal.throwIfAborted();
    const params = value.params;
    if (value.type === 'core.markdown') return markup(renderToStaticMarkup(markdown(String(params.text || ''), files)));
    if (value.type === 'core.ui') return markup(renderToStaticMarkup(<DeclarativeResponseView tree={params.tree as UINode} renderMarkdown={text => markdown(text, files)} />));
    if (value.type === 'core.html') {
      const source = createHTMLResponseDocument(htmlParams.parse(params), { nonce, locale: options.locale, baseURL: window.location.href, theme });
      const frame = new DOMParser().parseFromString(source, 'text/html');
      await assets.inline(frame.body);
      const script = frame.createElement('script'); script.setAttribute('nonce', nonce);
      script.textContent = `document.addEventListener('click',e=>{const a=e.target.closest?.('a[data-export-asset]');if(a){e.preventDefault();parent.postMessage({type:'export-file',id:a.dataset.exportAsset},'*');}});
        window.addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='export-ready')parent.postMessage({type:'capability-html-height',nonce:'${nonce}',height:Math.ceil(Math.max(document.body.getBoundingClientRect().height,document.body.scrollHeight))},'*');});`;
      frame.body.append(script);
      return `<iframe title="${escapeExportHtml(params.title)}" sandbox="${HTML_FRAME_SANDBOX}" data-export-frame="${nonce}" srcdoc="${escapeExportHtml('<!doctype html>' + frame.documentElement.outerHTML)}"></iframe>`;
    }
    if (value.type === 'com.webpilot.chart' || value.type === 'com.webpilot.canvas') {
      const chartId = String(params.chartId);
      if (charts.has(chartId)) return charts.get(chartId)!;
      options.onProgress('正在内嵌图表和画布…');
      const chart = await context.request<ChartRecord>(value, 'read', undefined, signal);
      (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = withWebPilotBasePath('/api/chart-assets/excalidraw/');
      const { exportChartPng } = await import('@cjfclonedeep/capability-sdk/chart/react');
      const data = await exportChartPng(chart);
      signal.throwIfAborted();
      const image = await assets.read(data, `${chart.title || chartId}.png`);
      const scene = chart.engine === 'excalidraw' ? { ...chart.option, type: 'excalidraw', version: 2, source: 'Orbit' } : chart;
      const original = await assets.add(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }), `${chart.title || chartId}.${chart.engine === 'excalidraw' ? 'excalidraw' : 'json'}`);
      const html = `<figure><img src="${image.data}" alt="${escapeExportHtml(chart.title || chartId)}"><figcaption>${escapeExportHtml(chart.title || chartId)} · ${assets.link(image, '下载图片')} · ${assets.link(original, chart.engine === 'excalidraw' ? '下载可编辑画布' : '下载图表数据')}</figcaption></figure>`;
      charts.set(chartId, html); return html;
    }
    if (value.type === 'com.webpilot.maps') {
      const { record, view } = await context.request<GoogleMapPayload>(value, 'read', undefined, signal);
      // Keep places and routes offline; do not serialize the Google browser key.
      const file = await assets.add(new Blob([JSON.stringify({ record, view }, null, 2)], { type: 'application/json' }), `${record.title}.json`);
      return `<section><h3>${escapeExportHtml(record.title)}</h3><p>地图地点与路线数据已保存；在线底图需联网查看。</p><ul>${view.places.map(place => `<li>${escapeExportHtml(place.name)} — ${escapeExportHtml(place.address)}</li>`).join('')}${view.markers.map(marker => `<li>${escapeExportHtml(marker.label)} (${marker.position.lat}, ${marker.position.lng})</li>`).join('')}</ul>${view.route ? `<p>${view.route.distanceMeters} m · ${view.route.durationSeconds} s</p>` : ''}${assets.link(file, '下载地图数据')} · <a href="${escapeExportHtml(defaultUrlTransform(view.googleMapsUrl))}" target="_blank" rel="noreferrer">查看在线地图</a></section>`;
    }
    throw new Error(`暂不支持导出内容类型 ${value.type}，未生成不完整的文件。`);
  }
  async function fileList(files: BrowserChatArtifactSummary[]) {
    const items: string[] = [];
    for (const file of files) {
      const url = browserChatArtifactOpenUrl(file);
      if (!url) throw new Error(`文件“${file.fileName}”缺少可读取的地址。`);
      options.onProgress('正在内嵌图片和文件…');
      const asset = await assets.read(url, file.fileName);
      const media = asset.mime.startsWith('image/') ? `<img src="${asset.data}" alt="${escapeExportHtml(file.title || file.fileName)}">`
        : /^(audio|video)\//.test(asset.mime) ? `<${asset.mime.split('/')[0]} controls preload="metadata" src="${asset.data}"></${asset.mime.split('/')[0]}>` : '';
      items.push(`${media ? `<figure>${media}<figcaption>${escapeExportHtml(file.fileName)}</figcaption></figure>` : ''}<div class="files">${assets.link(asset)} <small>${Math.ceil(asset.bytes / 1024)} KB</small></div>`);
    }
    return items.join('');
  }
  async function response(parts: BrowserChatExportSnapshot['messages'][number]['parts'], content: string, files: BrowserChatArtifactSummary[]) {
    const sections: string[] = [];
    for (const part of browserChatOrderedResponseParts(parts, content)) {
      if (part.type === 'text') sections.push(await markup(renderToStaticMarkup(markdown(part.text, files))));
      if (part.type === 'data-response') sections.push(await block(part.data, files));
    }
    return sections.join('\n');
  }
  const articles: string[] = [];
  const stepsHtml = (steps: StepExecutionResult[]) => steps.length ? `<details><summary>执行过程 · ${steps.length} 步</summary>${steps.map(step => `<section><strong>${escapeExportHtml(step.action)}</strong>${(step.tools || []).filter(tool => tool.name !== 'finalResponse').map(tool => `<details><summary>${escapeExportHtml(tool.reason || tool.name)}</summary><pre>${escapeExportHtml(tool.result || tool.error || '')}</pre></details>`).join('')}</section>`).join('')}</details>` : '';
  for (const message of snapshot.messages) {
    signal.throwIfAborted();
    const steps = snapshot.steps.filter(step => step.messageId === message.id || (!step.messageId && message.stepIndexes?.includes(step.index)));
    const files = mergeBrowserChatArtifactSummaries(message.artifacts, browserChatArtifactsFromSteps(steps), (message.attachments || []).filter(item => item.kind !== 'tab').map(item => ({ id: item.id, fileName: item.name, url: item.url, kind: item.type.startsWith('image/') ? 'image' as const : 'file' as const })));
    // Register files before rendering HTML/Markdown links to the same artifacts.
    const attachments = await fileList(files);
    const references = (message.attachments || []).filter(item => item.kind === 'tab').map(item => {
      const url = defaultUrlTransform(item.sourceUrl || item.url);
      return `<div class="files"><a href="${escapeExportHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeExportHtml(item.name)} · 网页引用</a></div>`;
    }).join('');
    const parts = [...(message.parts || []), ...browserChatExecutionParts(steps)];
    if (message.responseDraft?.blocks?.length) parts.push(...message.responseDraft.blocks.map((data, index) => ({ type: 'data-response' as const, id: `draft-${index}`, data })));
    const content = message.role === 'user' ? escapeExportHtml(message.content.replace(/\[\[(?:ref|skill):[^\]]+\]\]/g, '')) : await response(parts, message.content, files);
    const children: string[] = [];
    for (const child of snapshot.subagents.filter(child => child.messageId === message.id)) {
      const childFiles = browserChatArtifactsFromSteps(child.steps);
      const childAttachments = await fileList(childFiles);
      const childContent = await response(browserChatExecutionParts(child.steps), child.content || child.summary || '', childFiles);
      children.push(`<details><summary>子 Agent · ${escapeExportHtml(child.title)}</summary><p>${escapeExportHtml(child.instruction)}</p>${childContent}${childAttachments}${stepsHtml(child.steps)}</details>`);
    }
    articles.push(`<article class="${message.role}"><div class="message-meta"><strong>${message.role === 'user' ? '你' : 'AI'}</strong><time>${escapeExportHtml(new Date(message.createdAt).toLocaleString(options.locale))}</time>${message.status === 'running' ? '<span>导出时仍在生成</span>' : ''}</div><div class="message-body">${content}</div>${references}${attachments}${stepsHtml(steps)}${children.join('')}</article>`);
  }
  const doc = document.implementation.createHTMLDocument(snapshot.title);
  doc.documentElement.lang = options.locale;
  for (const [name, value] of Object.entries(theme)) doc.documentElement.style.setProperty(name, value);
  const charset = doc.createElement('meta'); charset.setAttribute('charset', 'utf-8'); doc.head.prepend(charset);
  const viewport = doc.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1'; doc.head.append(viewport);
  const policy = doc.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; frame-src about:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
  doc.head.append(policy);
  const style = doc.createElement('style'); style.textContent = css; doc.head.append(style);
  doc.body.innerHTML = `<main><header class="archive-header"><h1>${escapeExportHtml(snapshot.title)}</h1><div class="meta">${snapshot.messages.length} 条消息 · ${escapeExportHtml(new Date(snapshot.exportedAt).toLocaleString(options.locale))} 导出</div></header>${articles.join('\n')}<footer>Orbit · 离线对话存档 · 图表和画布为导出时的快照，附件可下载。</footer></main>`;
  const data = doc.createElement('script'); data.id = 'export-assets'; data.type = 'application/json'; data.textContent = exportJson(Object.fromEntries([...assets.assets].map(([id, { name, mime, data }]) => [id, { name, mime, data }]))); doc.body.append(data);
  const script = doc.createElement('script'); script.setAttribute('nonce', nonce); script.textContent = runtimeScript; doc.body.append(script);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

export async function exportBrowserChatHtml(options: { sessionId: string; locale: string; signal: AbortSignal; onProgress: (text: string) => void }) {
  const response = await fetch(withWebPilotBasePath(`/api/browser-chat/${encodeURIComponent(options.sessionId)}/export`), { cache: 'no-store', signal: options.signal });
  const snapshot = await response.json();
  if (!response.ok) throw new Error((typeof snapshot.error === 'string' ? snapshot.error : snapshot.error?.message) || '读取完整对话失败');
  const html = await buildBrowserChatExport(snapshot, options);
  options.signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${safeName(snapshot.title)}.html`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
