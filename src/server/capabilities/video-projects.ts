import { randomUUID, createHash } from 'node:crypto';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createCapabilityDocumentDatabase } from '@cjfclonedeep/capability-sdk/node';
import { createFfmpegMediaOperations, createRemotionMediaOperations } from '@cjfclonedeep/capability-sdk/media/node';
import type { ComposeVideoInput, MediaArtifact } from '@cjfclonedeep/capability-sdk/media';
import { compositionFromVideoDocument, videoEditDocumentSchema, type VideoEditDocument, type VideoProject } from '@cjfclonedeep/capability-sdk/media/video-project';
import type { CapabilityExecutionContext } from '@cjfclonedeep/capability-sdk';
import { resolveOwnedArtifact } from '@/server/storage/artifact-access';
import { appDataRoot, artifactPath } from '@/server/storage/paths';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import { artifactApiUrlFromRelative } from '@/lib/artifacts';
import { ApiRequestError } from '@/server/http/api-request';

function owner(value?: string) {
  const id = normalizeApplicationUserId(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new Error('Invalid media project owner.');
  return id;
}
export function videoArtifactRef(ref: string) {
  const pathname = new URL(ref, 'http://artifact.local').pathname;
  const marker = '/api/artifacts/';
  const offset = pathname.indexOf(marker);
  if (offset < 0) throw new ApiRequestError('只能编辑当前用户的已保存媒体文件。');
  const parts = pathname.slice(offset + marker.length).split('/').map(decodeURIComponent);
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\/:\0]/.test(part))) throw new ApiRequestError('媒体文件引用无效。');
  return parts.join('/');
}
function openStore(userId: string) {
  const store = createCapabilityDocumentDatabase<VideoProject>({
    directory: path.join(appDataRoot(), 'video-projects', createHash('sha256').update(userId).digest('hex')),
    filename: 'projects.db', legacyFilename: 'projects.json', readLegacy() { throw new Error('Unsupported video project import.'); },
  });
  store.database().exec('CREATE TABLE IF NOT EXISTS video_outputs (ref TEXT PRIMARY KEY, project_id TEXT NOT NULL)');
  return store;
}
function readProject(store: ReturnType<typeof openStore>, id: string, revision?: number) {
  if (!/^video_[a-f0-9-]{36}$/.test(id)) throw new ApiRequestError('视频工程不存在。', { status: 404 });
  const project = store.get(id);
  if (!project) throw new ApiRequestError('视频工程不存在。', { status: 404 });
  if (revision !== undefined && project.revision !== revision) throw new ApiRequestError('视频工程已在其他窗口修改。请重新打开工程后编辑，当前修改未覆盖。', { status: 409, code: 'revision_conflict' });
  return project;
}
async function ownedSource(ref: string, userId: string) {
  return resolveOwnedArtifact(videoArtifactRef(ref).split('/'), userId);
}
async function preserveAssets(document: VideoEditDocument, userId: string, projectId: string, resolveSource: (ref: string) => Promise<string>, signal?: AbortSignal) {
  const prefix = `media-projects/${userId}/${projectId}/assets/`;
  const copies = new Map<string, string>();
  const persist = async (ref: string) => {
    if (copies.has(ref)) return copies.get(ref)!;
    signal?.throwIfAborted();
    const source = await resolveSource(ref);
    const file = await stat(source);
    if (!file.isFile() || file.size > 512 * 1024 * 1024) throw new ApiRequestError('单个剪辑素材不能超过 512 MB。');
    try {
      const canonical = videoArtifactRef(ref);
      if (canonical.startsWith(prefix)) return artifactApiUrlFromRelative(canonical);
    } catch { /* Registered attachment ids are resolved by the caller. */ }
    const extension = path.extname(source).toLowerCase();
    if (!/^\.[a-z0-9]{1,10}$/.test(extension)) throw new ApiRequestError('素材文件扩展名无效。');
    const relative = `${prefix}${randomUUID()}${extension}`;
    const destination = artifactPath(...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    signal?.throwIfAborted();
    const url = artifactApiUrlFromRelative(relative);
    copies.set(ref, url);
    return url;
  };
  const next = structuredClone(document);
  for (const scene of next.scenes) scene.sourceRef = await persist(scene.sourceRef);
  if (next.audio) next.audio.sourceRef = await persist(next.audio.sourceRef);
  return next;
}

export async function saveCompositionProject(input: {
  userId?: string; composition: ComposeVideoInput; output: MediaArtifact;
  resolveSource(ref: string): Promise<string>; signal?: AbortSignal;
}) {
  const userId = owner(input.userId), store = openStore(userId);
  const id = `video_${randomUUID()}`;
  try {
    const composition = input.composition;
    const duration = composition.scenes.reduce((sum, scene) => sum + scene.duration, 0);
    const document = videoEditDocumentSchema.parse({ title: '分镜视频', size: composition.size || '1280x720',
      scenes: composition.scenes.map((scene, index) => ({ ...scene, id: `scene_${index + 1}`, label: `分镜 ${index + 1}` })),
      ...(composition.audioRef ? { audio: { sourceRef: composition.audioRef, label: '旁白', offset: composition.audioOffset || 0,
        trimStart: composition.audioTrimStart || 0, duration: composition.audioDuration || duration, volume: composition.audioVolume ?? 1 } } : {}),
    });
    const saved = await preserveAssets(document, userId, id, input.resolveSource, input.signal);
    input.signal?.throwIfAborted();
    const time = new Date().toISOString();
    const project: VideoProject = { id, revision: 1, document: saved, outputUrl: input.output.url, renderedRevision: 1, createdAt: time, updatedAt: time };
    store.transaction(db => {
      store.save(project);
      if (input.output.url) db.prepare('INSERT OR REPLACE INTO video_outputs VALUES (?, ?)').run(videoArtifactRef(input.output.url), id);
    });
    return project;
  } finally { await store.dispose(); }
}

export async function openVideoProject(sourceRef: string, userIdValue?: string, signal?: AbortSignal) {
  const userId = owner(userIdValue), canonical = videoArtifactRef(sourceRef);
  const source = await ownedSource(sourceRef, userId);
  const store = openStore(userId);
  try {
    const existing = store.database().prepare('SELECT project_id FROM video_outputs WHERE ref=?').get(canonical);
    if (existing) return readProject(store, String(existing.project_id));
  } finally { await store.dispose(); }
  if (!/\.(mp4|webm|mov|mkv|avi)$/i.test(source)) throw new ApiRequestError('请选择视频文件。');
  const execution = { invocationId: randomUUID(), abortSignal: signal };
  const probe = await createFfmpegMediaOperations({ resolveSource: async () => source, publishArtifact: async () => { throw new Error('Unused publisher'); } }).inspect(sourceRef, execution) as { probe: string };
  const match = String(probe.probe).match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
  if (!duration || duration > 600) throw new ApiRequestError('当前剪辑支持 0 至 600 秒的视频，无法识别该文件时长或文件过长。');
  const dims = String(probe.probe).match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  const size = dims && Number(dims[1]) < Number(dims[2]) ? '720x1280' : '1280x720';
  return saveCompositionProject({ userId, composition: { scenes: [{ sourceRef: artifactApiUrlFromRelative(canonical), kind: 'video', duration }], size },
    output: { artifactId: canonical, url: artifactApiUrlFromRelative(canonical) }, resolveSource: ref => ownedSource(ref, userId), signal });
}

export async function updateVideoProject(id: string, revision: number, candidate: VideoEditDocument, userIdValue?: string, signal?: AbortSignal) {
  const userId = owner(userIdValue), store = openStore(userId);
  try {
    readProject(store, id, revision);
    const document = await preserveAssets(videoEditDocumentSchema.parse(candidate), userId, id, ref => ownedSource(ref, userId), signal);
    signal?.throwIfAborted();
    return store.transaction(() => {
      const project = readProject(store, id, revision);
      if (JSON.stringify(project.document) === JSON.stringify(document)) return project;
      const saved = { ...project, document, revision: revision + 1, updatedAt: new Date().toISOString() };
      store.save(saved);
      return saved;
    });
  } finally { await store.dispose(); }
}

const activeRenders = new Set<string>();
export async function renderVideoProject(id: string, revision: number, userIdValue?: string, signal?: AbortSignal) {
  const userId = owner(userIdValue), key = `${userId}:${id}`, store = openStore(userId);
  if (activeRenders.has(key)) { await store.dispose(); throw new ApiRequestError('该视频正在导出，请等待完成。', { status: 409 }); }
  activeRenders.add(key);
  try {
    const project = readProject(store, id, revision);
    const execution: CapabilityExecutionContext = { invocationId: randomUUID(), abortSignal: signal };
    const operations = createRemotionMediaOperations({
      timeoutMs: Number(process.env.AGENT_MEDIA_TIMEOUT_MS) || 120_000,
      renderTimeoutMs: Number(process.env.AGENT_VIDEO_RENDER_TIMEOUT_MS) || 900_000,
      resolveSource: ref => ownedSource(ref, userId),
      async publishArtifact(filePath) {
        signal?.throwIfAborted();
        const fileName = `${project.document.title.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 80)}-${randomUUID().slice(0, 8)}.mp4`;
        const relative = `media-projects/${userId}/${id}/renders/${fileName}`;
        const destination = artifactPath(...relative.split('/'));
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(filePath, destination);
        const url = artifactApiUrlFromRelative(relative);
        return { artifactId: relative, fileName, url, downloadUrl: `${url}?download=1`, mediaType: 'video/mp4' };
      },
    });
    const [artifact] = await operations.composeVideo!(compositionFromVideoDocument(project.document), execution);
    signal?.throwIfAborted();
    const saved = store.transaction(db => {
      const current = readProject(store, id, revision);
      const next = { ...current, outputUrl: artifact.url, renderedRevision: revision, updatedAt: new Date().toISOString() };
      store.save(next);
      db.prepare('INSERT OR REPLACE INTO video_outputs VALUES (?, ?)').run(videoArtifactRef(artifact.url!), id);
      return next;
    });
    return { project: saved, artifact };
  } finally { activeRenders.delete(key); await store.dispose(); }
}
