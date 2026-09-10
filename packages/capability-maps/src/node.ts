import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mapIdSchema, mapRecordSchema, MapsError, type MapStore } from './core.ts';
export { createMapsCapability, createMapsTool } from './index.ts';

/** Store only application requests; Google responses are fetched afresh for display. */
export function createFileSystemMapStore(directory: string): MapStore {
  return {
    async create(input) {
      const record = mapRecordSchema.parse({ ...input, mapId: `map_${randomBytes(12).toString('hex')}`, createdAt: new Date().toISOString() });
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${record.mapId}.json`), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
      return record;
    },
    async read(mapId) {
      mapIdSchema.parse(mapId);
      try { return mapRecordSchema.parse(JSON.parse(await readFile(path.join(directory, `${mapId}.json`), 'utf8'))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    },
  };
}

/** Exclusive reservation files make the ceiling durable across UI/runtime workers and restarts. */
export async function reserveMapsRequest(directory: string, kind: 'search' | 'route', limit: number, signal?: AbortSignal, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100000) throw new MapsError('maps-invalid-limit', '地图请求上限配置无效。');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const month = `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
  const target = path.join(directory, month, kind);
  await mkdir(target, { recursive: true });
  const files = await readdir(target);
  let slot = files.filter(name => /^\d+\.used$/.test(name)).length + 1;
  while (slot <= limit) {
    signal?.throwIfAborted();
    try { await writeFile(path.join(target, `${slot}.used`), '', { flag: 'wx', mode: 0o600 }); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; slot++; }
  }
  throw new MapsError('maps-monthly-limit', `本应用本月${kind === 'search' ? '地点搜索' : '路线规划'}已达到 ${limit} 次上限，已停止请求 Google。可在地图设置中调整上限。`);
}
