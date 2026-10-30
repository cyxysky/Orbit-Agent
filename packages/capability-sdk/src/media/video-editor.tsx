'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { Timeline, type TimelineState } from '@xzdarcy/react-timeline-editor';
import { Player, type PlayerRef } from '@remotion/player';
import { ArrowLeft, ArrowRight, Film, ImagePlus, Music2, Pause, Play, Redo2, Replace, Scissors, Trash2, Undo2 } from 'lucide-react';
import { compositionFromVideoDocument, videoDuration, videoEditDocumentSchema, type VideoEditDocument } from './video-project.ts';
import { MediaVideoComposition, videoCompositionMetadata } from './video-composition.tsx';
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css';
import './video-editor.css';

type Scene = VideoEditDocument['scenes'][number];
const frameTime = (time: number) => Math.round(time * 30) / 30;
const clock = (time: number) => `${Math.floor(time / 60)}:${(time % 60).toFixed(1).padStart(4, '0')}`;
export type VideoEditorControls = {
  Button: ComponentType<{ children?: ReactNode; disabled?: boolean; className?: string; variant?: 'primary' | 'secondary' | 'ghost'; onClick?: () => void }>;
  Input: ComponentType<InputHTMLAttributes<HTMLInputElement>>;
  TextArea: ComponentType<TextareaHTMLAttributes<HTMLTextAreaElement>>;
  Select: ComponentType<{ label: string; value: string; disabled?: boolean; options: { value: string; label: string }[]; onChange(value: string): void }>;
  Range: ComponentType<{ label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange(value: number): void }>;
  Checkbox: ComponentType<{ label: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void }>;
};
const nativeControls: VideoEditorControls = {
  Button: ({ variant, ...props }) => <button type="button" data-variant={variant} {...props} />,
  Input: props => <input {...props} />,
  TextArea: props => <textarea {...props} />,
  Select: ({ label, value, disabled, options, onChange }) => <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
  Range: ({ label, onChange, ...props }) => <input aria-label={label} type="range" {...props} onChange={event => onChange(Number(event.target.value))} />,
  Checkbox: ({ label, onChange, ...props }) => <label className="media-video-editor-check"><input type="checkbox" {...props} onChange={event => onChange(event.target.checked)} />{label}</label>,
};
export function MediaVideoEditor({ document, onChange, onImport, disabled = false, controls = nativeControls }: {
  document: VideoEditDocument; onChange(document: VideoEditDocument): void;
  onImport(kind: 'visual' | 'audio', replaceSceneId?: string): void; disabled?: boolean;
  controls?: VideoEditorControls;
}) {
  const { Input, TextArea, Select, Range, Checkbox, Button } = controls;
  const [selectedId, setSelectedId] = useState(document.scenes[0]?.id);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [past, setPast] = useState<VideoEditDocument[]>([]);
  const [future, setFuture] = useState<VideoEditDocument[]>([]);
  const timeline = useRef<TimelineState>(null);
  const player = useRef<PlayerRef>(null);
  const total = videoDuration(document);
  const composition = useMemo(() => compositionFromVideoDocument(document), [document]);
  const metadata = videoCompositionMetadata(composition);
  const scenes = useMemo(() => {
    let start = 0;
    return document.scenes.map(scene => { const result = { ...scene, start, end: start + scene.duration }; start = result.end; return result; });
  }, [document.scenes]);
  const selected = scenes.find(scene => scene.id === selectedId) || scenes[0];
  const current = scenes.find(scene => time >= scene.start && time < scene.end) || (time >= total ? scenes.at(-1) : undefined);
  const rows = useMemo(() => [{ id: 'visual', actions: scenes.map(scene => ({ id: scene.id, start: scene.start, end: scene.end, effectId: 'visual', selected: scene.id === selected?.id })) },
    { id: 'audio', actions: document.audio ? [{ id: 'audio', start: document.audio.offset, end: document.audio.offset + document.audio.duration, effectId: 'audio' }] : [] }], [scenes, document.audio, selected?.id]);
  const effects = useMemo(() => ({ visual: { id: 'visual', name: '画面' }, audio: { id: 'audio', name: '配音' } }), []);
  function commit(next: VideoEditDocument) {
    const parsed = videoEditDocumentSchema.safeParse(next);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || '剪辑参数无效'); return; }
    setPlaying(false); setError('');
    setPast(items => [...items.slice(-49), structuredClone(document)]); setFuture([]);
    onChange(parsed.data);
  }
  function changeScene(patch: Partial<Scene>) {
    if (selected) commit({ ...document, scenes: document.scenes.map(scene => scene.id === selected.id ? { ...scene, ...patch } : scene) });
  }
  function seek(next: number) {
    setPlaying(false);
    const frame = Math.max(0, Math.min(metadata.durationInFrames - 1, Math.round(next * 30)));
    player.current?.seekTo(frame); setTime(frame / 30);
  }
  function reorder(id: string, index: number) {
    const next = [...document.scenes], old = next.findIndex(scene => scene.id === id);
    if (old < 0) return;
    const [scene] = next.splice(old, 1); next.splice(Math.max(0, Math.min(next.length, index)), 0, scene);
    commit({ ...document, scenes: next });
  }
  useEffect(() => {
    const view = player.current;
    if (!view) return;
    const frame = (event: { detail: { frame: number } }) => setTime(event.detail.frame / 30);
    const ended = () => setPlaying(false);
    const failed = () => { setPlaying(false); setError('媒体素材无法加载，请检查图片、视频或配音。'); };
    view.addEventListener('frameupdate', frame); view.addEventListener('ended', ended); view.addEventListener('error', failed);
    return () => { view.removeEventListener('frameupdate', frame); view.removeEventListener('ended', ended); view.removeEventListener('error', failed); };
  }, []);
  useEffect(() => { if (playing) player.current?.play(); else player.current?.pause(); }, [playing]);
  useEffect(() => { timeline.current?.setTime(Math.min(time, total)); }, [time, total]);

  return <div className={`media-video-editor${controls === nativeControls ? ' media-video-editor-native' : ''}`}>
    <div className="media-video-editor-toolbar">
      <div className="media-video-editor-title"><Input aria-label="视频名称" disabled={disabled} value={document.title} onChange={event => commit({ ...document, title: event.target.value || '未命名视频' })} /></div>
      <Select label="画面尺寸" disabled={disabled} value={document.size} onChange={size => commit({ ...document, size })} options={[...new Set([document.size, '1280x720', '720x1280', '1080x1080', '1920x1080', '1080x1920'])].map(size => ({ value: size, label: size.replace('x', ' × ') }))} />
      <div className="media-video-editor-tool-group" role="group" aria-label="撤销与重做">
      <Button variant="ghost" disabled={disabled || !past.length} onClick={() => { const previous = past.at(-1)!; setPast(past.slice(0, -1)); setFuture([document, ...future]); setPlaying(false); onChange(previous); }}><Undo2 size={14} />撤销</Button>
      <Button variant="ghost" disabled={disabled || !future.length} onClick={() => { setPast([...past, document]); setFuture(future.slice(1)); setPlaying(false); onChange(future[0]); }}><Redo2 size={14} />重做</Button>
      </div>
      <div className="media-video-editor-tool-group" role="group" aria-label="素材导入">
      <Button variant="ghost" disabled={disabled || scenes.length >= 60} onClick={() => onImport('visual')}><ImagePlus size={14} />添加图片 / 视频</Button>
      <Button variant="ghost" disabled={disabled} onClick={() => onImport('audio')}><Music2 size={14} />{document.audio ? '替换配音' : '添加配音'}</Button>
      </div>
    </div>
    {error && <p role="alert" className="media-video-editor-error">{error}</p>}
    <div className="media-video-editor-main">
      <div className="media-video-editor-stage">
      <div className="media-video-editor-stage-heading"><span><Film size={13} />画面预览</span><small>{document.size.replace('x', ' × ')} · 30 FPS</small></div>
      <div className="media-video-editor-preview">
        <Player ref={player} component={MediaVideoComposition} inputProps={composition} durationInFrames={metadata.durationInFrames}
          compositionWidth={metadata.width} compositionHeight={metadata.height} fps={30} controls={false} clickToPlay={false}
          style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
      </div>
      <div className="media-video-editor-stage-caption"><span>{current?.label}</span><small>{scenes.length} 个分镜 · {clock(total)}</small></div>
      </div>
      <fieldset className="media-video-editor-inspector" disabled={disabled}>
        <legend className="sr-only">分镜设置</legend>
        <div className="media-video-editor-field"><span>当前分镜</span><Select label="当前分镜" disabled={disabled} value={selected?.id || ''} onChange={id => { setSelectedId(id); seek(scenes.find(scene => scene.id === id)?.start || 0); }} options={scenes.map((scene, index) => ({ value: scene.id, label: `${index + 1}. ${scene.label}` }))} /></div>
        {selected && <>
          <label>名称<Input value={selected.label} onChange={event => changeScene({ label: event.target.value || '分镜' })} /></label>
          <label>时长（秒）<Input type="number" min="0.1" max="600" step="0.1" value={Number(selected.duration.toFixed(3))} onChange={event => changeScene({ duration: frameTime(Number(event.target.value)) })} /></label>
          <div className="media-video-editor-field"><span>画面运动</span><Select label="画面运动" disabled={disabled} value={selected.motion || 'none'} onChange={motion => changeScene({ motion: motion as Scene['motion'] })} options={[{value:'none',label:'固定画面'},{value:'zoomIn',label:'缓慢推近'},{value:'zoomOut',label:'缓慢拉远'},{value:'panLeft',label:'向左平移'},{value:'panRight',label:'向右平移'}]} /></div>
          <label>画面字幕<TextArea value={selected.caption || ''} maxLength={500} rows={3} onChange={event => changeScene({ caption: event.target.value })} /></label>
          {selected.kind === 'video' && <>
            <label>素材起点（秒）<Input type="number" min="0" step="0.1" value={selected.trimStart || 0} onChange={event => changeScene({ trimStart: frameTime(Number(event.target.value)) })} /></label>
            <Checkbox label="静音原片" disabled={disabled} checked={selected.muted === true} onChange={muted => changeScene({ muted })} />
          </>}
          <div className="media-video-editor-buttons">
            <Button disabled={disabled} onClick={() => onImport('visual', selected.id)}><Replace size={13} />替换素材</Button>
            <Button disabled={disabled || scenes[0].id === selected.id} onClick={() => reorder(selected.id, scenes.indexOf(selected) - 1)}><ArrowLeft size={13} />前移</Button>
            <Button disabled={disabled || scenes.at(-1)?.id === selected.id} onClick={() => reorder(selected.id, scenes.indexOf(selected) + 1)}><ArrowRight size={13} />后移</Button>
            <Button className="media-video-editor-delete" disabled={disabled || scenes.length === 1} onClick={() => commit({ ...document, scenes: document.scenes.filter(scene => scene.id !== selected.id) })}><Trash2 size={13} />删除</Button>
          </div>
        </>}
        {document.audio && <>
          <strong>配音：{document.audio.label}</strong>
          <label>在视频中开始（秒）<Input type="number" min="0" max="600" step="0.1" value={document.audio.offset} onChange={event => commit({ ...document, audio: { ...document.audio!, offset: Number(event.target.value) } })} /></label>
          <label>音频裁切起点（秒）<Input type="number" min="0" step="0.1" value={document.audio.trimStart} onChange={event => commit({ ...document, audio: { ...document.audio!, trimStart: Number(event.target.value) } })} /></label>
          <label>配音时长（秒）<Input type="number" min="0.1" max="600" step="0.1" value={document.audio.duration} onChange={event => commit({ ...document, audio: { ...document.audio!, duration: Number(event.target.value) } })} /></label>
          <div className="media-video-editor-field"><span>音量</span><Range label="音量" disabled={disabled} min={0} max={1} step={0.05} value={document.audio.volume} onChange={volume => commit({ ...document, audio: { ...document.audio!, volume } })} /></div>
          <Button onClick={() => commit({ ...document, audio: undefined })}>移除配音，使用原片声音</Button>
        </>}
      </fieldset>
    </div>
    <div className="media-video-editor-transport">
      <Button variant="primary" className="media-video-editor-play" disabled={disabled} onClick={() => { if (time * 30 >= metadata.durationInFrames - 1) { player.current?.seekTo(0); setTime(0); } setPlaying(!playing); }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? '暂停' : '播放'}</Button>
      <Range label="预览进度" disabled={disabled} min={0} max={total} step={1 / 30} value={Math.min(time, total)} onChange={seek} />
      <span>{clock(Math.min(time, total))} / {clock(total)}</span>
      <Button disabled={disabled || !selected || scenes.length >= 60 || time - selected.start < 0.1 || selected.end - time < 0.1} onClick={() => {
        if (!selected) return;
        const cut = frameTime(time - selected.start), index = scenes.indexOf(selected), next = [...document.scenes];
        next.splice(index, 1, { ...next[index], duration: cut }, { ...next[index], id: `scene_${crypto.randomUUID()}`, label: `${selected.label}（后段）`, duration: selected.duration - cut, trimStart: selected.kind === 'video' ? (selected.trimStart || 0) + cut : 0 });
        commit({ ...document, scenes: next });
      }}><Scissors size={14} />在播放位置分割</Button>
    </div>
    <div className="media-video-editor-timeline" aria-label="视频剪辑时间轴">
      <div className="media-video-editor-timeline-heading"><strong>时间轴</strong><span><i />画面</span><span className="is-audio"><i />配音</span><small>拖拽排序 · 拖动边缘裁切</small></div>
      <Timeline ref={timeline} editorData={rows} effects={effects} scale={5} scaleWidth={120} scaleSplitCount={50}
        minScaleCount={Math.max(10, Math.ceil(total / 5) + 2)} maxScaleCount={122} rowHeight={48} gridSnap autoScroll
        disableDrag={disabled || playing} style={{ width: '100%', height: 150 }} onChange={() => false}
        getActionRender={action => {
          const scene = scenes.find(scene => scene.id === action.id);
          return <span className="media-video-editor-clip">{action.id === 'audio' ? <Music2 size={16} /> : scene?.kind === 'video' ? <Film size={16} /> : scene ? <img src={scene.sourceRef} alt="" draggable={false} /> : null}<span>{action.id === 'audio' ? document.audio?.label : scene?.label}<small>{clock(action.end - action.start)}</small></span></span>;
        }}
        onClickAction={(_event, { action, time: position }) => { if (action.id !== 'audio') setSelectedId(action.id); seek(position); }}
        onClickTimeArea={position => { seek(position); return false; }} onCursorDrag={seek}
        onActionMoving={({ start, end }) => start >= 0 && end <= 600}
        onActionResizing={({ action, start, end, dir }) => {
          if (start < 0 || end > 600 || end - start < 0.1) return false;
          if (dir !== 'left') return true;
          if (action.id === 'audio' && document.audio) return document.audio.trimStart + start - document.audio.offset >= 0;
          const scene = scenes.find(item => item.id === action.id);
          return scene?.kind !== 'video' || (scene.trimStart || 0) + start - scene.start >= 0;
        }}
        onActionMoveEnd={({ action, start }) => {
          if (action.id === 'audio' && document.audio) commit({ ...document, audio: { ...document.audio, offset: frameTime(start) } });
          else { const scene = scenes.find(item => item.id === action.id); if (scene) reorder(scene.id, scenes.filter(item => item.id !== scene.id && (item.start + item.end) / 2 < start + scene.duration / 2).length); }
        }}
        onActionResizeEnd={({ action, start, end, dir }) => {
          if (action.id === 'audio' && document.audio) commit({ ...document, audio: { ...document.audio, offset: frameTime(start), duration: frameTime(end - start), trimStart: Math.max(0, frameTime(document.audio.trimStart + (dir === 'left' ? start - document.audio.offset : 0))) } });
          else { const scene = scenes.find(item => item.id === action.id); if (scene) commit({ ...document, scenes: document.scenes.map(item => item.id === scene.id ? { ...item, duration: frameTime(end - start), trimStart: item.kind === 'video' ? Math.max(0, frameTime((item.trimStart || 0) + (dir === 'left' ? start - scene.start : 0))) : 0 } : item) }); }
        }} />
    </div>
    <p className="media-video-editor-hint">拖动画面片段调整顺序，拖动边缘调整时长；后续画面会顺延。配音轨可独立移动与裁切，添加配音后会替换原片声音。超出视频总时长的配音不会导出。</p>
  </div>;
}
