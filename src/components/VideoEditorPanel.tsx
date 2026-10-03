'use client';

import { CreativeButton } from './ui/creative-button';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { MediaVideoEditor } from '@cjfclonedeep/capability-sdk/media/video-editor';
import { videoDuration, videoEditDocumentSchema, type VideoEditDocument, type VideoProject } from '@cjfclonedeep/capability-sdk/media/video-project';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { CreativeEditorLoading } from './CreativeEditorLoading';
import { buttonVariants } from '@heroui/react/button';
import { creativeEditorControls } from './creative-editor-controls';
import { Check, Download, Film, LoaderCircle, Save, X } from 'lucide-react';

export type VideoEditorHandle = { flush(): Promise<void> };
type ProjectResponse = { project: VideoProject; artifact?: { url?: string; downloadUrl?: string; fileName?: string } };
async function projectRequest(body: unknown, signal?: AbortSignal): Promise<ProjectResponse> {
  const response = await fetch(withWebPilotBasePath('/api/media/video-projects'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '视频工程处理失败');
  return result;
}
function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
    const url = URL.createObjectURL(file);
    const cleanup = () => { clearTimeout(timer); element.onloadedmetadata = null; element.onerror = null; element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('无法读取素材时长，请尝试 MP4 或 MP3 文件。')); }, 15_000);
    element.onloadedmetadata = () => { const duration = element.duration; cleanup(); if (Number.isFinite(duration) && duration > 0) resolve(duration); else reject(new Error('素材时长无效')); };
    element.onerror = () => { cleanup(); reject(new Error('浏览器无法读取此素材，请转换为 MP4 或 MP3。')); };
    element.preload = 'metadata'; element.src = url;
  });
}

export function VideoEditorPanel({ sourceUrl, handleRef }: { sourceUrl: string; handleRef?: Ref<VideoEditorHandle> }) {
  const [project, setProject] = useState<VideoProject>();
  const [draft, setDraft] = useState<VideoEditDocument>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const currentProject = useRef<VideoProject | undefined>(undefined);
  const currentDraft = useRef<VideoEditDocument | undefined>(undefined);
  const saved = useRef('');
  const pendingSave = useRef<Promise<void> | undefined>(undefined);
  const pendingRender = useRef<AbortController | undefined>(undefined);
  const upload = useRef<HTMLInputElement>(null);
  const importKind = useRef<'visual' | 'audio'>('visual');
  const replaceScene = useRef<string | undefined>(undefined);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void projectRequest({ action: 'open', sourceRef: sourceUrl }, controller.signal).then(result => {
      currentProject.current = result.project; currentDraft.current = result.project.document;
      saved.current = JSON.stringify(result.project.document);
      setProject(result.project); setDraft(result.project.document); setLoaded(true);
      if (result.project.outputUrl) setDownloadUrl(`${result.project.outputUrl}?download=1`);
    }).catch(reason => { if (!controller.signal.aborted) { setError(String(reason.message || reason)); setLoaded(true); } });
    return () => { alive.current = false; controller.abort(); pendingRender.current?.abort(); };
  }, [sourceUrl]);

  const save = useCallback(async () => {
    if (pendingSave.current) return pendingSave.current;
    const operation = async () => {
      if (alive.current) setSaving(true);
      try {
        while (currentProject.current && currentDraft.current && JSON.stringify(currentDraft.current) !== saved.current) {
          const snapshot = videoEditDocumentSchema.parse(currentDraft.current), signature = JSON.stringify(snapshot);
          const previous = currentProject.current;
          const result = await projectRequest({ action: 'save', projectId: previous.id, revision: previous.revision, document: snapshot });
          currentProject.current = result.project; saved.current = JSON.stringify(result.project.document);
          if (JSON.stringify(currentDraft.current) === signature) {
            currentDraft.current = result.project.document;
            if (alive.current) setDraft(result.project.document);
          }
          if (alive.current) { setProject(result.project); setError(''); }
        }
      } catch (reason) {
        if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
        throw reason;
      } finally { if (alive.current) setSaving(false); }
    };
    const promise = operation(); pendingSave.current = promise;
    try { await promise; } finally { if (pendingSave.current === promise) pendingSave.current = undefined; }
  }, []);
  useEffect(() => {
    if (!draft || JSON.stringify(draft) === saved.current) return;
    const timer = setTimeout(() => { void save().catch(() => undefined); }, 700);
    return () => clearTimeout(timer);
  }, [draft, save]);
  useImperativeHandle(handleRef, () => ({ async flush() {
    if (pendingRender.current || importing) throw new Error('请等待导出或素材导入完成后关闭，也可以先取消导出。');
    await save();
  } }), [save, importing]);

  async function render() {
    setError(''); setRendering(true);
    const controller = new AbortController(); pendingRender.current = controller;
    try {
      await save();
      const current = currentProject.current;
      if (!current) return;
      const result = await projectRequest({ action: 'render', projectId: current.id, revision: current.revision }, controller.signal);
      currentProject.current = result.project;
      if (alive.current) { setProject(result.project); setDownloadUrl(result.artifact?.downloadUrl || ''); }
    } catch (reason) { if (alive.current) setError(controller.signal.aborted ? '已取消导出，剪辑工程已保留。' : reason instanceof Error ? reason.message : String(reason)); }
    finally { pendingRender.current = undefined; if (alive.current) setRendering(false); }
  }
  async function importFile(file?: File) {
    if (!file || !currentDraft.current) return;
    setImporting(true); setError('');
    try {
      const kind = importKind.current;
      const replacing = currentDraft.current.scenes.find(scene => scene.id === replaceScene.current);
      if (kind === 'visual' && !replacing && (currentDraft.current.scenes.length >= 60 || videoDuration(currentDraft.current) > 599.9)) throw new Error('分镜或总时长已达上限，请先缩短或删除现有片段。');
      if (kind === 'audio' ? !file.type.startsWith('audio/') : !/^(image|video)\//.test(file.type)) throw new Error('请选择支持的图片、视频或音频文件。');
      const duration = file.type.startsWith('image/') ? 3 : await readDuration(file);
      const form = new FormData(); form.append('file', file);
      const response = await fetch(withWebPilotBasePath('/api/uploads'), { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || '素材上传失败');
      const current = currentDraft.current;
      const scene: VideoEditDocument['scenes'][number] = { id: replacing?.id || `scene_${crypto.randomUUID()}`, label: file.name.slice(0, 200), sourceRef: result.url,
        kind: file.type.startsWith('video/') ? 'video' : 'image', trimStart: 0,
        duration: Math.min(duration, replacing?.duration ?? 600 - videoDuration(current)) };
      const next: VideoEditDocument = kind === 'audio'
        ? { ...current, audio: { sourceRef: result.url, label: file.name.slice(0, 200), offset: 0, trimStart: 0, duration: Math.min(600, duration), volume: 1 } }
        : { ...current, scenes: replacing ? current.scenes.map(item => item.id === replacing.id ? scene : item) : [...current.scenes, scene] };
      const valid = videoEditDocumentSchema.parse(next);
      currentDraft.current = valid; setDraft(valid);
      await save();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setImporting(false); if (upload.current) upload.current.value = ''; }
  }
  if (!loaded) return <CreativeEditorLoading label="正在读取剪辑工程" />;
  if (!project || !draft) return <p role="alert">{error || '无法打开视频工程'}</p>;
  const dirty = JSON.stringify(draft) !== saved.current;
  return <div className="browser-chat-video-edit-panel">
    <div className="browser-chat-video-edit-actions">
      <span className="creative-video-status" aria-live="polite">{rendering || importing || saving ? <LoaderCircle size={13} className="editor-spin" /> : <Check size={13} />}{rendering ? '正在导出视频…' : importing ? '正在导入素材…' : saving ? '正在保存工程…' : dirty ? '有未保存修改' : '所有修改已保存'}</span>
      <div className="creative-toolbar-actions" role="group" aria-label="视频工程操作">
        <CreativeButton disabled={rendering || importing || saving} onClick={() => void save().catch(() => undefined)}><Save size={14} />保存工程</CreativeButton>
        {downloadUrl && <a data-slot="button" className={buttonVariants({ size: 'sm', variant: 'secondary', className: 'creative-button' })} download data-file-preview="false" href={downloadUrl}><Download size={14} />下载{project.renderedRevision !== project.revision || dirty ? '上次导出' : '当前视频'}</a>}
        {rendering && <CreativeButton onClick={() => pendingRender.current?.abort()}><X size={14} />取消导出</CreativeButton>}
        <CreativeButton variant="primary" disabled={rendering || importing} onClick={() => void render()}><Film size={14} />导出 MP4</CreativeButton>
      </div>
    </div>
    {error && <p role="alert" className="media-video-editor-error">{error}</p>}
    <MediaVideoEditor document={draft} disabled={rendering || importing} controls={creativeEditorControls}
      onChange={next => { currentDraft.current = next; setDraft(next); setError(''); }}
      onImport={(kind, sceneId) => { importKind.current = kind; replaceScene.current = sceneId; if (upload.current) { upload.current.accept = kind === 'audio' ? 'audio/*' : 'image/*,video/*'; upload.current.click(); } }} />
    <input hidden ref={upload} type="file" onChange={event => void importFile(event.target.files?.[0])} />
  </div>;
}
