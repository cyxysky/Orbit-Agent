const { parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const echarts = require('echarts');
const cache = new Map();
const maxCacheBytes = 4 * 1024 * 1024;
let cacheBytes = 0;

function remember(key, entry) {
  const previous = cache.get(key);
  if (previous) { cacheBytes -= previous.bytes; cache.delete(key); }
  entry.bytes = (entry.svg.length + (entry.data?.length || 0)) * 2 + 256;
  if (entry.bytes > maxCacheBytes) return;
  while (cache.size && (cacheBytes + entry.bytes > maxCacheBytes || cache.size >= 8)) {
    const oldest = cache.keys().next().value;
    cacheBytes -= cache.get(oldest).bytes;
    cache.delete(oldest);
  }
  cache.set(key, entry);
  cacheBytes += entry.bytes;
}

async function render(input) {
  const height = input.height || 480;
  const key = createHash('sha256').update(JSON.stringify([input.option, input.maps || [], height])).digest('hex');
  let entry = cache.get(key);
  if (!entry) {
    let chart;
    try {
      for (const map of input.maps || []) {
        echarts.registerMap(map.name, typeof map.geoJson === 'string' ? { svg: map.geoJson } : map.geoJson, map.specialAreas);
      }
      chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 960, height });
      chart.setOption({ ...input.option, animation: false });
      const svg = chart.renderToSVGString();
      if (!svg.includes('<svg')) throw new Error('ECharts produced no SVG surface.');
      entry = { svg };
    } finally { chart?.dispose(); }
  }
  if (input.image && entry.data === undefined) {
    const sharp = require('sharp');
    sharp.cache(false);
    entry.data = (await sharp(Buffer.from(entry.svg)).png().toBuffer()).toString('base64');
  }
  remember(key, entry);
  return input.image ? entry.data : undefined;
}

parentPort.on('message', async job => {
  if (job.dispose) { cache.clear(); parentPort.close(); return; }
  try { parentPort.postMessage({ id: job.id, ok: true, data: await render(job.input) }); }
  catch (error) {
    parentPort.postMessage({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
