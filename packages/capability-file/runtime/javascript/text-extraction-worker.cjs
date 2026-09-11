const { parentPort } = require('node:worker_threads');
  const { readFile } = require('node:fs/promises');
  const { createHash } = require('node:crypto');

  async function zipFrom(buffer) {
    const imported = await import('jszip');
    const JSZip = imported.default || imported;
    return JSZip.loadAsync(buffer);
  }
  async function extract(job) {
    const buffer = await readFile(job.path);
    if (createHash('sha256').update(buffer).digest('hex') !== job.digest) throw new Error('File changed during extraction. Read the current revision again.');
    if (job.sheet || job.range || job.section) throw new Error('Office selections require the UNO document reader.');
    if (job.contentPages?.length && job.kind !== 'pdf') throw new Error('contentPages are supported only for PDF text.');
    if (job.kind === 'pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText(job.contentPages?.length ? { partial: job.contentPages } : undefined);
        if (job.contentPages?.some(page => page > result.total)) throw new Error('Requested PDF page exceeds page count: ' + result.total);
        return result.text.trim();
      } finally { await parser.destroy(); }
    }
    if (job.kind === 'archive') {
      const archive = await zipFrom(buffer);
      const names = Object.values(archive.files).filter((entry) => !entry.dir).map((entry) => entry.name).slice(0, 2000);
      return '压缩包文件列表（' + names.length + ' 项）：\n' + names.join('\n');
    }
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (text && !buffer.includes(0)) return text;
    if (job.kind === 'text') return '';
    throw new Error('该文件是未知二进制格式，当前没有可用的文本解析器。');
  }
  parentPort.on('message', async (job) => {
    if (job.dispose) { parentPort.close(); return; }
    try { parentPort.postMessage({ id: job.id, ok: true, value: await extract(job) }); }
    catch (error) { parentPort.postMessage({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
